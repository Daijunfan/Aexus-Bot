import { booleanSchema, nonemptySchema, objectSchema, textSchema } from './api-schema.ts';
import type { CliSpec } from './cli-contract';

type NotebookCommandDef = {
  name: string;
  args: string;
  summary: string;
  gui: string;
  cli: CliSpec;
  inputSchema: Record<string, unknown>;
};

export const NOTEBOOK_COMMANDS: NotebookCommandDef[] = [
  {
    name: 'notebook.status',
    args: '',
    summary: 'Read the Mission Super-Notion Notebook workspace path, revision and authorized page counts.',
    gui: 'Mission 笔记本状态',
    cli: {},
    inputSchema: objectSchema({}, []),
  },
  {
    name: 'notebook.guide',
    args: '[TOPIC]',
    summary: 'Read the Mission Super-Notion Notebook API handbook by optional topic (workflow, files, database, views, relations, templates, blocks).',
    gui: 'Mission 笔记本手册',
    cli: { positionals: ['topic'] },
    inputSchema: objectSchema({ topic: textSchema }, []),
  },
  {
    name: 'notebook.methods',
    args: '[QUERY]',
    summary: 'Search or list available Mission Notebook method schemas (page, block, database, record, button, automation, fs, assistant).',
    gui: 'Mission 笔记本方法目录',
    cli: { positionals: ['query'] },
    inputSchema: objectSchema({ query: textSchema }, []),
  },
  {
    name: 'notebook.resources',
    args: '',
    summary: 'List Mission Notebook pages/databases and effective rights; employees see only authorized resources, Secretary sees all.',
    gui: 'Mission 笔记本页面权限目录',
    cli: {},
    inputSchema: objectSchema({}, []),
  },
  {
    name: 'notebook.access',
    args: '[--resources JSON --employees JSON --updates JSON --expected-revision N]',
    summary: 'User or Secretary: read or replace per-employee read/write/create rights on selected Mission Notebook pages; Secretary always has full access.',
    gui: 'Mission 笔记本页面授权',
    cli: { aliases: { resourceIds: 'resources' } },
    inputSchema: objectSchema(
      {
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
    ),
  },
  {
    name: 'notebook.call',
    args: '<method> [--params JSON] [--state-mode full|delta|none] [--include-envelope]',
    summary: 'Execute a Mission Notebook operation (page, block, database, automation, button or fs) under current identity and per-page access grants.',
    gui: 'Mission 笔记本核心操作',
    cli: { positionals: ['method'] },
    inputSchema: objectSchema(
      {
        method: nonemptySchema,
        params: { type: 'object', additionalProperties: true },
        stateMode: { enum: ['full', 'delta', 'none'] },
        includeEnvelope: booleanSchema,
      },
      ['method'],
    ),
  },
  {
    name: 'notebook.asset',
    args: '<asset/...|workspace/...>',
    summary: 'Read a scoped attachment or workspace export file inside the Mission Notebook directory (user only).',
    gui: 'Mission 笔记本附件',
    cli: { positionals: ['path'], required: ['path'] },
    inputSchema: objectSchema({ path: nonemptySchema }, ['path']),
  },
];
