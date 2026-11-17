import { booleanSchema, nonemptySchema, objectSchema, textSchema } from './api-schema.ts';
import type { CliSpec } from './cli-contract';

export type LibrarySection = 'overview' | 'files' | 'search' | 'reader' | 'hosts';
export type LibraryDomainId =
  | 'employees'
  | 'privateChats'
  | 'groupsAndChannels'
  | 'reader'
  | 'notebook'
  | 'shared'
  | 'hosts';

export type LibraryDomainSummary = {
  id: LibraryDomainId;
  name: string;
  description: string;
  section: LibrarySection;
  assetRootId?: string;
  path?: string;
  bytes: number;
  fileCount: number;
  itemCount: number;
  remoteCount?: number;
  decoupled?: boolean;
  readOnly?: boolean;
};

export type LibraryFileHighlight = {
  id: string;
  name: string;
  path: string;
  assetId: string;
  domain: LibraryDomainId;
  domainLabel: string;
  kind: string;
  bytes: number;
  modifiedAt: number;
  storage: 'local' | 'remote' | 'cloud';
  ownerLabel: string;
  employeeId?: string;
  conversation?: string;
  hostId?: string;
  canOpenInReader: boolean;
};

export type LibraryOverview = {
  totalBytes: number;
  totalFiles: number;
  domains: LibraryDomainSummary[];
  byKind: Array<{ kind: string; count: number; bytes: number }>;
  recentFiles: LibraryFileHighlight[];
  largestFiles: LibraryFileHighlight[];
  reader: {
    root: string;
    documentCount: number;
    studySetCount: number;
    cardCount: number;
    reviewDueCount: number;
    revision: number;
  };
  notebook: {
    root: string;
    pageCount: number;
    revision: number;
  };
  hosts: {
    total: number;
    connected: number;
    osBreakdown: Record<string, number>;
  };
  generatedAt: number;
};

export type LibrarySearchDomain = 'files' | 'content' | 'conversations' | 'notebook' | 'reader' | 'hosts';

export type LibrarySearchItem = {
  id: string;
  domain: LibrarySearchDomain;
  title: string;
  subtitle: string;
  snippet?: string;
  line?: number;
  kind: string;
  bytes?: number;
  modifiedAt?: number;
  assetId?: string;
  assetPath?: string;
  conversation?: string;
  messageId?: string;
  pageId?: string;
  documentId?: string;
  studySetId?: string;
  hostId?: string;
  employeeId?: string;
  storage?: 'local' | 'remote' | 'cloud';
  score: number;
  canOpenInReader?: boolean;
};

export type LibrarySearchResponse = {
  query: string;
  total: number;
  countsByDomain: Record<LibrarySearchDomain, number>;
  indexing: boolean;
  items: LibrarySearchItem[];
};

export type ReaderSessionView = {
  id: string;
  plugin: 'library-reader';
  name: string;
  workspace: string;
  clientId?: string;
  url: string;
  document?: any;
  studySet?: any;
};

const READER_READ_ONLY_METHODS = new Set([
  'system.info',
  'system.fonts',
  'settings.get',
  'appearance.get',
  'document.list',
  'document.get',
  'document.content',
  'document.preview',
  'document.av.info',
  'toc.get',
  'bookmark.list',
  'reader.position.get',
  'reader.ink.get',
  'reader.annotation.list',
  'reader.reading.get',
  'reader.outline.get',
  'study.list',
  'study.get',
  'study.library.get',
  'study.mindmap.pitch.plan',
  'link.list',
  'fs.list',
  'fs.tree',
  'fs.read',
  'library.search',
  'speech.voices',
  'dictionary.lookup',
]);

export function readerMethodReadOnly(method: string): boolean {
  return READER_READ_ONLY_METHODS.has(method) || method.endsWith('.get') || method.endsWith('.list');
}

type LibraryCommandDef = {
  name: string;
  args: string;
  summary: string;
  gui: string;
  cli: CliSpec;
  inputSchema: Record<string, unknown>;
};

const accessSchema = objectSchema(
  {
    workspace: textSchema,
    resourceIds: { type: 'array', items: nonemptySchema, minItems: 1, maxItems: 1000, uniqueItems: true },
    employees: {
      type: 'array',
      maxItems: 200,
      items: objectSchema(
        {
          employeeId: nonemptySchema,
          read: booleanSchema,
          write: booleanSchema,
          create: booleanSchema,
        },
        ['employeeId', 'read', 'write', 'create'],
      ),
    },
    updates: {
      type: 'array',
      maxItems: 200000,
      items: objectSchema(
        {
          employeeId: nonemptySchema,
          resourceId: nonemptySchema,
          read: booleanSchema,
          write: booleanSchema,
          create: booleanSchema,
        },
        ['employeeId', 'resourceId', 'read', 'write', 'create'],
      ),
    },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  [],
);

export const LIBRARY_COMMANDS: LibraryCommandDef[] = [
  {
    name: 'library.overview',
    args: '[--refresh]',
    summary: 'User or Secretary: inspect unified visual storage metrics, recent/largest files, Study Reader and Cloud Hosts summaries across all storage domains.',
    gui: '资料库全景统计',
    cli: {},
    inputSchema: objectSchema({ refresh: booleanSchema }, []),
  },
  {
    name: 'library.search',
    args: '[--query TEXT] [--domains JSON] [--kind TYPE] [--employee ID] [--host ID] [--min-bytes N] [--max-bytes N] [--updated-after N] [--sort relevance|recent|largest|name] [--limit N]',
    summary: 'User or Secretary: super-search filenames, full-text content snippets, conversation attachments, Mission Notebook pages, Study Reader documents/cards/mindmaps and Cloud Hosts.',
    gui: '资料库超级搜索',
    cli: { positionals: ['query'] },
    inputSchema: objectSchema(
      {
        query: textSchema,
        domains: {
          type: 'array',
          items: { enum: ['files', 'content', 'conversations', 'notebook', 'reader', 'hosts'] },
          maxItems: 6,
        },
        kind: { enum: ['all', 'folder', 'document', 'image', 'audio', 'video', 'code', 'archive', 'other'] },
        employeeId: nonemptySchema,
        hostId: nonemptySchema,
        minBytes: { type: 'integer', minimum: 0 },
        maxBytes: { type: 'integer', minimum: 0 },
        updatedAfter: { type: 'number', minimum: 0 },
        sort: { enum: ['relevance', 'recent', 'largest', 'name'] },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      [],
    ),
  },
  {
    name: 'reader.status',
    args: '[--workspace PATH]',
    summary: 'Read the built-in Library Study Reader path, document/study-set/card counts and access revision.',
    gui: '精读工作台状态',
    cli: {},
    inputSchema: objectSchema({ workspace: textSchema }, []),
  },
  {
    name: 'reader.guide',
    args: '[TOPIC]',
    summary: 'Read the built-in Study Reader API manual by optional topic.',
    gui: '精读工作台手册',
    cli: { positionals: ['topic'] },
    inputSchema: objectSchema({ topic: textSchema }, []),
  },
  {
    name: 'reader.methods',
    args: '[QUERY]',
    summary: 'Search or list declared Study Reader method schemas (documents, outlines, ink, study sets, cards, FSRS review, mindmaps).',
    gui: '精读工作台方法目录',
    cli: { positionals: ['query'] },
    inputSchema: objectSchema({ query: textSchema }, []),
  },
  {
    name: 'reader.resources',
    args: '[--workspace PATH]',
    summary: 'List Study Reader documents and study sets with effective employee read/write/create rights.',
    gui: '精读文献权限目录',
    cli: {},
    inputSchema: objectSchema({ workspace: textSchema }, []),
  },
  {
    name: 'reader.access',
    args: '[--workspace PATH] [--resources JSON --employees JSON --updates JSON --expected-revision N]',
    summary: 'User or Secretary: inspect or atomically update per-employee read/write/create grants on Study Reader documents and study sets.',
    gui: '精读文献授权管理',
    cli: { aliases: { resourceIds: 'resources' } },
    inputSchema: accessSchema,
  },
  {
    name: 'reader.call',
    args: '<method> [--workspace PATH] [--params JSON] [--state-mode full|delta|none] [--include-envelope]',
    summary: 'Execute a built-in Study Reader operation (document, outline, annotation, study set, card, mindmap, FSRS review or fs) under caller permissions.',
    gui: '精读核心操作',
    cli: { positionals: ['method'] },
    inputSchema: objectSchema(
      {
        method: nonemptySchema,
        workspace: textSchema,
        params: { type: 'object', additionalProperties: true },
        origin: textSchema,
        stateMode: { enum: ['full', 'delta', 'none'] },
        includeEnvelope: booleanSchema,
        viewId: textSchema,
      },
      ['method'],
    ),
  },
  {
    name: 'reader.open',
    args: '[--workspace PATH] [--path PATH] [--document-id ID] [--study-set-id ID] [--import-to-library]',
    summary: 'User or Secretary: open or reuse an internal Study Reader webview/frame session and optionally open a document or study set.',
    gui: '在精读工作台打开',
    cli: {},
    inputSchema: objectSchema(
      {
        workspace: textSchema,
        path: textSchema,
        documentId: nonemptySchema,
        studySetId: nonemptySchema,
        importToLibrary: booleanSchema,
      },
      [],
    ),
  },
  {
    name: 'reader.close',
    args: 'ID',
    summary: 'User or Secretary: close an open Study Reader HTTP session and release any temporary cached document copies.',
    gui: '关闭精读会话',
    cli: { positionals: ['id'], required: ['id'] },
    inputSchema: objectSchema({ id: nonemptySchema }, ['id']),
  },
  {
    name: 'host.resources',
    args: '',
    summary: 'List registered Cloud Hosts and effective employee read/write/create rights.',
    gui: '云主机权限目录',
    cli: {},
    inputSchema: objectSchema({}, []),
  },
  {
    name: 'host.access',
    args: '[--resources JSON --employees JSON --updates JSON --expected-revision N]',
    summary: 'User or Secretary: inspect or atomically update per-employee read/write/create grants on Cloud Hosts.',
    gui: '云主机授权管理',
    cli: { aliases: { resourceIds: 'resources' } },
    inputSchema: objectSchema(
      {
        resourceIds: { type: 'array', items: nonemptySchema, minItems: 1, maxItems: 1000, uniqueItems: true },
        employees: accessSchema.properties.employees,
        updates: accessSchema.properties.updates,
        expectedRevision: { type: 'integer', minimum: 0 },
      },
      [],
    ),
  },
  {
    name: 'host.files',
    args: 'ID --operation list|read|image|info|chunk|write|mkdir|move|trash|restore [--directory DIR] [--path PATH] [--to PATH] [--content TEXT] [--hash HASH] [--create] [--hidden] [--offset N] [--trash-id ID]',
    summary: 'Browse, read, edit, organize, or trash files directly on an authorized registered SSH Cloud Host.',
    gui: '云主机远端文件管理',
    cli: { positionals: ['id'], required: ['id', 'operation'] },
    inputSchema: objectSchema(
      {
        id: nonemptySchema,
        directory: textSchema,
        operation: { enum: ['list', 'read', 'image', 'info', 'chunk', 'write', 'mkdir', 'move', 'trash', 'restore'] },
        path: textSchema,
        to: textSchema,
        content: { type: 'string', maxLength: 4194304 },
        hash: textSchema,
        create: booleanSchema,
        hidden: booleanSchema,
        offset: { type: 'integer', minimum: 0 },
        trashId: textSchema,
      },
      ['id', 'operation'],
    ),
  },
];
