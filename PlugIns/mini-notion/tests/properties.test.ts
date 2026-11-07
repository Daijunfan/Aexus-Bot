import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkspaceCommand } from '../src/core/commands.ts';
import { createWorkspace } from '../src/seed.ts';
import { computeProperty, readProperty } from '../src/database/propertiesModel.ts';
import { planProjection } from '../src/database/dates.ts';
import { finalizeProperties } from '../src/database/propertyData.ts';
import { diffWorkspace } from '../src/core/patch.ts';
import { validateDomain } from '../src/core/validate.ts';
import type { Workspace, Property, ConditionalColorRule } from '../src/types.ts';
function fixture() {
  let workspace: Workspace = { ...createWorkspace(), pages: [], activePageId: null };
  return {
    get workspace() {
      return workspace;
    },
    set workspace(value: Workspace) {
      workspace = value;
    },
    call(method: string, params: any = {}) {
      const result = executeWorkspaceCommand(workspace, method, params);
      if (result.changed) workspace = result.workspace!;
      return result.result;
    },
  };
}

test('settings and navigation retain page identities without rewriting authors or unique IDs', () => {
  const f = fixture();
  const database = f.call('database.create', {
    color: 'white',
    columns: [{ id: 'uid', name: 'ID', type: 'uniqueId' }],
  });
  const row = f.call('record.create', { databaseId: database.id, title: 'Existing', color: 'white' });
  const before = f.workspace;
  const after = {
    ...before,
    activePageId: row.id,
    settings: { ...before.settings, authorName: 'New author' },
  };
  assert.equal(finalizeProperties(before, after, 'settings.set'), after);
  assert.equal(after.pages, before.pages);
  assert.equal(after.uniqueIds, before.uniqueIds);
  assert.equal(after.pages.find((page) => page.id === row.id)?.editedBy?.name, row.editedBy.name);
  f.call('settings.set', { changes: { authorName: 'Renamed', theme: 'dark' } });
  assert.equal(f.workspace.pages, before.pages);
  assert.equal(f.workspace.uniqueIds, before.uniqueIds);

  const changedLedger = {
    ...after,
    uniqueIds: { ...after.uniqueIds, [database.id]: { next: 99, pages: {} } },
  };
  const reconciled = finalizeProperties(before, changedLedger, 'workspace.patch');
  assert.equal(reconciled.uniqueIds![database.id].next, 99);
  assert.equal(reconciled.uniqueIds![database.id].pages[row.id], row.uniqueId.number);
  const imported = {
    ...after,
    pages: after.pages.map((page) =>
      page.id === row.id
        ? {
            ...page,
            values: { ...page.values, uid: 12345 },
          }
        : page,
    ),
  };
  const normalized = finalizeProperties(imported, imported, 'normalize');
  assert.equal(Object.hasOwn(normalized.pages.find((page) => page.id === row.id)!.values, 'uid'), false);
});

test('conditional colors persist independently per view, project through the API and track renamed properties', () => {
  const f = fixture();
  const database = f.call('database.create', {
    color: 'white',
    columns: [{ id: 'status', name: 'Status', type: 'select', options: ['Ready', 'Done'] }],
  });
  const row = f.call('record.create', {
    color: 'white',
    databaseId: database.id,
    values: { status: 'Ready' },
  });
  const view = f.call('view.list', { databaseId: database.id })[0];
  const rules: ConditionalColorRule[] = [
    {
      id: 'ready',
      color: 'red',
      filter: {
        id: 'filter',
        conjunction: 'and',
        rules: [{ id: 'r', property: 'status', operator: 'is', value: 'Ready' }],
      },
    },
  ];
  f.call('view.update', { databaseId: database.id, viewId: view.id, changes: { conditionalColors: rules } });
  const copy = f.call('view.duplicate', { databaseId: database.id, viewId: view.id });
  f.call('view.update', {
    databaseId: database.id,
    viewId: copy.id,
    changes: {
      conditionalColors: [{ ...rules[0], color: '#123456', targetProperty: 'status' }],
    },
  });
  f.workspace = JSON.parse(JSON.stringify(f.workspace));
  validateDomain(f.workspace);
  assert.equal(
    f
      .call('view.render', { databaseId: database.id, viewId: view.id })
      .records.find((record) => record.id === row.id).conditionalColor,
    'red',
  );
  assert.deepEqual(
    f.call('view.render', { databaseId: database.id, viewId: copy.id }).records[0].conditionalPropertyColors,
    { status: '#123456' },
  );
  f.call('property.update', {
    databaseId: database.id,
    propertyId: 'status',
    changes: { options: ['Queued', 'Done'] },
    optionRenames: { Ready: 'Queued' },
  });
  assert.equal(
    f.call('view.render', { databaseId: database.id, viewId: view.id }).records[0].conditionalColor,
    'red',
  );
  f.call('property.delete', { databaseId: database.id, propertyId: 'status' });
  assert.equal(
    f.call('view.list', { databaseId: database.id }).find((item) => item.id === view.id).conditionalColors
      .length,
    0,
  );
  assert.equal(
    f.call('view.list', { databaseId: database.id }).find((item) => item.id === copy.id).conditionalColors
      .length,
    0,
  );
});

test('rollup algorithms remain available through property commands, formulas and persisted records', () => {
  const f = fixture();
  const target = f.call('database.create', {
    color: 'white',
    title: 'Rollup source',
    columns: [
      { id: 'amount', name: 'Amount', type: 'number' },
      { id: 'date', name: 'Date', type: 'date' },
      { id: 'tags', name: 'Tags', type: 'multiSelect', options: ['A', 'B'] },
    ],
  });
  const source = f.call('database.create', {
    color: 'white',
    title: 'Rollup result',
    columns: [{ id: 'related', name: 'Related', type: 'relation', relationTo: target.id }],
  });
  const values = [
    { amount: 0, date: '2026-01-01', tags: ['A', 'B'] },
    { amount: 2, date: '2026-01-05', tags: ['A'] },
    { amount: 8, date: { start: '2026-01-02', end: '2026-01-07' }, tags: [] },
    { amount: 2 },
    {},
  ];
  const records = values.map((values) =>
    f.call('record.create', { databaseId: target.id, values, color: 'white' }),
  );
  const result = f.call('record.create', {
    databaseId: source.id,
    color: 'white',
    values: { related: records.map((row) => row.id).reverse() },
  });
  const add = (calculation: Property['calculation'], targetProperty = 'amount') =>
    f.call('property.add', {
      databaseId: source.id,
      name: `${targetProperty}_${calculation}`,
      type: 'rollup',
      definition: {
        id: `${targetProperty}_${calculation}`,
        relationProperty: 'related',
        targetProperty,
        calculation,
      },
    });
  const expected: [Property['calculation'], unknown][] = [
    ['count', 5],
    ['count_values', 4],
    ['count_unique', 3],
    ['empty', 1],
    ['count_not_empty', 4],
    ['percent_empty', 20],
    ['percent_filled', 80],
    ['sum', 12],
    ['average', 3],
    ['median', 2],
    ['min', 0],
    ['max', 8],
    ['range', 8],
    ['show_original', [0, 2, 8, 2]],
    ['show', [0, 2, 8]],
  ];
  for (const [calculation, value] of expected) {
    const column = add(calculation);
    assert.deepEqual(computeProperty(result, column, f.workspace.pages), { ok: true, value }, calculation);
  }
  assert.deepEqual(computeProperty(result, add('count_values', 'tags'), f.workspace.pages), {
    ok: true,
    value: 3,
  });
  assert.deepEqual(computeProperty(result, add('count_not_empty', 'tags'), f.workspace.pages), {
    ok: true,
    value: 2,
  });
  const earliest = add('earliest_date', 'date'),
    latest = add('latest_date', 'date');
  assert.deepEqual(computeProperty(result, earliest, f.workspace.pages), {
    ok: true,
    value: new Date('2026-01-01T00:00:00'),
  });
  assert.deepEqual(computeProperty(result, latest, f.workspace.pages), {
    ok: true,
    value: new Date('2026-01-07T00:00:00'),
  });
  const duration = f.call('property.add', {
    databaseId: source.id,
    name: 'Duration',
    type: 'formula',
    formula: 'dateBetween(prop("date_latest_date"), prop("date_earliest_date"), "days")',
  });
  assert.deepEqual(computeProperty(result, duration, f.workspace.pages), { ok: true, value: 6 });
  f.workspace = JSON.parse(JSON.stringify(f.workspace));
  const persisted = f.call('record.list', { databaseId: source.id })[0];
  assert.equal(persisted.computed.amount_median, 2);
  assert.equal(persisted.computed.amount_percent_empty, 20);
  assert.equal(persisted.computed[duration.id], 6);
  f.call('record.update', { pageId: records[2].id, values: { amount: 20 } });
  assert.equal(f.call('record.list', { databaseId: source.id })[0].computed.amount_range, 20);
  f.call('page.trash', { pageId: records[4].id });
  assert.equal(f.call('record.list', { databaseId: source.id })[0].computed.amount_empty, 0);
});
test('status groups preserve custom completed states, defaults, renamed values and planner completion', () => {
  const f = fixture(),
    db = f.call('database.create', {
      color: 'white',
      columns: [
        {
          id: 'status',
          name: '状态',
          type: 'status',
          statusGroups: { todo: ['排队'], doing: ['制作', '审核'], done: ['已交付', '已取消'] },
          defaultStatus: '排队',
        },
        { id: 'date', name: '日期', type: 'date' },
      ],
    });
  const a = f.call('record.create', { color: 'white', databaseId: db.id, title: '甲' }),
    b = f.call('record.create', {
      color: 'white',
      databaseId: db.id,
      title: '乙',
      values: { status: '已取消' },
    });
  assert.equal(a.values.status, '排队');
  assert.equal(planProjection(db, { id: 'plan', name: '计划', type: 'plan' }, [a, b]).completed, 1);
  const options = f.call('property.update', {
    databaseId: db.id,
    propertyId: 'status',
    changes: {
      statusGroups: { todo: ['待办'], doing: ['制作', '审核'], done: ['已交付', '已取消'] },
      defaultStatus: '待办',
    },
    optionRenames: { 排队: '待办' },
  });
  assert.deepEqual(options.options, ['待办', '制作', '审核', '已交付', '已取消']);
  assert.equal(f.call('page.get', { pageId: a.id }).values.status, '待办');
  assert.throws(() => f.call('record.update', { pageId: a.id, values: { status: '无效状态' } }), /没有状态/);
});
test('unique IDs include deleted rows, stay reserved across undo and reject manual values', () => {
  const f = fixture(),
    db = f.call('database.create', { color: 'white', columns: [] }),
    first = f.call('record.create', { color: 'white', databaseId: db.id });
  f.call('page.trash', { pageId: first.id });
  const id = f.call('property.add', {
    databaseId: db.id,
    type: 'uniqueId',
    name: '编号',
    definition: { id: 'uid', idPrefix: 'TASK' },
  });
  assert.equal(readProperty(f.call('page.get', { pageId: first.id }), id, f.workspace.pages), 'TASK-1');
  const before = f.workspace,
    second = f.call('record.create', { color: 'white', databaseId: db.id });
  assert.equal(second.uniqueId.number, 2);
  f.workspace = finalizeProperties(
    f.workspace,
    { ...before, uniqueIds: f.workspace.uniqueIds },
    'history.undo',
  );
  const third = f.call('record.create', { color: 'white', databaseId: db.id });
  assert.equal(third.uniqueId.number, 3);
  f.call('page.purge', { pageId: first.id, confirm: true });
  const fourth = f.call('record.create', { color: 'white', databaseId: db.id });
  assert.equal(fourth.uniqueId.number, 4);
  assert.throws(() => f.call('record.update', { pageId: fourth.id, values: { uid: 900 } }), /系统自动填写/);
});
test('concurrent optimistic creates receive distinct IDs from the writer ledger', () => {
  const f = fixture(),
    db = f.call('database.create', {
      color: 'white',
      columns: [{ id: 'uid', name: '编号', type: 'uniqueId' }],
    }),
    base = f.workspace;
  const local = executeWorkspaceCommand(base, 'record.create', {
    color: 'white',
    databaseId: db.id,
    title: 'GUI',
  }).workspace!;
  const remote = f.call('record.create', { color: 'white', databaseId: db.id, title: 'CLI' });
  f.call('workspace.patch', { patch: diffWorkspace(base, local) });
  const rows = f.workspace.pages.filter((page) => page.parentId === db.id);
  assert.equal(rows.find((page) => page.id === remote.id)!.uniqueId!.number, 1);
  assert.equal(rows.find((page) => page.title === 'GUI')!.uniqueId!.number, 2);
});
test('people and files retain structured values, formula semantics, renamed references and immutable authors', () => {
  const f = fixture(),
    person = f.call('person.create', { name: '小林', email: 'lin@example.test' }),
    db = f.call('database.create', {
      color: 'white',
      columns: [
        { id: 'owner', name: '负责人', type: 'person' },
        { id: 'files', name: '附件', type: 'files' },
        { id: 'creator', name: '创建者', type: 'createdBy' },
        { id: 'created', name: '创建时间', type: 'createdTime' },
        {
          id: 'formula',
          name: '邮件',
          type: 'formula',
          formula: 'prop("负责人").map(current.email()).join(",")',
        },
      ],
    });
  const row = f.call('record.create', {
    color: 'white',
    databaseId: db.id,
    values: { owner: [person.id], files: [{ name: '计划.pdf', url: 'https://example.test/plan.pdf' }] },
  });
  assert.equal(row.values.owner[0].name, '小林');
  assert.ok(row.values.files[0].id);
  assert.equal(row.createdBy.name, '我');
  assert.equal(
    readProperty(
      row,
      db.database.columns.find((column: any) => column.id === 'formula'),
      f.workspace.pages,
    ),
    'lin@example.test',
  );
  assert.ok(
    (
      computeProperty(
        row,
        db.database.columns.find((column: any) => column.id === 'created'),
        f.workspace.pages,
      ) as any
    ).value instanceof Date,
  );
  f.call('person.update', { id: person.id, name: '林老师' });
  assert.equal(f.call('page.get', { pageId: row.id }).values.owner[0].name, '林老师');
  f.call('person.delete', { id: person.id });
  assert.equal(f.call('page.get', { pageId: row.id }).values.owner[0].name, '林老师');
  assert.throws(
    () => f.call('record.update', { pageId: row.id, values: { creator: person.name } }),
    /系统自动填写/,
  );
  assert.throws(() => f.call('page.update', { pageId: row.id, changes: { createdAt: 0 } }), /系统管理/);
});

test('renaming status options keeps saved views and button actions aligned', () => {
  const f = fixture(),
    db = f.call('database.create', { color: 'white' }),
    row = f.call('record.create', { color: 'white', databaseId: db.id });
  const button = f.call('button.create', {
    pageId: db.id,
    property: true,
    actions: [{ type: 'set', values: { status: '已完成' } }],
  });
  const view = f.call('view.create', {
    databaseId: db.id,
    type: 'table',
    config: {
      filters: {
        id: 'scope',
        conjunction: 'and',
        rules: [{ id: 'rule', property: 'status', operator: 'is', value: '已完成' }],
      },
    },
  });
  f.call('property.update', {
    databaseId: db.id,
    propertyId: 'status',
    changes: { statusGroups: { todo: ['未开始'], doing: ['进行中'], done: ['已交付'] } },
    optionRenames: { 已完成: '已交付' },
  });
  f.call('button.run', { pageId: row.id, propertyId: button.propertyId });
  assert.equal(f.call('page.get', { pageId: row.id }).values.status, '已交付');
  assert.equal(f.call('view.render', { databaseId: db.id, viewId: view.id }).count, 1);
});
