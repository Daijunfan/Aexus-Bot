import fs from 'node:fs';
import path from 'node:path';
import { assetFileKind } from '../../shared/asset-presentation';
import {
  type LibraryDomainId,
  type LibraryDomainSummary,
  type LibraryFileHighlight,
  type LibraryOverview,
  type LibrarySearchDomain,
  type LibrarySearchItem,
  type LibrarySearchResponse,
} from '../../shared/library-api';
import { APP_HOME } from '../../shared/core-paths';
import { employeeSettings } from '../../shared/types';
import { requireAppAdministrator } from '../authorization';
import { catalog as chatCatalog } from '../chat-group-store';
import { groupMediaRoot } from '../chat-groups';
import { all as queryChannels } from '../channel-store';
import { listCloudHosts } from '../cloud-hosts';
import { workspaceForMember } from '../conversation-workspaces';
import { directFiles, directMediaRoot, directSearch, directStorage } from '../direct-messages';
import { ensureLibraryReaderWorkspace, readerCall, readerStatus } from '../library-reader';
import { missionNotebookRoot, notebookCall, notebookStatus } from '../mission-notebook';
import { sharedDirectory } from '../shared-directory';
import { readStore } from '../store';

const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'yaml',
  'yml',
  'toml',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'css',
  'html',
  'htm',
  'sql',
  'sh',
  'log',
  'tex',
  'xml',
]);

const READER_COMPATIBLE_EXT = new Set([
  'pdf',
  'epub',
  'mobi',
  'azw3',
  'docx',
  'doc',
  'rtf',
  'md',
  'markdown',
  'txt',
  'html',
  'htm',
  'xhtml',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'mp3',
  'm4a',
  'wav',
  'mp4',
  'mov',
  'webm',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.agents-company', '.margin-reader', '.mininotion']);

export function isReaderCompatibleFile(name: string): boolean {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  return READER_COMPATIBLE_EXT.has(ext);
}

type ScannedFile = {
  name: string;
  relPath: string;
  fullPath: string;
  bytes: number;
  modifiedAt: number;
  kind: string;
};

type WalkResult = {
  files: ScannedFile[];
  totalBytes: number;
  fileCount: number;
};

function scanDirectory(
  root: string,
  options: { maxFiles?: number; collectFiles?: boolean; includeHiddenBytes?: boolean } = {},
): WalkResult {
  const result: WalkResult = { files: [], totalBytes: 0, fileCount: 0 };
  if (!root || !fs.existsSync(root)) return result;
  const maxFiles = options.maxFiles ?? 4000;
  const collectFiles = options.collectFiles !== false;
  const stack: Array<{ dir: string; rel: string; hidden: boolean }> = [{ dir: root, rel: '', hidden: false }];
  let visited = 0;

  while (stack.length && visited < maxFiles) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === '.DS_Store') continue;
      if (entry.name.startsWith('.agents-transfer-')) continue;
      if (SKIP_DIRS.has(entry.name)) {
        if (options.includeHiddenBytes && ['.margin-reader', '.mininotion'].includes(entry.name)) {
          const meta = walkBytesOnly(path.join(current.dir, entry.name));
          result.totalBytes += meta;
        }
        continue;
      }
      const fullPath = path.join(current.dir, entry.name);
      const relPath = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const hidden = current.hidden || entry.name.startsWith('.');
      if (entry.isDirectory()) {
        stack.push({ dir: fullPath, rel: relPath, hidden });
      } else if (entry.isFile()) {
        visited++;
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(fullPath);
        } catch {
          continue;
        }
        result.totalBytes += stat.size;
        if (!hidden) {
          result.fileCount++;
          if (collectFiles) {
            result.files.push({
              name: entry.name,
              relPath,
              fullPath,
              bytes: stat.size,
              modifiedAt: stat.mtimeMs,
              kind: assetFileKind(entry.name),
            });
          }
        }
        if (visited >= maxFiles) break;
      }
    }
  }
  return result;
}

function walkBytesOnly(root: string): number {
  let bytes = 0;
  if (!fs.existsSync(root)) return 0;
  const stack = [root];
  let safety = 0;
  while (stack.length && safety < 5000) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        safety++;
        try {
          bytes += fs.lstatSync(full).size;
        } catch {
          /* Ignore transient temp files. */
        }
      }
    }
  }
  return bytes;
}

type DomainRootDescriptor = {
  assetId: string;
  root: string;
  domain: LibraryDomainId;
  domainLabel: string;
  ownerLabel: string;
  employeeId?: string;
  conversation?: string;
  hostId?: string;
  remote?: boolean;
};

function collectDomainRoots(): { descriptors: DomainRootDescriptor[]; privateCount: number; groupCount: number } {
  const store = readStore();
  const descriptors: DomainRootDescriptor[] = [];

  descriptors.push({
    assetId: 'shared',
    root: sharedDirectory(),
    domain: 'shared',
    domainLabel: 'Shared Workspace',
    ownerLabel: 'Shared',
  });

  const activeEmployees = store.sessions.filter((card) => !card.deleting);
  for (const card of activeEmployees) {
    const settings = employeeSettings(store, card);
    descriptors.push({
      assetId: 'employee:' + card.id,
      root: card.cwd,
      domain: 'employees',
      domainLabel: 'Employee Workspaces',
      ownerLabel: card.title,
      employeeId: card.id,
      hostId: settings.mode === 'cloud' ? settings.hostId : undefined,
      remote: settings.mode === 'cloud',
    });
    if (fs.existsSync(directMediaRoot(card.id))) {
      descriptors.push({
        assetId: 'published:direct:' + card.id,
        root: directMediaRoot(card.id),
        domain: 'privateChats',
        domainLabel: 'Private Chat Storage',
        ownerLabel: `${card.title} (Private)`,
        employeeId: card.id,
      });
    }
  }

  const groups = chatCatalog().groups;
  for (const group of groups) {
    const ref = 'group:' + group.id;
    try {
      const ws = workspaceForMember(ref, undefined, false);
      descriptors.push({
        assetId: ref,
        root: ws.root,
        domain: 'groupsAndChannels',
        domainLabel: 'Groups & Channels',
        ownerLabel: group.name,
        conversation: ref,
        hostId: ws.storage?.kind === 'remote' ? ws.storage.hostId : undefined,
        remote: ws.storage?.kind === 'remote',
      });
    } catch {
      /* Ignore missing workspace during scan. */
    }
    const media = groupMediaRoot(group.id);
    if (fs.existsSync(media)) {
      descriptors.push({
        assetId: 'published:group:' + group.id,
        root: media,
        domain: 'groupsAndChannels',
        domainLabel: 'Groups & Channels',
        ownerLabel: `${group.name} / Media`,
        conversation: ref,
      });
    }
  }

  const channels = queryChannels('SELECT id, name FROM channels');
  for (const ch of channels) {
    const ref = 'channel:' + String(ch.id);
    try {
      const ws = workspaceForMember(ref, undefined, false);
      descriptors.push({
        assetId: ref,
        root: ws.root,
        domain: 'groupsAndChannels',
        domainLabel: 'Groups & Channels',
        ownerLabel: String(ch.name),
        conversation: ref,
        hostId: ws.storage?.kind === 'remote' ? ws.storage.hostId : undefined,
        remote: ws.storage?.kind === 'remote',
      });
    } catch {
      /* Ignore channel without materialized local workspace. */
    }
  }

  const readerRoot = ensureLibraryReaderWorkspace();
  descriptors.push({
    assetId: 'reader:library',
    root: readerRoot,
    domain: 'reader',
    domainLabel: 'Study Reader',
    ownerLabel: 'Study Reader',
  });

  const notebookRoot = missionNotebookRoot(APP_HOME);
  if (fs.existsSync(notebookRoot)) {
    descriptors.push({
      assetId: 'notebook:files',
      root: notebookRoot,
      domain: 'notebook',
      domainLabel: 'Mission Notebook',
      ownerLabel: 'Mission Notebook',
    });
  }

  const planAssets = path.join(APP_HOME, 'plan-assets');
  if (fs.existsSync(planAssets)) {
    descriptors.push({
      assetId: 'plan:exports',
      root: planAssets,
      domain: 'notebook',
      domainLabel: 'Mission Notebook',
      ownerLabel: 'Mission Exports',
    });
  }

  return {
    descriptors,
    privateCount: activeEmployees.length,
    groupCount: groups.length + channels.length,
  };
}

export async function libraryOverview(): Promise<LibraryOverview> {
  requireAppAdministrator();
  const { descriptors, privateCount, groupCount } = collectDomainRoots();
  const hosts = listCloudHosts();
  const readerStats = await readerStatus().catch(() => ({
    root: ensureLibraryReaderWorkspace(),
    documentCount: 0,
    studySetCount: 0,
    cardCount: 0,
    reviewDueCount: 0,
    revision: 0,
  }));
  const notebookStats = await notebookStatus().catch(() => ({
    root: missionNotebookRoot(APP_HOME),
    pageCount: 0,
    revision: 0,
  }));

  const domainBytes: Record<LibraryDomainId, number> = {
    employees: 0,
    privateChats: 0,
    groupsAndChannels: 0,
    reader: 0,
    notebook: 0,
    shared: 0,
    hosts: 0,
  };
  const domainFiles: Record<LibraryDomainId, number> = {
    employees: 0,
    privateChats: 0,
    groupsAndChannels: 0,
    reader: 0,
    notebook: 0,
    shared: 0,
    hosts: 0,
  };
  const remoteCounts: Partial<Record<LibraryDomainId, number>> = {};
  const kindMap = new Map<string, { count: number; bytes: number }>();
  const allHighlights: LibraryFileHighlight[] = [];

  for (const desc of descriptors) {
    if (desc.remote) {
      remoteCounts[desc.domain] = (remoteCounts[desc.domain] ?? 0) + 1;
      continue;
    }
    const scanned = scanDirectory(desc.root, {
      maxFiles: 2500,
      collectFiles: true,
      includeHiddenBytes: desc.domain === 'reader' || desc.domain === 'notebook',
    });
    domainBytes[desc.domain] += scanned.totalBytes;
    domainFiles[desc.domain] += scanned.fileCount;

    for (const file of scanned.files) {
      const k = kindMap.get(file.kind) ?? { count: 0, bytes: 0 };
      k.count++;
      k.bytes += file.bytes;
      kindMap.set(file.kind, k);

      allHighlights.push({
        id: `${desc.assetId}|${encodeURIComponent(file.relPath)}`,
        name: file.name,
        path: file.relPath,
        assetId: desc.assetId,
        domain: desc.domain,
        domainLabel: desc.domainLabel,
        kind: file.kind,
        bytes: file.bytes,
        modifiedAt: file.modifiedAt,
        storage: 'local',
        ownerLabel: desc.ownerLabel,
        employeeId: desc.employeeId,
        conversation: desc.conversation,
        hostId: desc.hostId,
        canOpenInReader: isReaderCompatibleFile(file.name),
      });
    }
  }

  // Add decoupled private chat message ledgers & staging uploads without touching employee workspaces
  const store = readStore();
  let privateMessageCount = 0;
  for (const card of store.sessions.filter((c) => !c.deleting)) {
    try {
      const info = directStorage({ employee: card.id });
      domainBytes.privateChats += info.ledgerBytes + info.uploadStagingBytes;
      // mediaBytes already accounted for in published:direct:<id>; if uploadsStaging > 0, count staging files too
      privateMessageCount += info.messageCount;
    } catch {
      /* Ignore unreadable direct storage. */
    }
  }

  const domains: LibraryDomainSummary[] = [
    {
      id: 'employees',
      name: 'Employee Workspaces',
      description: 'Unified Agent coding & artifact workspaces decoupled from private chat storage',
      section: 'files',
      assetRootId: 'agents',
      path: store.preferences?.employeeWorkspacesRoot || '~/Aexus-bot-workspaces',
      bytes: domainBytes.employees,
      fileCount: domainFiles.employees,
      itemCount: descriptors.filter((d) => d.domain === 'employees').length,
      remoteCount: remoteCounts.employees ?? 0,
    },
    {
      id: 'privateChats',
      name: 'Private Chat Storage',
      description: 'Local Mac direct chat attachments, recordings & message logs',
      section: 'files',
      assetRootId: 'messages',
      path: path.join(APP_HOME, 'direct'),
      bytes: domainBytes.privateChats,
      fileCount: domainFiles.privateChats,
      itemCount: privateMessageCount || privateCount,
      decoupled: true,
      readOnly: true,
    },
    {
      id: 'groupsAndChannels',
      name: 'Groups & Channels',
      description: 'Shared group project folders, published attachments & channel archives',
      section: 'files',
      assetRootId: 'messages',
      path: path.join(APP_HOME, 'conversation-workspaces'),
      bytes: domainBytes.groupsAndChannels,
      fileCount: domainFiles.groupsAndChannels,
      itemCount: groupCount,
      remoteCount: remoteCounts.groupsAndChannels ?? 0,
    },
    {
      id: 'reader',
      name: 'Study Reader Library',
      description: 'PDF/EPUB/DOCX/MOBI reading library, excerpts, XMind maps & FSRS cards',
      section: 'reader',
      assetRootId: 'reader:library',
      path: readerStats.root,
      bytes: domainBytes.reader,
      fileCount: domainFiles.reader,
      itemCount: readerStats.documentCount + readerStats.studySetCount,
    },
    {
      id: 'notebook',
      name: 'Mission Notebook & Exports',
      description: 'Notion-grade pages, structured databases, automation & Plan exports',
      section: 'files',
      assetRootId: 'plan',
      path: missionNotebookRoot(APP_HOME),
      bytes: domainBytes.notebook,
      fileCount: domainFiles.notebook,
      itemCount: Number((notebookStats as any).pageCount ?? 0),
    },
    {
      id: 'shared',
      name: 'Shared Workspace',
      description: 'Cross-team exchange hub and dropped reference materials',
      section: 'files',
      assetRootId: 'shared',
      path: sharedDirectory(),
      bytes: domainBytes.shared,
      fileCount: domainFiles.shared,
      itemCount: 1,
    },
    {
      id: 'hosts',
      name: 'Cloud Hosts',
      description: 'SSH servers, SFTP remote directories, fingerprints & live terminals',
      section: 'hosts',
      assetRootId: 'hosts',
      path: path.join(APP_HOME, 'cloud-hosts'),
      bytes: 0,
      fileCount: 0,
      itemCount: hosts.length,
      remoteCount: hosts.length,
    },
  ];

  const osBreakdown: Record<string, number> = {};
  let connected = 0;
  for (const host of hosts) {
    const key = host.os || 'linux';
    osBreakdown[key] = (osBreakdown[key] ?? 0) + 1;
    if (host.status?.connected) connected++;
  }

  const byKind = [...kindMap.entries()]
    .map(([kind, stats]) => ({ kind, count: stats.count, bytes: stats.bytes }))
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count);

  const recentFiles = [...allHighlights].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 16);
  const largestFiles = [...allHighlights].sort((a, b) => b.bytes - a.bytes || b.modifiedAt - a.modifiedAt).slice(0, 12);

  return {
    totalBytes: Object.values(domainBytes).reduce((sum, n) => sum + n, 0),
    totalFiles: Object.values(domainFiles).reduce((sum, n) => sum + n, 0),
    domains,
    byKind,
    recentFiles,
    largestFiles,
    reader: {
      root: readerStats.root,
      documentCount: readerStats.documentCount,
      studySetCount: readerStats.studySetCount,
      cardCount: readerStats.cardCount,
      reviewDueCount: readerStats.reviewDueCount,
      revision: readerStats.revision,
    },
    notebook: {
      root: missionNotebookRoot(APP_HOME),
      pageCount: Number((notebookStats as any).pageCount ?? 0),
      revision: Number((notebookStats as any).revision ?? 0),
    },
    hosts: {
      total: hosts.length,
      connected,
      osBreakdown,
    },
    generatedAt: Date.now(),
  };
}

function buildSnippet(text: string, needleLower: string): { snippet: string; line: number } | null {
  const idx = text.toLowerCase().indexOf(needleLower);
  if (idx < 0) return null;
  const before = text.slice(0, idx);
  const line = before.split('\n').length;
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + needleLower.length + 100);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return {
    snippet: (start > 0 ? '…' : '') + raw + (end < text.length ? '…' : ''),
    line,
  };
}

export async function librarySearch(args: {
  query?: string;
  domains?: LibrarySearchDomain[];
  kind?: string;
  employeeId?: string;
  hostId?: string;
  minBytes?: number;
  maxBytes?: number;
  updatedAfter?: number;
  sort?: 'relevance' | 'recent' | 'largest' | 'name';
  limit?: number;
} = {}): Promise<LibrarySearchResponse> {
  requireAppAdministrator();
  const query = String(args.query ?? '').trim();
  const needle = query.toLowerCase();
  const selectedDomains = new Set<LibrarySearchDomain>(
    args.domains?.length ? args.domains : ['files', 'content', 'conversations', 'notebook', 'reader', 'hosts'],
  );
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 80)));
  const items: LibrarySearchItem[] = [];
  const counts: Record<LibrarySearchDomain, number> = {
    files: 0,
    content: 0,
    conversations: 0,
    notebook: 0,
    reader: 0,
    hosts: 0,
  };

  const { descriptors } = collectDomainRoots();
  const store = readStore();
  const matchesFileConstraints = (bytes?: number, modifiedAt?: number, kind?: string) => {
    if (args.kind && args.kind !== 'all' && kind !== args.kind) return false;
    if (args.minBytes !== undefined && (bytes ?? 0) < args.minBytes) return false;
    if (args.maxBytes !== undefined && (bytes ?? 0) > args.maxBytes) return false;
    if (args.updatedAfter !== undefined && (modifiedAt ?? 0) < args.updatedAfter) return false;
    return true;
  };

  // 1 & 2. Files & Full-Text Content across all mounted local roots
  if (selectedDomains.has('files') || selectedDomains.has('content')) {
    let contentBudget = 240;
    for (const desc of descriptors) {
      if (desc.remote) continue;
      if (args.employeeId && desc.employeeId !== args.employeeId) continue;
      if (args.hostId && desc.hostId !== args.hostId) continue;

      const scanned = scanDirectory(desc.root, { maxFiles: 1200, collectFiles: true });
      for (const file of scanned.files) {
        if (!matchesFileConstraints(file.bytes, file.modifiedAt, file.kind)) continue;
        const assetNodeId = `${desc.assetId}|${encodeURIComponent(file.relPath)}`;
        if (selectedDomains.has('files')) {
          const haystack = `${file.name} ${file.relPath} ${desc.ownerLabel}`.toLowerCase();
          if (!needle || haystack.includes(needle)) {
            const exactName = needle && file.name.toLowerCase() === needle ? 100 : file.name.toLowerCase().includes(needle) ? 75 : 45;
            counts.files++;
            items.push({
              id: 'file:' + assetNodeId,
              domain: 'files',
              title: file.name,
              subtitle: `${desc.domainLabel} · ${desc.ownerLabel} · ${file.relPath}`,
              kind: file.kind,
              bytes: file.bytes,
              modifiedAt: file.modifiedAt,
              assetId: desc.assetId,
              assetPath: file.relPath,
              employeeId: desc.employeeId,
              conversation: desc.conversation,
              hostId: desc.hostId,
              storage: 'local',
              score: needle ? exactName : Math.round(file.modifiedAt / 1e9),
              canOpenInReader: isReaderCompatibleFile(file.name),
            });
          }
        }

        if (selectedDomains.has('content') && needle && contentBudget > 0 && file.bytes > 0 && file.bytes <= 1536 * 1024) {
          const ext = file.name.split('.').at(-1)?.toLowerCase() ?? '';
          if (TEXT_EXTENSIONS.has(ext)) {
            contentBudget--;
            try {
              const raw = fs.readFileSync(file.fullPath, 'utf8');
              const hit = buildSnippet(raw, needle);
              if (hit) {
                counts.content++;
                items.push({
                  id: 'content:' + assetNodeId,
                  domain: 'content',
                  title: file.name,
                  subtitle: `${desc.ownerLabel} · Line ${hit.line} · ${file.relPath}`,
                  snippet: hit.snippet,
                  line: hit.line,
                  kind: file.kind,
                  bytes: file.bytes,
                  modifiedAt: file.modifiedAt,
                  assetId: desc.assetId,
                  assetPath: file.relPath,
                  employeeId: desc.employeeId,
                  conversation: desc.conversation,
                  hostId: desc.hostId,
                  storage: 'local',
                  score: 82,
                  canOpenInReader: isReaderCompatibleFile(file.name),
                });
              }
            } catch {
              /* Skip unreadable or binary files cleanly. */
            }
          }
        }
      }
    }
  }

  // 3. Conversations (private chat messages/attachments)
  if (selectedDomains.has('conversations') && !args.hostId) {
    for (const card of store.sessions.filter((c) => !c.deleting)) {
      if (args.employeeId && card.id !== args.employeeId) continue;
      try {
        if (!args.kind || args.kind === 'all') {
          const found = directSearch({ employee: card.id, ...(query ? { query } : {}), limit: 12 });
          for (const msg of found.items) {
            if (args.updatedAfter !== undefined && msg.createdAt < args.updatedAfter) continue;
            counts.conversations++;
            items.push({
              id: 'direct-msg:' + card.id + ':' + msg.id,
              domain: 'conversations',
              title: msg.text.slice(0, 80) || msg.attachments[0]?.name || 'Private message',
              subtitle: `Private Chat · ${card.title}`,
              snippet: msg.text.slice(0, 180),
              kind: msg.attachments.length ? 'document' : 'other',
              modifiedAt: msg.createdAt,
              conversation: 'employee:' + card.id,
              messageId: msg.id,
              employeeId: card.id,
              storage: 'local',
              score: 68,
            });
          }
        }
        const att = directFiles({ employee: card.id, ...(query ? { query } : {}), limit: 12 });
        for (const f of att.files) {
          const kind = assetFileKind(f.name);
          if (!matchesFileConstraints(f.bytes, f.createdAt, kind)) continue;
          counts.conversations++;
          items.push({
            id: 'direct-file:' + card.id + ':' + f.id,
            domain: 'conversations',
            title: f.name,
            subtitle: `Private Chat Attachment · ${card.title}`,
            kind,
            bytes: f.bytes,
            modifiedAt: f.createdAt,
            conversation: 'employee:' + card.id,
            messageId: f.messageId,
            employeeId: card.id,
            storage: 'local',
            score: 76,
            canOpenInReader: isReaderCompatibleFile(f.name),
          });
        }
      } catch {
        /* Skip employee without initialized direct history. */
      }
    }
  }

  // 4. Mission Notebook Pages & Databases
  if (selectedDomains.has('notebook') && !args.hostId && !args.employeeId && (!args.kind || args.kind === 'all' || args.kind === 'document')) {
    try {
      const ws = (await notebookCall('workspace.get', {})) as { pages?: Array<any> };
      for (const page of (ws?.pages ?? []).filter((p) => !p.trashedAt)) {
        const title = String(page.title ?? 'Untitled');
        const modifiedAt = page.updatedAt ?? page.createdAt;
        if (args.updatedAfter !== undefined && (modifiedAt ?? 0) < args.updatedAfter) continue;
        let snippet: string | undefined;
        let score = 0;
        if (!needle || title.toLowerCase().includes(needle)) {
          score = needle && title.toLowerCase() === needle ? 95 : 80;
        }
        if (needle) {
          try {
            const md = (await notebookCall('page.read-markdown', { pageId: page.id })) as { markdown?: string };
            if (md?.markdown) {
              const hit = buildSnippet(md.markdown, needle);
              if (hit) {
                snippet = hit.snippet;
                score = Math.max(score, 78);
              }
            }
          } catch {
            /* Ignore pages without markdown body. */
          }
        }
        if (!needle || score > 0) {
          counts.notebook++;
          items.push({
            id: 'notebook:' + page.id,
            domain: 'notebook',
            title,
            subtitle: `Mission Notebook · ${page.kind === 'database' ? 'Database' : 'Page'}`,
            snippet,
            kind: 'document',
            modifiedAt,
            pageId: page.id,
            storage: 'local',
            score: score || 50,
          });
        }
      }
    } catch {
      /* Ignore if Mission Notebook is empty or unavailable. */
    }
  }

  // 5. Study Reader Documents, Study Sets, Cards & Mindmaps
  if (selectedDomains.has('reader') && !args.hostId && !args.employeeId && (!args.kind || args.kind === 'all' || args.kind === 'document')) {
    try {
      const docs = (await readerCall('document.list', {})) as { documents?: Array<any> };
      const seenDocIds = new Set<string>();
      if (needle) {
        const readerHits = (await readerCall('library.search', { query, limit: 30 })) as {
          hits?: Array<{
            kind?: string;
            setId?: string;
            cardId?: string;
            documentId?: string;
            title?: string;
            subtitle?: string;
            snippet?: string;
          }>;
        };
        for (const hit of readerHits?.hits ?? []) {
          if (hit.kind === 'card') {
            counts.reader++;
            items.push({
              id: 'reader-card:' + (hit.cardId || randomFallbackId(hit)),
              domain: 'reader',
              title: hit.title || 'Study Card',
              subtitle: `Study Reader Card · ${hit.subtitle || 'Study Set'}`,
              snippet: hit.snippet,
              kind: 'document',
              studySetId: hit.setId,
              storage: 'local',
              score: 86,
              canOpenInReader: true,
            });
          } else {
            const docItemId = 'reader-doc:' + (hit.documentId || randomFallbackId(hit));
            if (seenDocIds.has(docItemId)) continue;
            seenDocIds.add(docItemId);
            counts.reader++;
            items.push({
              id: docItemId,
              domain: 'reader',
              title: hit.title || path.basename(hit.subtitle || 'Document'),
              subtitle: `Study Reader · ${hit.subtitle || 'Document'}`,
              snippet: hit.snippet,
              kind: 'document',
              assetId: 'reader:library',
              assetPath: hit.subtitle,
              documentId: hit.documentId,
              storage: 'local',
              score: 88,
              canOpenInReader: true,
            });
          }
        }
        for (const doc of (docs.documents ?? []).filter((d) => !d.trashed)) {
          const docItemId = 'reader-doc:' + doc.id;
          if (seenDocIds.has(docItemId)) continue;
          const title = String(doc.title ?? '');
          const relPath = String(doc.path ?? '');
          if (`${title} ${relPath}`.toLowerCase().includes(needle)) {
            seenDocIds.add(docItemId);
            counts.reader++;
            items.push({
              id: docItemId,
              domain: 'reader',
              title: title || path.basename(relPath || 'Document'),
              subtitle: `Study Reader · ${relPath || doc.format || 'Document'}`,
              kind: 'document',
              assetId: 'reader:library',
              assetPath: relPath,
              documentId: doc.id,
              storage: 'local',
              score: 84,
              canOpenInReader: true,
            });
          }
        }
      } else {
        for (const doc of (docs.documents ?? []).filter((d) => !d.trashed).slice(0, 20)) {
          counts.reader++;
          items.push({
            id: 'reader-doc:' + doc.id,
            domain: 'reader',
            title: doc.title || path.basename(doc.path || 'Document'),
            subtitle: `Study Reader · ${doc.path || doc.format || 'Document'}`,
            kind: 'document',
            assetId: 'reader:library',
            assetPath: doc.path,
            documentId: doc.id,
            storage: 'local',
            score: 70,
            canOpenInReader: true,
          });
        }
      }
      const studies = (await readerCall('study.list', {})) as { sets?: Array<any>; studySets?: Array<any> };
      for (const set of (studies.sets ?? studies.studySets ?? []).filter((s) => !s.deletedAt)) {
        const title = String(set.title ?? '');
        const desc = String(set.description ?? '');
        if (!needle || `${title} ${desc}`.toLowerCase().includes(needle)) {
          counts.reader++;
          items.push({
            id: 'reader-study:' + set.id,
            domain: 'reader',
            title: title || 'Study Set',
            subtitle: `Study Reader Mindmap · ${set.cardCount ?? 0} cards`,
            snippet: desc || undefined,
            kind: 'document',
            studySetId: set.id,
            modifiedAt: set.updatedAt ?? set.createdAt,
            storage: 'local',
            score: 84,
            canOpenInReader: true,
          });
        }
      }
    } catch {
      /* Ignore if Study Reader workspace has no indexed state yet. */
    }
  }

  // 6. Cloud Hosts
  if (selectedDomains.has('hosts') && !args.employeeId && (!args.kind || args.kind === 'all')) {
    for (const host of listCloudHosts()) {
      if (args.hostId && host.id !== args.hostId) continue;
      if (args.updatedAfter !== undefined && host.updatedAt < args.updatedAfter) continue;
      const haystack = `${host.name} ${host.host} ${host.os} ${host.distribution ?? ''} ${host.defaultDirectory} ${(host.tags ?? []).join(' ')} ${host.notes ?? ''} ${host.vm?.name ?? ''}`.toLowerCase();
      if (!needle || haystack.includes(needle)) {
        counts.hosts++;
        items.push({
          id: 'host:' + host.id,
          domain: 'hosts',
          title: host.name,
          subtitle: `Cloud Host · ${host.os} · ${host.host} · ${host.defaultDirectory}`,
          snippet: host.notes || host.vm?.notes,
          kind: 'folder',
          modifiedAt: host.updatedAt,
          hostId: host.id,
          storage: 'remote',
          score: needle && host.name.toLowerCase().includes(needle) ? 90 : 65,
        });
      }
    }
  }

  const sort = args.sort ?? 'relevance';
  const sorted = items.sort((a, b) => {
    if (sort === 'recent') return (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || b.score - a.score;
    if (sort === 'largest') return (b.bytes ?? 0) - (a.bytes ?? 0) || b.score - a.score;
    if (sort === 'name') return a.title.localeCompare(b.title);
    return b.score - a.score || (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0);
  });

  return {
    query,
    total: sorted.length,
    countsByDomain: counts,
    indexing: false,
    items: sorted.slice(0, limit),
  };
}

function randomFallbackId(match: Record<string, any>): string {
  return String(match.id ?? match.path ?? Math.random().toString(36).slice(2));
}
