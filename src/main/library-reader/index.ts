import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { RequestContext } from '../../shared/management';
import { pluginResourceRights, type PluginCreatedResource, type PluginGrant, type PluginResource } from '../../shared/plugin-access';
import { APP_HOME } from '../../shared/protocol';
import type { ReaderSessionView } from '../../shared/library-api';
import { atomicJson, readJson } from '../atomic-file';
import { isAppAdministrator, requestContext, requireAppAdministrator, withCaller } from '../authorization';
import { emitCoreEvent } from '../core-events';
import { readStore } from '../store';
import { pluginBridge } from '../web/plugin-bridge';
import { libraryReaderDirectory, libraryReaderRoot } from './paths';

const requireModule = createRequire(__filename);

type AccessEntry = { workspace: string; revision: number; grants: PluginGrant[] };
type AccessStoreFile = { version: 1; entries: Record<string, AccessEntry> };
type ReaderRuntime = {
  resources?: () => Promise<PluginResource[]>;
  request: (req: { jsonrpc: '2.0'; id: string | number; method: string; params: Record<string, unknown>; stateMode?: string }) => Promise<any>;
  requestScoped?: (
    req: { jsonrpc: '2.0'; id: string | number; method: string; params: Record<string, unknown>; stateMode?: string },
    scope: { employeeId: string; employeeName?: string; grants: Array<{ resourceId: string; read: boolean; write: boolean; create: boolean }> },
  ) => Promise<any>;
  subscribe?: (listener: (event: any) => void, options?: { stateMode?: string; initialState?: boolean }) => Promise<() => void>;
  readAsset?: (asset: string) => Promise<{ bytes: Buffer | Uint8Array; mimeType: string }>;
  close?: () => Promise<void>;
};

type ReaderHttpSession = {
  id: string;
  plugin: 'library-reader';
  name: string;
  workspace: string;
  url: string;
  clientId?: string;
  port: number;
  server: http.Server;
  close: () => Promise<void>;
};

const runtimes = new Map<string, Promise<ReaderRuntime>>();
const httpSessions = new Map<string, ReaderHttpSession>();
const sessionListeners = new Set<(sessions: Array<{ id: string; workspace: string }>) => void>();
let cachedSchema: { version: string; commands: Array<Record<string, any>> } | null = null;
let lastMigratedHome: string | null = null;

function notifySessionListeners() {
  const snapshot = readerSessions();
  for (const listener of sessionListeners) {
    try {
      listener(snapshot);
    } catch {
      /* Listener failures cannot block session tracking. */
    }
  }
}

export function onReaderSessions(listener: (sessions: Array<{ id: string; workspace: string }>) => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export function readerSessions(): Array<{ id: string; workspace: string }> {
  return [...httpSessions.values()].map(({ id, workspace }) => ({ id, workspace }));
}

function canonicalWorkspace(workspace: string): string {
  return fs.existsSync(workspace) ? fs.realpathSync(workspace) : path.resolve(workspace);
}

function accessFile(home = APP_HOME): string {
  return path.join(home, 'library-reader-access.json');
}

function ensureMigratedWorkspace(home = APP_HOME): string {
  const target = libraryReaderRoot(home);
  if (lastMigratedHome === home && fs.existsSync(target)) return canonicalWorkspace(target);
  lastMigratedHome = home;
  if (!fs.existsSync(target)) {
    const candidates = [
      path.join(home, 'workspaces', 'margin-reader-workspace', 'default'),
      path.join(home, 'workspaces', 'margin-reader-workspace'),
    ];
    for (const legacy of candidates) {
      if (!fs.existsSync(legacy)) continue;
      if (legacy.endsWith('margin-reader-workspace') && fs.existsSync(path.join(legacy, 'default'))) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      try {
        fs.renameSync(legacy, target);
      } catch (error: any) {
        if (error?.code === 'EXDEV') {
          fs.cpSync(legacy, target, { recursive: true });
          fs.rmSync(legacy, { recursive: true, force: true });
        } else {
          throw error;
        }
      }
      const legacyMeta = path.join(target, '.agents-company');
      if (fs.existsSync(legacyMeta)) fs.rmSync(legacyMeta, { recursive: true, force: true });
      break;
    }
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(target, '.margin-reader'), { recursive: true, mode: 0o700 });
  return canonicalWorkspace(target);
}

export function ensureLibraryReaderWorkspace(): string {
  return ensureMigratedWorkspace(APP_HOME);
}

function workspaceKey(workspace: string): string {
  return createHash('sha256').update(canonicalWorkspace(workspace)).digest('hex');
}

function isLegacyReaderWorkspacePath(p: string): boolean {
  const normalized = p.replaceAll('\\', '/');
  return normalized.endsWith('/margin-reader-workspace/default') || normalized.endsWith('/margin-reader-workspace');
}

function readAccessStore(home = APP_HOME): AccessStoreFile {
  const file = accessFile(home);
  if (fs.existsSync(file)) {
    return readJson<AccessStoreFile>(file, () => ({ version: 1, entries: {} }));
  }
  const defaultWorkspace = ensureMigratedWorkspace(home);
  const legacyPluginFile = path.join(home, 'plugin-access.json');
  const next: AccessStoreFile = { version: 1, entries: {} };
  if (fs.existsSync(legacyPluginFile)) {
    try {
      const legacy = readJson<
        Record<string, { plugin?: string; workspace?: string; revision?: number; grants?: PluginGrant[] }>
      >(legacyPluginFile, () => ({}));
      let migrated = false;
      for (const entry of Object.values(legacy)) {
        if (entry?.plugin !== 'margin-reader' || !Array.isArray(entry.grants)) continue;
        const rawWorkspace = entry.workspace ? String(entry.workspace) : defaultWorkspace;
        const mappedWorkspace = isLegacyReaderWorkspacePath(rawWorkspace) ? defaultWorkspace : canonicalWorkspace(rawWorkspace);
        const key = workspaceKey(mappedWorkspace);
        const current = next.entries[key] ?? { workspace: mappedWorkspace, revision: 0, grants: [] };
        current.revision = Math.max(current.revision, Number(entry.revision) || 0, entry.grants.length ? 1 : 0);
        for (const grant of entry.grants) {
          if (!grant?.employeeId || !grant?.resourceId) continue;
          const prev = current.grants.find((g) => g.employeeId === grant.employeeId && g.resourceId === grant.resourceId);
          if (prev) {
            prev.read = Boolean(prev.read || grant.read);
            prev.write = Boolean(prev.write || grant.write);
            prev.create = Boolean(prev.create || grant.create);
          } else {
            current.grants.push({
              employeeId: grant.employeeId,
              resourceId: grant.resourceId,
              read: Boolean(grant.read),
              write: Boolean(grant.write),
              create: Boolean(grant.create),
            });
          }
          migrated = true;
        }
        next.entries[key] = current;
      }
      if (migrated) atomicJson(file, next, true);
    } catch {
      /* Preserve empty access state if legacy plugin-access file is unreadable. */
    }
  }
  return next;
}

function readAccessEntry(workspace: string): AccessEntry {
  const canonical = canonicalWorkspace(workspace);
  const store = readAccessStore(APP_HOME);
  return store.entries[workspaceKey(canonical)] ?? { workspace: canonical, revision: 0, grants: [] };
}

function scopeFor(workspace: string, employeeId: string) {
  const entry = readAccessEntry(workspace);
  return {
    employeeId,
    employeeName: readStore().sessions.find((p) => p.id === employeeId)?.title,
    grants: entry.grants
      .filter((g) => g.employeeId === employeeId)
      .map(({ resourceId, read, write, create }) => ({ resourceId, read, write, create })),
  };
}

function grantCreatedResources(workspace: string, employeeId: string, created: PluginCreatedResource[]) {
  if (!created.length) return;
  const canonical = canonicalWorkspace(workspace);
  const store = readAccessStore(APP_HOME);
  const key = workspaceKey(canonical);
  const entry = store.entries[key] ?? { workspace: canonical, revision: 0, grants: [] };
  const allowed = new Set(entry.grants.filter((g) => g.employeeId === employeeId && g.create).map((g) => g.resourceId));
  let changed = false;
  for (const resource of created) {
    if (!allowed.has(resource.parentId)) continue;
    entry.grants = entry.grants.filter((g) => g.employeeId !== employeeId || g.resourceId !== resource.id);
    entry.grants.push({ employeeId, resourceId: resource.id, read: true, write: true, create: true });
    allowed.add(resource.id);
    changed = true;
  }
  if (!changed) return;
  entry.revision++;
  store.entries[key] = entry;
  atomicJson(accessFile(), store, true);
  emitCoreEvent({ channel: 'access:changed', payload: { target: 'reader', workspace: canonical } });
}

function resolveTargetWorkspace(workspace?: string): string {
  const defaultRoot = ensureMigratedWorkspace(APP_HOME);
  if (!workspace || !workspace.trim()) return defaultRoot;
  const candidate = path.resolve(workspace.trim());
  const homeReal = canonicalWorkspace(APP_HOME);
  const defaultParent = path.dirname(canonicalWorkspace(defaultRoot));
  if (candidate === homeReal || candidate === defaultParent || candidate.startsWith(homeReal + path.sep)) {
    // Allow internal Library reader directory and temporary reader-cache roots; reject arbitrary Core internal folders outside them.
    const cachePrefix = path.join(homeReal, 'reader-cache');
    const sharedPrefix = path.join(homeReal, 'Shared');
    const convPrefix = path.join(homeReal, 'conversation-workspaces');
    const channelPrefix = path.join(homeReal, 'channels');
    const allowedPrefixes = [defaultRoot, cachePrefix, sharedPrefix, convPrefix, channelPrefix];
    if (
      candidate !== defaultRoot &&
      !allowedPrefixes.some((prefix) => candidate === prefix || candidate.startsWith(prefix + path.sep))
    ) {
      throw Error('Study Reader workspace cannot target internal Core configuration folders');
    }
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw Error('Study Reader workspace must be an existing directory');
  }
  return canonicalWorkspace(candidate);
}

function readSchema() {
  if (cachedSchema) return cachedSchema;
  const file = path.join(libraryReaderDirectory(), 'schema.json');
  cachedSchema = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cachedSchema!;
}

async function runtimeFor(workspace?: string): Promise<{ workspace: string; runtime: ReaderRuntime }> {
  const root = resolveTargetWorkspace(workspace);
  let pending = runtimes.get(root);
  if (!pending) {
    pending = (async () => {
      const dir = libraryReaderDirectory();
      const factory = requireModule(path.join(dir, 'runtime.cjs'));
      if (typeof factory?.createPlugin !== 'function') throw Error('Built-in Study Reader runtime is invalid');
      return (await factory.createPlugin({ workspace: root })) as ReaderRuntime;
    })();
    runtimes.set(root, pending);
    pending.catch(() => runtimes.delete(root));
  }
  return { workspace: root, runtime: await pending };
}

export async function readerCall(
  method: string,
  params: Record<string, unknown> = {},
  options: { workspace?: string; origin?: string; stateMode?: 'full' | 'delta' | 'none'; includeEnvelope?: boolean } = {},
) {
  const { workspace, runtime } = await runtimeFor(options.workspace);
  const principal = requestContext().principal;
  const stateMode = options.stateMode ?? (options.includeEnvelope ? undefined : 'none');

  let reply: any;
  if (isAppAdministrator(principal)) {
    reply = await runtime.request({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params: params ?? {},
      ...(options.origin ? { origin: options.origin } : {}),
      ...(stateMode ? { stateMode } : {}),
    });
  } else {
    if (principal.kind !== 'agent' || !runtime.requestScoped) {
      throw Error('Study Reader requires explicit document or study-set authorization');
    }
    const scope = scopeFor(workspace, principal.employeeId);
    if (!scope.grants.some((g) => g.read || g.write || g.create)) {
      throw Error('Study Reader requires explicit authorization; ask the user or Secretary to grant selected documents or study sets');
    }
    const scoped = await runtime.requestScoped({ jsonrpc: '2.0', id: randomUUID(), method, params: params ?? {}, stateMode: 'none' }, scope);
    if (scoped.createdResources) {
      grantCreatedResources(workspace, principal.employeeId, scoped.createdResources);
    }
    const { createdResources: _ignored, ...clean } = scoped;
    reply = clean;
  }

  if (options.includeEnvelope) return reply;
  if (reply?.error) throw Error(`${reply.error.message} (${reply.error.code})`);
  if (
    /^(study\.(create|update|remove|restore|documents\.|card\.|cards\.)|document\.(open|remove|restore|rename|move|import|export)|import\.commit|fs\.(mkdir|write|delete|rename|move|copy)|web\.import)/.test(
      method,
    )
  ) {
    emitCoreEvent({ channel: 'reader:changed', payload: { workspace } });
  }
  return reply?.result;
}

export async function readerStatus(workspace?: string) {
  const { workspace: root } = await runtimeFor(workspace);
  const entry = readAccessEntry(root);
  const docs = (await readerCall('document.list', {}, { workspace: root }).catch(() => ({ documents: [] }))) as {
    documents?: Array<{ trashed?: boolean }>;
  };
  const studies = (await readerCall('study.list', {}, { workspace: root }).catch(() => ({ sets: [] }))) as {
    sets?: Array<{ deletedAt?: number; cardCount?: number; dueCount?: number }>;
    studySets?: Array<{ deletedAt?: number; cardCount?: number; dueCount?: number }>;
  };
  const activeDocs = (docs.documents ?? []).filter((d) => !d.trashed);
  const activeStudies = (studies.sets ?? studies.studySets ?? []).filter((s) => !s.deletedAt);
  const cardCount = activeStudies.reduce((sum, s) => sum + Number(s.cardCount ?? 0), 0);
  const reviewDueCount = activeStudies.reduce((sum, s) => sum + Number(s.dueCount ?? 0), 0);
  return {
    root,
    documentCount: activeDocs.length,
    studySetCount: activeStudies.length,
    cardCount,
    reviewDueCount,
    revision: entry.revision,
  };
}

export function readerGuide(topic?: string) {
  const file = path.join(libraryReaderDirectory(), 'API.md');
  const markdown = fs.readFileSync(file, 'utf8');
  if (!topic || !topic.trim()) {
    return {
      topic: 'overview',
      markdown: markdown.slice(0, 24000),
      truncated: markdown.length > 24000,
    };
  }
  const needle = topic.trim().toLowerCase();
  const sections = markdown.split(/\n(?=## )/);
  const matched = sections.filter((sec) => sec.toLowerCase().includes(needle));
  return {
    topic,
    markdown: (matched.length ? matched.join('\n\n') : markdown.slice(0, 12000)).slice(0, 24000),
  };
}

export function readerMethods(query?: string) {
  const schema = readSchema();
  const needle = (query ?? '').trim().toLowerCase();
  const items = schema.commands
    .filter((cmd) => !needle || cmd.method.toLowerCase().includes(needle) || String(cmd.summary ?? '').toLowerCase().includes(needle))
    .map((cmd) => ({
      method: cmd.method,
      summary: cmd.summary ?? '',
      mutates: Boolean(cmd.mutates),
      options: cmd.options ?? {},
    }));
  return { version: schema.version, total: items.length, methods: items.slice(0, 200) };
}

export async function readerResources(workspace?: string) {
  const { workspace: root, runtime } = await runtimeFor(workspace);
  const entry = readAccessEntry(root);
  const rawResources = runtime.resources ? await runtime.resources() : [];
  const principal = requestContext().principal;

  if (isAppAdministrator(principal)) {
    return {
      workspace: root,
      revision: entry.revision,
      resources: rawResources.map((r) => ({
        ...r,
        rights: {
          read: (r.capabilities ?? ['read', 'write', 'create']).includes('read'),
          write: (r.capabilities ?? ['read', 'write', 'create']).includes('write'),
          create: (r.capabilities ?? ['read', 'write', 'create']).includes('create'),
        },
      })),
    };
  }

  if (principal.kind !== 'agent') return { workspace: root, revision: entry.revision, resources: [] };
  const scope = scopeFor(root, principal.employeeId);
  if (!scope.grants.some((g) => g.read || g.write || g.create)) {
    return { workspace: root, revision: entry.revision, resources: [] };
  }
  return {
    workspace: root,
    revision: entry.revision,
    resources: rawResources.flatMap((resource) => {
      const rights = pluginResourceRights(scope, rawResources, resource.id);
      return rights.read || rights.write || rights.create ? [{ ...resource, rights }] : [];
    }),
  };
}

export async function readerAccess(args: {
  workspace?: string;
  resourceIds?: string[];
  updates?: PluginGrant[];
  employees?: { employeeId: string; read: boolean; write: boolean; create: boolean }[];
  expectedRevision?: number;
}) {
  requireAppAdministrator();
  const { workspace: root, runtime } = await runtimeFor(args.workspace);
  const resources = runtime.resources ? await runtime.resources() : [];
  const store = readAccessStore(APP_HOME);
  const key = workspaceKey(root);
  const entry = store.entries[key] ?? { workspace: root, revision: 0, grants: [] };
  const people = readStore().sessions.filter((p) => !p.deleting);

  if (args.employees !== undefined || args.updates !== undefined) {
    if (args.expectedRevision !== entry.revision) {
      throw Error('Reader access changed; reload before saving');
    }
    const resourceIds = args.updates ? [...new Set(args.updates.map((g) => g.resourceId))] : args.resourceIds;
    const employees = args.updates ?? args.employees;
    if (
      !Array.isArray(resourceIds) ||
      !resourceIds.length ||
      resourceIds.length > 1000 ||
      resourceIds.some((id) => !resources.some((r) => r.id === id))
    ) {
      throw Error('Choose existing Study Reader documents or study sets');
    }
    if (
      !Array.isArray(employees) ||
      employees.length > 200000 ||
      employees.some(
        (g) =>
          !people.some((p) => p.id === g.employeeId) ||
          (['read', 'write', 'create'] as const).some((right) => typeof g[right] !== 'boolean'),
      )
    ) {
      throw Error('Choose existing employees and explicit read/write/create rights');
    }

    const selected = new Set(resourceIds);
    const grants = entry.grants.filter((g) =>
      args.updates
        ? !args.updates.some((u) => u.resourceId === g.resourceId && u.employeeId === g.employeeId)
        : !(selected.has(g.resourceId) && (!employees.length || employees.some((employee) => employee.employeeId === g.employeeId))),
    );
    for (const resourceId of selected) {
      for (const employee of employees.filter((g) => !args.updates || (g as PluginGrant).resourceId === resourceId)) {
        if (people.find((p) => p.id === employee.employeeId)!.managementRole === 'secretary') continue;
        const capabilities = resources.find((r) => r.id === resourceId)!.capabilities ?? ['read', 'write', 'create'];
        if ((employee.write && !capabilities.includes('write')) || (employee.create && !capabilities.includes('create'))) {
          throw Error('This Study Reader resource does not support the selected permission');
        }
        const rights = {
          read: capabilities.includes('read') && (employee.read || employee.write || employee.create),
          write: employee.write,
          create: employee.create,
        };
        grants.push({ employeeId: employee.employeeId, resourceId, ...rights });
      }
    }
    entry.grants = grants;
    entry.revision++;
    store.entries[key] = entry;
    atomicJson(accessFile(), store, true);
    emitCoreEvent({ channel: 'access:changed', payload: { target: 'reader', workspace: root } });
  }

  return {
    ...entry,
    grants: entry.grants.filter((g) => !args.resourceIds || args.resourceIds.includes(g.resourceId)),
    employees: people.map((p) => ({
      id: p.id,
      title: p.title,
      team: p.group ?? '',
      role: p.managementRole ?? 'employee',
    })),
    automaticRoles: ['secretary'],
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.bcmap': 'application/octet-stream',
  '.properties': 'text/plain; charset=utf-8',
  '.ftl': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safeUiFile(uiRoot: string, relative: string): string {
  const clean = relative.split('?')[0].split('#')[0] || 'index.html';
  const resolved = path.resolve(uiRoot, clean);
  const rootReal = fs.realpathSync(uiRoot);
  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    throw Error('Path escapes Study Reader UI root');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw Error('Study Reader UI asset not found: ' + clean);
  }
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(rootReal + path.sep)) throw Error('Symlink escapes Study Reader UI root');
  return real;
}

function uniqueImportPath(workspace: string, fileName: string): string {
  const dir = path.join(workspace, 'Imports');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext) || 'document';
  for (let i = 0; i < 10000; i++) {
    const candidateName = i === 0 ? `${stem}${ext}` : `${stem} (${i + 1})${ext}`;
    const full = path.join(dir, candidateName);
    if (!fs.existsSync(full)) return path.posix.join('Imports', candidateName);
  }
  return path.posix.join('Imports', `${stem}-${randomUUID().slice(0, 8)}${ext}`);
}

export async function openLibraryReaderSession(args: {
  workspace?: string;
  path?: string;
  documentId?: string;
  studySetId?: string;
  importToLibrary?: boolean;
} = {}): Promise<ReaderSessionView> {
  requireAppAdministrator();
  const caller: RequestContext = requestContext();
  const defaultWorkspace = ensureMigratedWorkspace(APP_HOME);
  let targetWorkspace = args.workspace ? resolveTargetWorkspace(args.workspace) : defaultWorkspace;
  let relativeDocPath = args.path?.trim();

  if (relativeDocPath && args.importToLibrary) {
    targetWorkspace = defaultWorkspace;
    if (path.isAbsolute(relativeDocPath)) {
      const sourceReal = fs.realpathSync(relativeDocPath);
      if (sourceReal.startsWith(targetWorkspace + path.sep)) {
        relativeDocPath = path.relative(targetWorkspace, sourceReal).split(path.sep).join('/');
      } else {
        const rel = uniqueImportPath(targetWorkspace, path.basename(sourceReal));
        fs.copyFileSync(sourceReal, path.join(targetWorkspace, rel));
        relativeDocPath = rel;
      }
    }
  } else if (relativeDocPath && path.isAbsolute(relativeDocPath) && !args.workspace) {
    const sourceReal = fs.realpathSync(relativeDocPath);
    if (sourceReal.startsWith(defaultWorkspace + path.sep)) {
      targetWorkspace = defaultWorkspace;
      relativeDocPath = path.relative(defaultWorkspace, sourceReal).split(path.sep).join('/');
    } else {
      targetWorkspace = path.dirname(sourceReal);
      relativeDocPath = path.basename(sourceReal);
    }
  }

  let openedDocument: any;
  let openedStudySet: any;

  if (relativeDocPath) {
    openedDocument = await readerCall('document.open', { path: relativeDocPath, activate: true }, { workspace: targetWorkspace });
    await readerCall('settings.set', { activeStudySet: null, homeSection: 'library' }, { workspace: targetWorkspace });
  } else if (args.documentId) {
    openedDocument = await readerCall('document.get', { id: args.documentId }, { workspace: targetWorkspace });
    await readerCall('settings.set', { lastDocument: args.documentId, activeStudySet: null, homeSection: 'library' }, { workspace: targetWorkspace });
  } else if (args.studySetId) {
    openedStudySet = await readerCall('study.open', { setId: args.studySetId }, { workspace: targetWorkspace });
  } else {
    // Ensure runtime starts cleanly even on initial Study Reader visit
    await runtimeFor(targetWorkspace);
  }

  const clientKey = caller.clientId ?? 'desktop';
  const existing = [...httpSessions.values()].find((s) => s.clientId === clientKey && s.workspace === targetWorkspace);
  if (existing) {
    return {
      id: existing.id,
      plugin: 'library-reader',
      name: 'Study Reader',
      workspace: existing.workspace,
      clientId: existing.clientId,
      url: existing.url,
      ...(openedDocument ? { document: openedDocument } : {}),
      ...(openedStudySet ? { studySet: openedStudySet } : {}),
    };
  }

  const { runtime } = await runtimeFor(targetWorkspace);
  const uiRoot = path.join(libraryReaderDirectory(), 'ui');
  const token = randomUUID();
  const base = `/${token}/`;
  const clients = new Set<http.ServerResponse>();
  const sockets = new Set<import('node:net').Socket>();
  let unsubscribe: (() => void) | undefined;

  const allowed = () => withCaller(caller, () => requireAppAdministrator());

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('access-control-allow-origin', '*');
      const url = new URL(req.url || '/', 'http://localhost');
      if (!url.pathname.startsWith(base)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const target = decodeURIComponent(url.pathname.slice(base.length));
      if (target === '_agents-bridge.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(pluginBridge(token));
        return;
      }
      if (target === 'rpc' && req.method === 'POST') {
        req.setEncoding('utf8');
        let body = '';
        for await (const part of req) {
          body += part;
          if (body.length > 64 * 1024 * 1024) throw Error('Request too large');
        }
        const rpc = JSON.parse(body);
        if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') throw Error('Invalid JSON-RPC request');
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once('close', cancel);
        try {
          const reply = await withCaller(
            { ...caller, requestId: randomUUID(), signal: controller.signal },
            () => {
              requireAppAdministrator();
              return runtime.request({ ...rpc, id: rpc.id ?? randomUUID(), params: rpc.params ?? {} });
            },
          );
          if (!res.destroyed) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(reply));
          }
        } finally {
          res.removeListener('close', cancel);
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      if (target === 'events') {
        allowed();
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (target.startsWith('data/')) {
        allowed();
        if (!runtime.readAsset) throw Error('Study Reader asset reader unavailable');
        const asset = await runtime.readAsset(target.slice(5));
        res.writeHead(200, {
          'content-type': asset.mimeType,
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        });
        res.end(Buffer.from(asset.bytes));
        return;
      }
      const relative = target || 'index.html';
      const file = safeUiFile(uiRoot, relative);
      res.writeHead(200, {
        'content-type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: -32000, message: String((error as Error).message) } }));
      } else {
        res.destroy();
      }
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    unsubscribe = await runtime.subscribe?.(
      (event) => {
        if (event?.method !== 'reader.position.set') {
          emitCoreEvent({ channel: 'reader:changed', payload: { workspace: targetWorkspace } });
        }
        if (!clients.size) return;
        try {
          allowed();
        } catch {
          for (const client of clients) client.end();
          clients.clear();
          return;
        }
        const packet = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of clients) {
          if (client.writableLength > 32 * 1024 * 1024) client.destroy();
          else client.write(packet);
        }
      },
      { stateMode: 'delta', initialState: false },
    );
  } catch (error) {
    server.close();
    throw error;
  }

  const port = (server.address() as import('node:net').AddressInfo).port;
  const close = async () => {
    unsubscribe?.();
    for (const client of clients) client.end();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  const session: ReaderHttpSession = {
    id: token,
    plugin: 'library-reader',
    name: 'Study Reader',
    workspace: targetWorkspace,
    url: `http://127.0.0.1:${port}${base}index.html?hosted=1`,
    clientId: caller.clientId,
    port,
    server,
    close,
  };
  httpSessions.set(token, session);
  notifySessionListeners();

  return {
    id: session.id,
    plugin: 'library-reader',
    name: session.name,
    workspace: session.workspace,
    clientId: session.clientId,
    url: session.url,
    ...(openedDocument ? { document: openedDocument } : {}),
    ...(openedStudySet ? { studySet: openedStudySet } : {}),
  };
}

export async function closeLibraryReaderSession(id: string) {
  requireAppAdministrator();
  const session = httpSessions.get(id);
  if (session) {
    httpSessions.delete(id);
    await session.close();
    notifySessionListeners();
  }
  return { closed: true, id };
}

export async function closeLibraryReader() {
  const closedSessions = [...httpSessions.values()].map(async (session) => {
    try {
      await session.close();
    } catch {
      /* Shutdown must continue across all reader HTTP sessions. */
    }
  });
  httpSessions.clear();
  notifySessionListeners();
  await Promise.all(closedSessions);

  const closedRuntimes = [...runtimes.values()].map(async (pending) => {
    try {
      await (await pending).close?.();
    } catch {
      /* Shutdown must continue across all reader runtimes. */
    }
  });
  runtimes.clear();
  await Promise.all(closedRuntimes);
}
