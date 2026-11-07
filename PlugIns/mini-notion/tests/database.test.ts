import test from 'node:test';
import assert from 'node:assert/strict';
import { makePage } from '../src/model.ts';
import { moveManualRecord } from '../src/database/manualOrdering.ts';
import { validateViewFields } from '../src/core/viewSchema.ts';
import {
  activeView,
  aggregateRows,
  getViews,
  groupRows,
  matchesFilters,
  newView,
  queryRows,
  selectView,
  updateView,
  valueForGroup,
  visibleColumns,
  conditionalColor,
  removeViewProperty,
} from '../src/database/model.ts';
import type { Database, DatabaseView, FilterGroup } from '../src/types.ts';

const db: Database = {
  view: 'table',
  columns: [
    { id: 'status', name: '状态', type: 'select', options: ['未开始', '进行中', '完成'] },
    { id: 'amount', name: '金额', type: 'number' },
    { id: 'date', name: '日期', type: 'date' },
    { id: 'done', name: '完成', type: 'checkbox' },
  ],
};
const root = makePage({ id: 'db', database: db });
const rows = [
  makePage({
    id: 'a',
    parentId: 'db',
    title: '甲',
    values: { status: '完成', amount: 20, date: '2026-09-12', done: true },
  }),
  makePage({
    id: 'b',
    parentId: 'db',
    title: '乙',
    values: { status: '进行中', amount: 8, date: '2026-09-05' },
  }),
  makePage({
    id: 'c',
    parentId: 'db',
    title: '丙',
    values: { status: '进行中', amount: 100, date: '2026-10-01' },
  }),
];
test('legacy workspaces migrate without applying one view filter to every view', () => {
  const legacy = {
    ...db,
    filter: { field: 'title', value: '甲' },
    sort: { field: 'amount', direction: 'desc' as const },
  };
  assert.equal(getViews(legacy).length, 9);
  assert.equal(activeView(legacy).filters?.rules.length, 1);
  assert.equal(getViews(legacy).find((v) => v.type === 'board')?.filters, undefined);
  const changed = updateView(legacy, 'legacy-board', { name: '按状态', groupBy: 'status' });
  const switched = selectView(changed, 'legacy-board');
  assert.equal(activeView(switched).name, '按状态');
  assert.equal(activeView(switched).sorts?.length, 0);
  assert.equal(activeView(selectView(switched, 'legacy-table')).filters?.rules.length, 1);
});
test('multiple views of the same type retain independent configurations', () => {
  const all = newView('table', '全部');
  const mine = newView('table', '进行中');
  const database = { ...db, views: [all, mine], activeViewId: all.id };
  const changed = updateView(database, mine.id, {
    hiddenProperties: ['amount'],
    sorts: [{ id: 's', property: 'date', direction: 'desc' }],
  });
  assert.deepEqual(activeView(changed).hiddenProperties, []);
  assert.deepEqual(activeView(selectView(changed, mine.id)).hiddenProperties, ['amount']);
  assert.equal(activeView(selectView(changed, mine.id)).sorts?.[0].property, 'date');
});
test('nested AND/OR filters combine numeric, date, checkbox and text predicates', () => {
  const filters: FilterGroup = {
    id: 'f',
    conjunction: 'and',
    rules: [
      { id: 'amount', property: 'amount', operator: 'gt', value: '10' },
      {
        id: 'any',
        conjunction: 'or',
        rules: [
          { id: 'done', property: 'done', operator: 'is', value: 'true' },
          { id: 'date', property: 'date', operator: 'before', value: '2026-09-10' },
        ],
      },
    ],
  };
  assert.deepEqual(
    rows.filter((row) => matchesFilters(row, filters, db, rows)).map((row) => row.id),
    ['a'],
  );
  assert.equal(
    matchesFilters(
      rows[1],
      {
        id: 'x',
        conjunction: 'and',
        rules: [{ id: 'rule', property: 'done', operator: 'is', value: 'false' }],
      },
      db,
      rows,
    ),
    true,
  );
});
test('sort priorities use option order and numeric comparison', () => {
  const view = {
    ...newView('table'),
    sorts: [
      { id: 'one', property: 'status', direction: 'asc' as const },
      { id: 'two', property: 'amount', direction: 'desc' as const },
    ],
  };
  assert.deepEqual(
    queryRows(root, view, rows).map((row) => row.id),
    ['c', 'b', 'a'],
  );
  assert.deepEqual(
    queryRows(root, view, rows, '甲').map((row) => row.id),
    ['a'],
  );
});
test('manual card order is independent per view, survives filtering, and yields to explicit sorts', () => {
  const all = newView('board');
  const shifted = moveManualRecord(undefined, rows.map(row => row.id), 'c', 'b');
  assert.deepEqual(shifted, ['a', 'c', 'b']);
  assert.deepEqual(moveManualRecord(shifted, ['a', 'b'], 'a', 'b', true), ['c', 'b', 'a']);
  assert.deepEqual(moveManualRecord(shifted, ['a', 'b', 'c'], 'a', 'a'), shifted);
  assert.deepEqual(queryRows(root, { ...all, manualOrder: shifted }, rows).map(row => row.id), shifted);
  assert.deepEqual(queryRows(root, { ...all, manualOrder: shifted }, rows, '乙').map(row => row.id), ['b']);
  // Hidden/removed records may precede a ranked row; new rows still go last.
  assert.deepEqual(queryRows(root, { ...all, manualOrder: ['gone-1', 'gone-2', 'c'] },
    [rows[1], rows[2]]).map(row => row.id), ['c', 'b']);
  assert.deepEqual(queryRows(root, all, rows).map(row => row.id), ['a', 'b', 'c']);
  assert.doesNotThrow(() => validateViewFields({ manualOrder: ['a', 'b'] }));
  assert.throws(() => validateViewFields({ manualOrder: ['a', 'a'] }));
  assert.throws(() => validateViewFields({ manualOrder: { a: 1 } }));
  assert.doesNotThrow(() => validateViewFields({ colorColumns: true }));
  assert.doesNotThrow(() => validateViewFields({ colorColumns: false }));
  assert.throws(() => validateViewFields({ colorColumns: 'false' }), /只能使用 true 或 false/);
  const sorted = { ...all, manualOrder: shifted, sorts: [{ id: 's', property: 'amount', direction: 'asc' as const }] };
  assert.deepEqual(queryRows(root, sorted, rows).map(row => row.id), ['b', 'a', 'c']);
});

test('group visibility and property ordering do not delete underlying data', () => {
  const view = {
    ...newView('board'),
    groupBy: 'status',
    hideEmptyGroups: true,
    hiddenGroups: ['完成'],
    hiddenProperties: ['amount'],
    propertyOrder: ['date', 'status', 'done', 'amount'],
  };
  assert.deepEqual(
    groupRows(rows, 'status', db, rows, view).map((g) => [g.key, g.rows.length]),
    [['进行中', 2]],
  );
  assert.deepEqual(
    visibleColumns(db, view).map((c) => c.id),
    ['date', 'status', 'done'],
  );
  assert.equal(rows[0].values.amount, 20);
});
test('a new empty category stays visible while the view still hides unrelated empty groups', () => {
  const database: Database = {
    ...db,
    columns: db.columns.map(column => column.id === 'status'
      ? { ...column, options: [...(column.options || []), '待评审', '备用'] }
      : column),
  };
  const view: DatabaseView = {
    ...newView('board'),
    groupBy: 'status',
    hideEmptyGroups: true,
    revealedGroups: ['待评审'],
  };
  const grouped = groupRows(rows, 'status', database, rows, view);
  assert.deepEqual(grouped.map(group => group.key), ['进行中', '完成', '待评审']);
  assert.equal(view.hideEmptyGroups, true);
  assert.deepEqual(
    groupRows(rows, 'status', database, rows, { ...view, hiddenGroups: ['待评审'] })
      .map(group => group.key),
    ['进行中', '完成'],
  );
  assert.deepEqual(
    groupRows(rows, 'amount', database, rows, view).map(group => group.key),
    ['20', '8', '100'],
  );
});

test('aggregates use the actual filtered record set', () => {
  assert.equal(aggregateRows(rows, 'amount', 'sum', db, rows), 128);
  assert.equal(aggregateRows(rows.slice(0, 2), 'amount', 'average', db, rows), 14);
  assert.equal(aggregateRows(rows, 'status', 'count_unique', db, rows), 2);
  assert.equal(aggregateRows(rows, 'date', 'percent_filled', db, rows), 100);
});
test('group moves preserve property types and other multi-select memberships', () => {
  assert.equal(valueForGroup(db.columns[1], '10'), 10);
  assert.equal(valueForGroup(db.columns[3], '未勾选'), false);
  assert.deepEqual(valueForGroup({ id: 'tags', name: '标签', type: 'multiSelect' }, 'C', ['A', 'B'], 'A'), [
    'B',
    'C',
  ]);
});

test('formula sorts read each row once and recompute on the next query', () => {
  const database: Database = {
    view: 'table',
    columns: [
      { id: 'n', name: 'Number', type: 'number' },
      {
        id: 'formula',
        name: 'Twice',
        type: 'formula',
        formula: 'prop("Number") * 2',
      },
    ],
  };
  const parent = makePage({ id: 'sorting', database });
  let reads = 0;
  const records = Array.from({ length: 200 }, (_, index) => {
    const row = makePage({ parentId: parent.id });
    Object.defineProperty(row.values, 'n', {
      configurable: true,
      get: () => {
        reads++;
        return (index * 71) % 200;
      },
    });
    return row;
  });
  const pages = [parent, ...records];
  const view = { ...newView('table'), sorts: [{ id: 's', property: 'formula', direction: 'asc' as const }] };
  assert.equal(queryRows(parent, view, pages)[0], records[0]);
  assert.equal(reads, records.length);
  Object.defineProperty(records[0].values, 'n', { value: 1000 });
  assert.equal(queryRows(parent, view, pages).at(-1), records[0]);
  assert.equal(aggregateRows(records, 'formula', 'count', database, pages), records.length);
  assert.equal(reads, records.length * 2 - 1);
});

test('column calculations include median, range and empty percentage', () => {
  assert.equal(aggregateRows(rows, 'amount', 'median', db, rows), 20);
  assert.equal(aggregateRows(rows.slice(0, 2), 'amount', 'median', db, rows), 14);
  assert.equal(aggregateRows(rows, 'amount', 'range', db, rows), 92);
  const empty = makePage({ values: { amount: '' } });
  assert.equal(aggregateRows([...rows, empty], 'amount', 'percent_empty', db, rows), 25);
  assert.equal(aggregateRows([], 'amount', 'median', db, []), 0);
});

test('conditional colors reuse nested filters, honor priority and keep cell targets local to tables', () => {
  const filter: FilterGroup = {
    id: 'color-filter',
    conjunction: 'and',
    rules: [
      { id: 'amount', property: 'amount', operator: 'gte', value: '20' },
      {
        id: 'status',
        conjunction: 'or',
        rules: [
          { id: 'completed', property: 'status', operator: 'is', value: '完成' },
          { id: 'done', property: 'done', operator: 'is', value: 'true' },
        ],
      },
    ],
  };
  const view: DatabaseView = {
    ...newView('table'),
    conditionalColors: [
      {
        id: 'empty-draft',
        color: 'yellow',
        filter: { id: 'draft', conjunction: 'and', rules: [{ id: 'nested', conjunction: 'or', rules: [] }] },
      },
      { id: 'first', color: 'red', filter },
      { id: 'second', color: 'blue', filter },
      { id: 'cell', color: 'green', filter, targetProperty: 'amount' },
    ],
  };
  assert.equal(conditionalColor(rows[0], view, db, rows), 'red');
  assert.equal(conditionalColor(rows[1], view, db, rows), undefined);
  assert.equal(conditionalColor(rows[2], view, db, rows), undefined);
  assert.equal(conditionalColor(rows[0], view, db, rows, 'amount'), 'green');
  assert.equal(conditionalColor(rows[0], view, db, rows, 'status'), undefined);
  assert.equal(conditionalColor(rows[0], { ...view, type: 'board' }, db, rows), 'red');
  assert.equal(conditionalColor(rows[0], { ...view, type: 'board' }, db, rows, 'amount'), undefined);
  assert.equal(conditionalColor(rows[0], { ...view, type: 'chart' }, db, rows), undefined);
  assert.equal(
    conditionalColor(rows[0], { ...view, conditionalColors: view.conditionalColors!.toReversed() }, db, rows),
    'blue',
  );
  assert.equal(removeViewProperty(view, 'amount').conditionalColors!.length, 1);
  assert.equal(conditionalColor(rows[0], removeViewProperty(view, 'status'), db, rows), undefined);
});
