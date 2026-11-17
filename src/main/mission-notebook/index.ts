import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_HOME } from '../../shared/protocol';
import type { RequestContext } from '../../shared/management';
import type { PluginGrant, PluginResource } from '../../shared/plugin-access';
import { atomicJson, readJson } from '../atomic-file';
import { isAppAdministrator, operatorContext, requestContext, requireAppAdministrator } from '../authorization';
import { readStore } from '../store';
import { assistantCommands } from '../../shared/mission-notebook/core/assistantCommands';
import { agentGuide } from '../../shared/mission-notebook/core/agentGuide';
import { commands } from '../../shared/mission-notebook/core/catalog';
import { CommandError } from '../../shared/mission-notebook/core/errors';
import type { ActionEffect } from '../../shared/mission-notebook/actions/types';
import { requestAssistant } from './assistant';
import { mimeType } from './files';
import { withinFolder } from './folder';
import type { PageScope } from './pageAccess';
import { DataService } from './service';
import { assetPath, atomicWrite, folderDataDirectory } from './storage';

type AccessState = { version: 1; revision: number; grants: PluginGrant[] };

const INTERNAL_HOST_METHODS = new Set([
  'workspace.get',
  'workspace.init',
  'workspace.patch',
  'status',
  'ui.register',
  'page.open',
  'ui.command',
  'scheduler.run',
  'scheduler.status',
  'conflict.list',
  'conflict.get',
  'conflict.resolve',
  'batch',
  'fs.sync',
  'fs.info',
  'fs.audit',
  'fs.path',
  'fs.bind',
  'fs.organize',
  'fs.draft-read',
  'fs.draft-write',
  'fs.asset-upload',
  'history.operations',
  'history.undo',
  'history.redo',
  'history.list',
  'history.snapshot',
  'history.restore',
  'button.run',
  'button.preview',
  'automation.run',
  'automation.preview',
  'action.history',
]);

let runtime: { home: string; root: string; service: DataService } | null = null;
let initializing: Promise<DataService> | null = null;
let activeEffectContext: RequestContext | undefined;
let emitNotebookEvent: (channel: string, payload: unknown) => void = () => {};

export function setNotebookEmitter(fn: (channel: string, payload: unknown) => void): void {
  emitNotebookEvent = fn;
}

export function missionNotebookRoot(home = APP_HOME): string {
  return path.join(home, 'mission-notebook');
}

function accessFile(home = APP_HOME): string {
  return path.join(home, 'mission-notebook-access.json');
}

function migrateLegacyWorkspace(home: string, root: string): void {
  const legacy = path.join(home, 'workspaces', 'mini-notion-workspace');
  if (!fs.existsSync(root) && fs.existsSync(legacy)) {
    fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
    try {
      fs.renameSync(legacy, root);
    } catch (error: any) {
      if (error?.code === 'EXDEV') {
        fs.cpSync(legacy, root, { recursive: true });
        fs.rmSync(legacy, { recursive: true, force: true });
      } else {
        throw error;
      }
    }
    const legacyMeta = path.join(root, '.agents-company');
    if (fs.existsSync(legacyMeta)) {
      fs.rmSync(legacyMeta, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const dataDir = folderDataDirectory(root);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const marker = path.join(dataDir, 'collection.json');
  if (!fs.existsSync(marker)) {
    atomicWrite(marker, { format: 'mininotion.collection/v1' });
  }
}

function readAccessState(home = APP_HOME): AccessState {
  const file = accessFile(home);
  if (fs.existsSync(file)) {
    return readJson<AccessState>(file, () => ({ version: 1, revision: 0, grants: [] }));
  }
  const legacyPluginFile = path.join(home, 'plugin-access.json');
  if (fs.existsSync(legacyPluginFile)) {
    try {
      const legacy = readJson<Record<string, { plugin?: string; workspace?: string; revision?: number; grants?: PluginGrant[] }>>(
        legacyPluginFile,
        () => ({}),
      );
      const merged = new Map<string, PluginGrant>();
      let revision = 0;
      for (const entry of Object.values(legacy)) {
        if (entry?.plugin !== 'mininotion' || !Array.isArray(entry.grants)) continue;
        revision = Math.max(revision, Number(entry.revision) || 0);
        for (const grant of entry.grants) {
          if (!grant?.employeeId || !grant?.resourceId) continue;
          const key = `${grant.employeeId}\0${grant.resourceId}`;
          const prev = merged.get(key);
          merged.set(key, {
            employeeId: grant.employeeId,
            resourceId: grant.resourceId,
            read: Boolean(prev?.read || grant.read),
            write: Boolean(prev?.write || grant.write),
            create: Boolean(prev?.create || grant.create),
          });
        }
      }
      if (merged.size > 0 || revision > 0) {
        const migrated: AccessState = { version: 1, revision: Math.max(1, revision), grants: [...merged.values()] };
        atomicJson(file, migrated, true);
        return migrated;
      }
    } catch {
      /* Preserve empty access state if legacy plugin access file is unreadable. */
    }
  }
  return { version: 1, revision: 0, grants: [] };
}

function grantResourceRights(employeeId: string, resourceId: string, level: 'none' | 'read' | 'write' | 'create'): void {
  if (!employeeId || !resourceId || level === 'none') return;
  const people = readStore().sessions.filter((card) => !card.deleting);
  const employee = people.find((card) => card.id === employeeId);
  if (!employee || employee.managementRole === 'secretary') return;
  const state = readAccessState();
  const nextRight = {
    read: true,
    write: level === 'write' || level === 'create',
    create: level === 'create',
  };
  const existing = state.grants.find((g) => g.employeeId === employeeId && g.resourceId === resourceId);
  const merged: PluginGrant = {
    employeeId,
    resourceId,
    read: Boolean(existing?.read || nextRight.read),
    write: Boolean(existing?.write || nextRight.write),
    create: Boolean(existing?.create || nextRight.create),
  };
  if (
    existing &&
    existing.read === merged.read &&
    existing.write === merged.write &&
    existing.create === merged.create
  ) {
    return;
  }
  state.grants = [
    ...state.grants.filter((g) => !(g.employeeId === employeeId && g.resourceId === resourceId)),
    merged,
  ];
  state.revision++;
  atomicJson(accessFile(), state, true);
}

async function dispatchWorkflowEffects(effects: ActionEffect[]): Promise<void> {
  if (!effects.length) return;
  const external = effects.filter((effect) => effect.type !== 'open');
  if (!external.length) return;
  const { handleRequest } = await import('../server');
  const ctx = activeEffectContext ?? operatorContext();

  for (const effect of external) {
    if (effect.type === 'agent_dispatch') {
      if (effect.grantPageAccess !== 'none') {
        grantResourceRights(effect.employeeId, effect.pageId, effect.grantPageAccess);
      }
      if (effect.deliveryMode === 'session') {
        await handleRequest({ cmd: 'session.send', args: { id: effect.employeeId, text: effect.prompt } }, ctx);
      } else {
        await handleRequest(
          { cmd: 'direct.send', args: { employee: effect.employeeId, text: effect.prompt, mode: 'enqueue' } },
          ctx,
        );
      }
      continue;
    }

    if (effect.type === 'mission_create') {
      if (effect.grantPageAccess !== 'none') {
        for (const employeeId of effect.employeeIds) {
          grantResourceRights(employeeId, effect.pageId, effect.grantPageAccess);
        }
      }
      const store = readStore();
      const secretary = store.sessions.find((c) => !c.deleting && c.managementRole === 'secretary');
      const useSupervised = effect.missionType === 'supervised' && !!secretary;
      await handleRequest(
        {
          cmd: 'mission.create',
          args: {
            spec: {
              name: effect.name,
              prompt: effect.prompt,
              employeeIds: effect.employeeIds,
              type: useSupervised ? 'supervised' : 'independent',
              ...(useSupervised && secretary ? { secretaryId: secretary.id } : {}),
              reminderSeconds: Math.max(10, Math.min(31536000, Math.round(effect.reminderSeconds || 1800))),
            },
          },
        },
        ctx,
      );
      continue;
    }

    if (effect.type === 'schedule_create') {
      if (effect.grantPageAccess !== 'none') {
        grantResourceRights(effect.employeeId, effect.pageId, effect.grantPageAccess);
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
      let rule: Record<string, unknown> | undefined;
      let afterSeconds: number | undefined;
      if (effect.scheduleKind === 'once') {
        const parsed = effect.scheduleAt ? Date.parse(effect.scheduleAt) : NaN;
        if (Number.isFinite(parsed) && parsed > Date.now()) {
          rule = { kind: 'once', at: new Date(parsed).toISOString() };
        } else {
          afterSeconds = 60;
        }
      } else if (effect.scheduleKind === 'interval') {
        rule = {
          kind: 'interval',
          everySeconds: Math.max(1, Math.min(31536000, Math.round(effect.everySeconds || 3600))),
        };
      } else if (effect.scheduleKind === 'weekly') {
        const days = Array.isArray(effect.weeklyDays) && effect.weeklyDays.length ? effect.weeklyDays : [1];
        const time = /^\d{2}:\d{2}$/.test(effect.weeklyTime || '') ? effect.weeklyTime : '09:00';
        rule = { kind: 'weekly', time, days, timezone: tz };
      } else if (effect.scheduleKind === 'event') {
        const allowedEvents = new Set([
          'signal',
          'channel.posted',
          'message.received',
          'session.completed',
          'monitor.output',
          'monitor.exited',
        ]);
        const event = allowedEvents.has(effect.eventName || '') ? effect.eventName : 'signal';
        rule = { kind: 'event', event };
      }

      await handleRequest(
        {
          cmd: 'schedule.create',
          args: {
            spec: {
              name: effect.name,
              action: { type: 'agent', employeeId: effect.employeeId, prompt: effect.prompt },
              ...(rule ? { rule } : { afterSeconds: afterSeconds ?? 60 }),
              source: `notebook:${effect.pageId}`,
            },
          },
        },
        ctx,
      );
    }
  }
}

async function ensureService(): Promise<DataService> {
  const root = missionNotebookRoot();
  if (runtime && runtime.home === APP_HOME) return runtime.service;
  if (initializing) return initializing;
  initializing = (async () => {
    if (runtime) {
      runtime.service.stopScheduler();
      runtime = null;
    }
    migrateLegacyWorkspace(APP_HOME, root);
    const dataDir = folderDataDirectory(root);
    const service = new DataService(dataDir, root, (effects) => dispatchWorkflowEffects(effects));
    service.subscribe((event) => {
      emitNotebookEvent('notebook:changed', event);
    });
    const syncReply = await service.request({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'fs.sync',
      params: {},
      stateMode: 'none',
    });
    if (syncReply.error && !service.workspace) {
      await service.request({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'workspace.init',
        params: { name: 'Mission' },
        stateMode: 'none',
      });
    } else if (!service.workspace) {
      await service.request({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'workspace.init',
        params: { name: 'Mission' },
        stateMode: 'none',
      });
    }
    service.startScheduler();
    runtime = { home: APP_HOME, root, service };
    return service;
  })();
  try {
    return await initializing;
  } finally {
    initializing = null;
  }
}

function notebookScope(employeeId: string): PageScope {
  const state = readAccessState();
  return {
    employeeId,
    employeeName: readStore().sessions.find((c) => c.id === employeeId)?.title,
    grants: state.grants
      .filter((g) => g.employeeId === employeeId)
      .map(({ employeeId: _id, ...rights }) => rights),
  };
}

function grantCreatedResources(employeeId: string, created: { id: string; parentId: string }[]): void {
  if (!created.length) return;
  const state = readAccessState();
  const allowed = new Set(
    state.grants.filter((g) => g.employeeId === employeeId && g.create).map((g) => g.resourceId),
  );
  let changed = false;
  for (const resource of created) {
    if (!allowed.has(resource.parentId)) continue;
    state.grants = state.grants.filter(
      (g) => !(g.employeeId === employeeId && g.resourceId === resource.id),
    );
    state.grants.push({
      employeeId,
      resourceId: resource.id,
      read: true,
      write: true,
      create: true,
    });
    allowed.add(resource.id);
    changed = true;
  }
  if (changed) {
    state.revision++;
    atomicJson(accessFile(), state, true);
  }
}

function assertAllowedMethod(method: string): void {
  if (!method || typeof method !== 'string') {
    throw new CommandError('INVALID_ARGUMENT', 'Provide a Mission Notebook method');
  }
  const known =
    commands.some((c) => c.method === method) ||
    assistantCommands.some((c) => c.method === method) ||
    INTERNAL_HOST_METHODS.has(method);
  if (!known) {
    throw new CommandError('METHOD_NOT_FOUND', `Unknown Mission Notebook method: ${method}`);
  }
}

export async function notebookStatus() {
  const service = await ensureService();
  const root = missionNotebookRoot();
  const principal = requestContext().principal;
  const workspace = service.workspace;
  if (isAppAdministrator(principal)) {
    const pages = workspace?.pages.filter((p) => !p.trashedAt && !p.syncedSource) ?? [];
    return {
      root,
      revision: service.revision,
      pageCount: pages.length,
      databaseCount: pages.filter((p) => !!p.database).length,
      resourceCount: pages.length + 1,
    };
  }
  const resources = await notebookResources();
  return {
    root,
    revision: service.revision,
    pageCount: resources.resources.filter((r) => r.id !== '@root').length,
    databaseCount: resources.resources.filter((r) => r.kind === 'database').length,
    resourceCount: resources.resources.length,
  };
}

export function notebookGuide(topic?: string) {
  return agentGuide(topic);
}

export function notebookMethods(query?: string) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  const list = [...commands, ...assistantCommands].filter(
    (item) =>
      !q ||
      item.method.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q),
  );
  return { count: list.length, commands: list };
}

export async function notebookResources() {
  const service = await ensureService();
  const reply = await service.request({
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'host.resources',
    params: {},
    stateMode: 'none',
  });
  if (reply.error) throw new Error(reply.error.message);
  const all = reply.result as PluginResource[];
  const principal = requestContext().principal;
  const state = readAccessState();
  if (isAppAdministrator(principal)) {
    return {
      root: missionNotebookRoot(),
      revision: state.revision,
      resources: all.map((r) => ({ ...r, rights: { read: true, write: true, create: true } })),
    };
  }
  if (principal.kind !== 'agent') return { root: missionNotebookRoot(), revision: state.revision, resources: [] };
  const scope = notebookScope(principal.employeeId);
  const byId = new Map(all.map((r) => [r.id, r]));
  const rightsFor = (id: string) =>
    scope.grants.find((g) => g.resourceId === id) ??
    (byId.get(id)?.inheritFrom ? scope.grants.find((g) => g.resourceId === byId.get(id)!.inheritFrom) : undefined) ?? {
      read: false,
      write: false,
      create: false,
    };
  return {
    root: missionNotebookRoot(),
    revision: state.revision,
    resources: all.flatMap((resource) => {
      const rights = rightsFor(resource.id);
      return rights.read || rights.write || rights.create ? [{ ...resource, rights }] : [];
    }),
  };
}

export async function notebookAccess(args: {
  resourceIds?: string[];
  updates?: PluginGrant[];
  employees?: Array<{ employeeId: string; read: boolean; write: boolean; create: boolean }>;
  expectedRevision?: number;
}) {
  requireAppAdministrator();
  const { resources } = await notebookResources();
  const entry = readAccessState();
  const people = readStore().sessions.filter((p) => !p.deleting);

  if (args.employees !== undefined || args.updates !== undefined) {
    if (args.expectedRevision !== entry.revision) {
      throw new Error('Notebook access changed; reload before saving');
    }
    const resourceIds = args.updates ? [...new Set(args.updates.map((g) => g.resourceId))] : args.resourceIds;
    const employees = args.updates ?? args.employees;
    if (
      !Array.isArray(resourceIds) ||
      !resourceIds.length ||
      resourceIds.length > 1000 ||
      resourceIds.some((id) => !resources.some((r) => r.id === id))
    ) {
      throw new Error('Choose existing Mission Notebook pages or resources');
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
      throw new Error('Choose existing employees and explicit read/write/create rights');
    }

    const grants = entry.grants.filter((g) =>
      args.updates
        ? !args.updates.some((u) => u.resourceId === g.resourceId && u.employeeId === g.employeeId)
        : !(
            resourceIds.includes(g.resourceId) &&
            (!employees.length || employees.some((employee) => employee.employeeId === g.employeeId))
          ),
    );

    for (const resourceId of resourceIds) {
      for (const employee of employees.filter(
        (g) => !args.updates || (g as PluginGrant).resourceId === resourceId,
      )) {
        if (people.find((p) => p.id === employee.employeeId)!.managementRole === 'secretary') continue;
        const capabilities = resources.find((r) => r.id === resourceId)!.capabilities ?? ['read', 'write', 'create'];
        if (
          (employee.write && !capabilities.includes('write')) ||
          (employee.create && !capabilities.includes('create'))
        ) {
          throw new Error('This resource does not support the selected permission');
        }
        grants.push({
          employeeId: employee.employeeId,
          resourceId,
          read: capabilities.includes('read') && (employee.read || employee.write || employee.create),
          write: employee.write,
          create: employee.create,
        });
      }
    }
    entry.grants = grants;
    entry.revision++;
    atomicJson(accessFile(), entry, true);
  }

  return {
    root: missionNotebookRoot(),
    revision: entry.revision,
    grants: entry.grants.filter((g) => !args.resourceIds || args.resourceIds.includes(g.resourceId)),
    employees: people.map((p) => ({
      id: p.id,
      title: p.title,
      team: p.group,
      role: p.managementRole ?? 'employee',
    })),
    automaticRoles: ['secretary'],
  };
}

export async function notebookCall(
  method: string,
  params: Record<string, any> = {},
  options: { raw?: boolean; stateMode?: 'full' | 'delta' | 'none'; client?: string } = {},
) {
  assertAllowedMethod(method);
  const service = await ensureService();
  const context = requestContext();
  const admin = isAppAdministrator(context.principal);

  if (assistantCommands.some((c) => c.method === method)) {
    if (!admin) throw new Error('Only the user or Secretary may use Mission Notebook AI assistant commands');
    const { handleRequest } = await import('../server');
    const result = await requestAssistant(
      (req) => handleRequest({ cmd: req.cmd, args: req.args }, context),
      method,
      params,
    );
    return options.raw ? { result } : result;
  }

  const prevContext = activeEffectContext;
  activeEffectContext = context;
  try {
    if (admin) {
      const resolvedClient =
        options.client ?? (options.raw || method === 'ui.register' ? `gui-${context.clientId ?? 'desktop'}` : undefined);
      const reply = await service.request({
        jsonrpc: '2.0',
        id: randomUUID(),
        method,
        params,
        stateMode: options.stateMode ?? (options.raw ? 'delta' : 'none'),
        ...(resolvedClient ? { client: resolvedClient } : {}),
      });
      if (reply.error) {
        const err = new Error(reply.error.message);
        (err as any).code = reply.error.code;
        throw err;
      }
      if (options.raw) {
        return {
          result: reply.result,
          revision: reply.revision,
          ...(reply.delta ? { delta: reply.delta } : {}),
          ...(reply.workspace ? { workspace: reply.workspace } : {}),
        };
      }
      return reply.result;
    }

    if (context.principal.kind !== 'agent') {
      throw new Error('Unauthorized Mission Notebook access');
    }
    const scope = notebookScope(context.principal.employeeId);
    const reply = await service.request({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'host.execute',
      params: { scope, method, params },
      stateMode: 'none',
    });
    if (reply.error) {
      const err = new Error(reply.error.message);
      (err as any).code = reply.error.code;
      throw err;
    }
    const payload = reply.result as { data: unknown; created?: { id: string; parentId: string }[] };
    if (payload.created?.length) {
      grantCreatedResources(context.principal.employeeId, payload.created);
    }
    return payload.data;
  } finally {
    activeEffectContext = prevContext;
  }
}

export async function readMissionNotebookAsset(relPath: string): Promise<{ path: string; bytes: Buffer; mimeType: string }> {
  await ensureService();
  const root = fs.realpathSync(missionNotebookRoot());
  const dataDir = folderDataDirectory(root);
  const clean = relPath.replace(/^\/+/, '');
  let target: string | undefined;
  if (clean.startsWith('asset/')) {
    const raw = clean.slice(6).split('/').map(decodeURIComponent).join('/');
    target = assetPath(dataDir, `asset://local/${raw}`, root);
  } else if (clean.startsWith('workspace/')) {
    const raw = clean.slice(10).split('/').map(decodeURIComponent).join('/');
    target = withinFolder(root, raw);
  } else {
    throw new Error('Unknown Mission Notebook asset namespace');
  }
  const real = fs.realpathSync(target);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('Mission Notebook asset escapes workspace');
  }
  if (!fs.statSync(real).isFile()) {
    throw new Error('Mission Notebook asset is not a file');
  }
  return { path: real, bytes: fs.readFileSync(real), mimeType: mimeType(real) };
}

export { mimeType as missionNotebookMimeType, setNotebookPdfRenderer } from './files';

export function closeMissionNotebook(): void {
  if (runtime) {
    runtime.service.stopScheduler();
    runtime = null;
  }
}
