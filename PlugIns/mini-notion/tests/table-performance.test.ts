import test from 'node:test';
import assert from 'node:assert/strict';
import { makePage } from '../src/model.ts';
import { hierarchyRows } from '../src/database/structure.ts';
import { aggregateRows, conditionalColor, groupRows, matchesFilters, newView, queryRows, valueForGroup, visibleColumns } from '../src/database/model.ts';
import { relationIds, subItemsFor } from '../src/database/relations.ts';

test('hierarchy projection preserves ordered roots, collapsed descendants and orphan sub-items', () => {
  const rows = [
    makePage({ id: 'b', subItemOf: 'root' }),
    makePage({ id: 'nested', subItemOf: 'a' }),
    makePage({ id: 'root' }),
    makePage({ id: 'a', subItemOf: 'root' }),
    makePage({ id: 'other', subItemOf: 'filtered-out' }),
  ];
  const view = newView('table');
  assert.deepEqual(hierarchyRows(rows, view).map(entry => [entry.page.id, entry.depth, entry.childCount]), [
    ['root', 0, 2], ['b', 1, 0], ['a', 1, 1], ['nested', 2, 0], ['other', 0, 0],
  ]);
  assert.deepEqual(hierarchyRows(rows, { ...view, collapsedItems: ['a'] }).map(entry => entry.page.id), ['root', 'b', 'a', 'other']);
  assert.deepEqual(hierarchyRows(rows, { ...view, subItemDisplay: 'flat' }).map(entry => entry.page.id), rows.map(row => row.id));
});

test('deep sub-item projection is iterative and reads each parent edge a bounded number of times', () => {
  let reads = 0;
  const rows = Array.from({ length: 12000 }, (_, index) => {
    const page = makePage({ id: `row-${index}` });
    Object.defineProperty(page, 'subItemOf', { get: () => { reads++; return index ? `row-${index - 1}` : null; } });
    return page;
  }).reverse();
  const result = hierarchyRows(rows, newView('table'));
  assert.equal(result.length, rows.length);
  assert.equal(result[0].page.id, 'row-0');
  assert.equal(result.at(-1)!.depth, rows.length - 1);
  assert.ok(reads <= rows.length * 6);
});

test('reverse relationship projections share one linear index per immutable snapshot', () => {
  let reads = 0;
  const rows = Array.from({ length: 12000 }, (_, index) => {
    const page = makePage({ id: `item-${index}` });
    Object.defineProperty(page, 'subItemOf', { get: () => { reads++; return index ? `item-${index - 1}` : null; } });
    Object.defineProperty(page, 'blockedBy', { get: () => { reads++; return index ? [`item-${index - 1}`] : []; } });
    return page;
  });
  const children = { id: 'children', name: 'Children', type: 'relation' as const, system: 'subItems' as const };
  const blocking = { ...children, id: 'blocking', system: 'blocking' as const };
  for (let index = 0; index < rows.length; index++) {
    const expected = index + 1 < rows.length ? [`item-${index + 1}`] : [];
    assert.deepEqual(relationIds(rows[index], children, rows), expected);
    assert.deepEqual(relationIds(rows[index], blocking, rows), expected);
    assert.deepEqual(subItemsFor(rows[index].id, rows).map(page => page.id), expected);
  }
  assert.ok(reads <= rows.length * 4, `read ${reads} edges for ${rows.length} records`);
  const changed = rows.map(page => page.id === 'item-1' ? { ...page, subItemOf: null, blockedBy: [], trashedAt: 1 } : page);
  assert.deepEqual(relationIds(changed[0], children, changed), []);
  assert.deepEqual(relationIds(changed[0], blocking, changed), []);
  assert.deepEqual(relationIds(rows[0], children, rows), ['item-1']);
});

test('wide tables match conditional colors by target instead of scanning every rule for each cell', () => {
  const database = {
    view: 'table' as const,
    columns: [{ id: 'score', name: '得分', type: 'number' as const }],
  };
  const row = makePage({ id: 'color-row', values: { score: 20 } });
  const rules = Array.from({ length: 32 }, (_, index) => ({
    id: `color-${index}`, targetProperty: `field-${index}`, color: 'blue' as const,
    filter: {
      id: `filter-${index}`, conjunction: 'and' as const,
      rules: [{ id: `rule-${index}`, property: 'score', operator: 'gte' as const, value: '10' }],
    },
  }));
  let fullListSearches = 0;
  const watchedRules = new Proxy(rules, {
    get: (items, property, receiver) => property === 'find'
      ? (...args: Parameters<typeof items.find>) => {
          fullListSearches++;
          return Array.prototype.find.apply(items, args);
        }
      : Reflect.get(items, property, receiver),
  });
  const view = { ...newView('table'), conditionalColors: watchedRules };
  let matched = 0;
  for (let record = 0; record < 100; record++) {
    for (let property = 0; property < 48; property++) {
      if (conditionalColor(row, view, database, [row], `field-${property}`)) matched++;
    }
  }
  assert.equal(matched, 3200);
  assert.equal(fullListSearches, 0,
    `sparse conditional colors scanned all rules ${fullListSearches} times`);
  assert.equal(conditionalColor(row, { ...view, type: 'board' }, database, [row], 'field-31'), undefined);
});

test('high-cardinality grouping uses indexed manual order and preserves unranked categories', () => {
  const database = { view: 'table' as const, columns: [{ id: 'category', name: '类别', type: 'text' as const }] };
  const parent = makePage({ id: 'group-db', database });
  const rows = Array.from({ length: 800 }, (_, index) => makePage({
    id: `row-${index}`, parentId: parent.id, values: { category: `类别${index}` },
  }));
  const order = Array.from({ length: 400 }, (_, index) => `类别${399 - index}`);
  let scans = 0;
  Object.defineProperty(order, 'indexOf', {
    get: () => (...args: Parameters<Array<string>['indexOf']>) => {
      scans++;
      return Array.prototype.indexOf.apply(order, args);
    },
  });
  const view = { ...newView('board'), groupOrder: order, hideEmptyGroups: true };
  const grouped = groupRows(rows, 'category', database, [parent, ...rows], view);
  assert.equal(grouped.length, rows.length);
  assert.deepEqual(grouped.slice(0, 3).map(group => group.key), ['类别399', '类别398', '类别397']);
  assert.deepEqual(grouped.slice(400, 403).map(group => group.key), ['类别400', '类别401', '类别402']);
  assert.equal(scans, 0, `manual group order was searched ${scans} times`);
  assert.deepEqual(groupRows(rows, 'category', database, [parent, ...rows],
    { ...view, groupOrder: undefined }).slice(0, 3).map(group => group.key),
    ['类别0', '类别1', '类别2']);
});

test('status boards skip person-label projections while person groups retain names', () => {
  const database = { view: 'board' as const, columns: [
    { id: 'stage', name: '阶段', type: 'select' as const, options: ['待办', '完成'] },
  ] };
  const parent = makePage({ id: 'status-grouping', database });
  const rows = Array.from({ length: 4000 }, (_, index) => makePage({
    id: `status-${index}`, parentId: parent.id,
    values: { stage: index % 2 ? '完成' : '待办' },
  }));
  let unnecessaryFlatMaps = 0;
  Object.defineProperty(rows, 'flatMap', { value: (...args: Parameters<typeof rows.flatMap>) => {
    unnecessaryFlatMaps++;
    return Array.prototype.flatMap.apply(rows, args);
  } });
  const groups = groupRows(rows, 'stage', database, [parent, ...rows], newView('board'));
  assert.deepEqual(groups.map(group => [group.key, group.rows.length]), [['待办', 2000], ['完成', 2000], ['', 0]]);
  assert.equal(unnecessaryFlatMaps, 0, 'ordinary status boards unnecessarily traversed all cards to build person labels');
  const peopleDb = { view: 'board' as const, columns: [{ id: 'owner', name: '负责人', type: 'person' as const }] };
  const peopleRows = [
    makePage({ id: 'owned-one', values: { owner: [{ id: 'person-a', name: '小王' }] } }),
    makePage({ id: 'owned-two', values: { owner: [{ id: 'person-b', name: '小李' }] } }),
  ];
  assert.deepEqual(groupRows(peopleRows, 'owner', peopleDb, peopleRows)
    .filter(group => group.rows.length).map(group => [group.key, group.label]),
  [['person-a', '小王'], ['person-b', '小李']]);
});

test('person-group moves retain complete assignees and honor single-owner constraints', () => {
  const owner = { id: 'owner', name: '负责人', type: 'person' as const, personLimit: 1 as const };
  const alice = { kind: 'person' as const, id: 'alice', name: '小王', email: 'alice@example.test' };
  const bob = { kind: 'person' as const, id: 'bob', name: '小李', email: 'bob@example.test' };
  const charlie = { kind: 'person' as const, id: 'charlie', name: '小周', email: 'charlie@example.test' };
  assert.deepEqual(valueForGroup(owner, bob.id, [alice], alice.id, bob), [bob],
    'single-owner grouping must replace the old assignee with an actual person record');
  assert.deepEqual(valueForGroup({ ...owner, personLimit: undefined }, bob.id,
    [alice, charlie], alice.id, bob), [charlie, bob],
    'multi-owner grouping must preserve unrelated assignees');
  assert.deepEqual(valueForGroup(owner, '', [alice], alice.id), [],
    'unassigned groups must clear the prior single-owner assignment');
});

test('large boards filter hidden and revealed categories without repeated list scans', () => {
  const options = Array.from({ length: 1200 }, (_, index) => `类别${index}`);
  const hidden = options.slice(0, 400);
  const revealed = ['类别1199'];
  let optionScans = 0, hiddenScans = 0, revealedScans = 0;
  Object.defineProperty(options, 'includes', { value: (value: string) => {
    optionScans++; return Array.prototype.includes.call(options, value);
  } });
  Object.defineProperty(hidden, 'includes', { value: (value: string) => {
    hiddenScans++; return Array.prototype.includes.call(hidden, value);
  } });
  Object.defineProperty(revealed, 'includes', { value: (value: string) => {
    revealedScans++; return Array.prototype.includes.call(revealed, value);
  } });
  const database = { view: 'board' as const, columns: [
    { id: 'category', name: '分类', type: 'select' as const, options },
  ] };
  const parent = makePage({ id: 'large-board', database });
  const rows = Array.from({ length: 500 }, (_, index) => makePage({
    id: `card-${index}`, parentId: parent.id, values: { category: `类别${index}` },
  }));
  const view = { ...newView('board'), groupBy: 'category', hideEmptyGroups: true,
    hiddenGroups: hidden, revealedGroups: revealed };
  const groups = groupRows(rows, 'category', database, [parent, ...rows], view);
  assert.equal(groups.length, 101);
  assert.deepEqual(groups.slice(0, 2).map(group => group.key), ['类别400', '类别401']);
  assert.equal(groups.at(-1)?.key, '类别1199');
  assert.equal(optionScans, 0, `board repeatedly searched ${optionScans} configured options`);
  assert.equal(hiddenScans, 0, `board repeatedly searched ${hiddenScans} hidden categories`);
  assert.equal(revealedScans, 0, `board repeatedly searched ${revealedScans} revealed categories`);
});

test('wide view property order and hidden columns use indexed lookups', () => {
  const columns = Array.from({ length: 320 }, (_, index) => ({
    id: `field-${index}`, name: `属性${index}`, type: 'text' as const,
  }));
  const order = Array.from({ length: 260 }, (_, index) => `field-${259 - index}`);
  const hidden = Array.from({ length: 100 }, (_, index) => `field-${index * 3}`);
  const hiddenSet = new Set(hidden), rankedSet = new Set(order);
  const expected = [
    ...order.filter(id => !hiddenSet.has(id)),
    ...columns.map(column => column.id).filter(id => !hiddenSet.has(id) && !rankedSet.has(id)),
  ];
  let orderSearches = 0, hiddenSearches = 0;
  Object.defineProperty(order, 'indexOf', {
    value: (value: string) => { orderSearches++; return Array.prototype.indexOf.call(order, value); },
  });
  Object.defineProperty(hidden, 'includes', {
    value: (value: string) => { hiddenSearches++; return Array.prototype.includes.call(hidden, value); },
  });
  const database = { view: 'table' as const, columns };
  const view = { ...newView('table'), propertyOrder: order, hiddenProperties: hidden };
  assert.deepEqual(visibleColumns(database, view).map(column => column.id), expected);
  assert.equal(orderSearches, 0, `wide view repeatedly searched column order ${orderSearches} times`);
  assert.equal(hiddenSearches, 0, `wide view repeatedly scanned hidden columns ${hiddenSearches} times`);
});

test('many relation groups look up labels by page ID rather than rescanning all pages', () => {
  const database = { view: 'table' as const, columns: [{ id: 'related', name: '关联', type: 'relation' as const }] };
  const parent = makePage({ id: 'relation-groups', database });
  const targets = Array.from({ length: 600 }, (_, index) =>
    makePage({ id: `related-${index}`, title: `目标${index}` }));
  const rows = targets.map((target, index) => makePage({
    id: `record-${index}`, parentId: parent.id, values: { related: [target.id] },
  }));
  let scans = 0;
  const pages = new Proxy([parent, ...rows, ...targets], {
    get: (items, property, receiver) => property === 'find'
      ? (...args: Parameters<Array<ReturnType<typeof makePage>>['find']>) => {
          scans++;
          return Array.prototype.find.apply(items, args);
        }
      : Reflect.get(items, property, receiver),
  });
  const groups = groupRows(rows, 'related', database, pages,
    { ...newView('board'), hideEmptyGroups: true });
  assert.equal(groups.length, targets.length);
  assert.equal(groups[0].label, '目标0');
  assert.equal(groups[599].label, '目标599');
  assert.equal(scans, 0, `relation group labels scanned the page array ${scans} times`);
});

test('database views reuse one parent-record index for an immutable workspace snapshot', () => {
  const databases = Array.from({ length: 16 }, (_, index) =>
    makePage({ id: `database-${index}`, database: { view: 'table', columns: [] } }));
  let parentReads = 0;
  const records = Array.from({ length: 12000 }, (_, index) => {
    const row = makePage({ id: `record-${index}`, title: `任务${index}` });
    Object.defineProperty(row, 'parentId', {
      enumerable: true,
      get: () => { parentReads++; return databases[index % databases.length].id; },
    });
    return row;
  });
  const pages = [...databases, ...records];
  const view = newView('table');
  for (const database of databases)
    assert.equal(queryRows(database, view, pages).length, 750);
  assert.ok(parentReads <= 30000,
    `16 database views scanned ${parentReads} parent links instead of sharing one workspace index`);
  const changed = pages.map(row => row.id === 'record-0'
    ? { ...row, parentId: databases[1].id } : row);
  assert.equal(queryRows(databases[0], view, changed).length, 749);
  assert.equal(queryRows(databases[1], view, changed).length, 751);
  assert.equal(queryRows(databases[0], view, pages).length, 750,
    'older immutable snapshots must retain their original database membership');
});

test('unique counts identify people, relation pages and files by IDs rather than duplicate labels', () => {
  const database = { view: 'table' as const, columns: [
    { id: 'owner', name: '负责人', type: 'person' as const },
    { id: 'linked', name: '关联', type: 'relation' as const },
    { id: 'attachments', name: '附件', type: 'files' as const },
  ] };
  const targets = [
    makePage({ id: 'linked-a', title: '同名页面' }),
    makePage({ id: 'linked-b', title: '同名页面' }),
  ];
  const person = (id: string) => ({ kind: 'person' as const, id, name: '同名同事', email: '' });
  const file = (id: string) => ({ id, name: '同名附件.pdf', url: `https://example.test/${id}` });
  const rows = [
    makePage({ id: 'entry-a', values: { owner: [person('person-a')], linked: ['linked-a'],
      attachments: [file('file-a')] } }),
    makePage({ id: 'entry-b', values: { owner: [person('person-b')], linked: ['linked-b'],
      attachments: [file('file-b')] } }),
    makePage({ id: 'entry-c', values: { owner: [person('person-a')], linked: ['linked-a'],
      attachments: [file('file-a')] } }),
  ];
  const pages = [...targets, ...rows];
  assert.equal(aggregateRows(rows, 'owner', 'count_unique', database, pages), 2,
    'two distinct people sharing a name are not the same person');
  assert.equal(aggregateRows(rows, 'linked', 'count_unique', database, pages), 2,
    'two distinct linked pages sharing a title are not the same record');
  assert.equal(aggregateRows(rows, 'attachments', 'count_unique', database, pages), 2,
    'two distinct attachments sharing a filename are not the same file');
  assert.equal(aggregateRows(rows, 'owner', 'count_values', database, pages), 3,
    'nonempty-row count semantics must remain unchanged');
});

test('title matches skip expensive database property projections while column search still works', () => {
  const columns = Array.from({ length: 80 }, (_, index) => ({
    id: `field-${index}`, name: `属性${index}`, type: 'text' as const,
  }));
  const database = makePage({ id: 'title-first-search', database: { view: 'table', columns } });
  let propertyReads = 0;
  const rows = Array.from({ length: 500 }, (_, index) => {
    const values: Record<string, string> = {
      'field-79': index === 173 ? '唯一属性结果' : '普通内容',
    };
    Object.defineProperty(values, 'field-0', {
      enumerable: true,
      get: () => { propertyReads++; return '被延迟的昂贵属性'; },
    });
    return makePage({ id: `title-row-${index}`, title: `任务${index}`,
      parentId: database.id, values });
  });
  const pages = [database, ...rows];
  const view = newView('table');
  assert.equal(queryRows(database, view, pages, '任务').length, rows.length);
  assert.equal(propertyReads, 0,
    `title matches should not read columns, but did ${propertyReads} property projections`);
  assert.deepEqual(queryRows(database, view, pages, '唯一属性结果').map(row => row.id), ['title-row-173']);
  assert.ok(propertyReads > 0, 'column searches must still inspect property values when the title does not match');
});

test('wide database search reads each column directly instead of rescanning property definitions', () => {
  let firstColumnReads = 0;
  const columns = Array.from({ length: 72 }, (_, index) => ({
    id: `field-${index}`, name: `属性${index}`, type: 'text' as const,
  }));
  Object.defineProperty(columns[0], 'id', {
    enumerable: true,
    get: () => { firstColumnReads++; return 'field-0'; },
  });
  const database = makePage({ id: 'wide-search', database: { view: 'table', columns } });
  const rows = Array.from({ length: 320 }, (_, index) => makePage({
    id: `record-${index}`,
    parentId: database.id,
    title: `任务${index}`,
    values: { 'field-71': index === 173 ? '唯一检索项' : '普通属性值' },
  }));
  const pages = [database, ...rows];
  assert.deepEqual(
    queryRows(database, newView('table'), pages, '唯一检索项').map(row => row.id),
    ['record-173'],
  );
  assert.ok(firstColumnReads <= rows.length * 2,
    `wide search scanned the first property ${firstColumnReads} times for ${rows.length} rows`);
  assert.deepEqual(queryRows(database, newView('table'), pages, '任务173').map(row => row.id),
    ['record-173']);
});

test('wide database filters and sorts reuse one property lookup per immutable column snapshot', () => {
  let propertyReads = 0;
  const columns = Array.from({ length: 120 }, (_, index) => ({
    id: `field-${index}`, name: `属性${index}`, type: 'text' as const,
  }));
  Object.defineProperty(columns[0], 'id', {
    enumerable: true,
    get: () => { propertyReads++; return 'field-0'; },
  });
  const database = makePage({ id: 'filtered-wide-db', database: { view: 'table', columns } });
  const rows = Array.from({ length: 700 }, (_, index) => makePage({
    id: `row-${index}`, title: `任务${index}`, parentId: database.id,
    values: {
      'field-117': String(index),
      'field-118': '已准备',
      'field-119': index % 7 === 0 ? '优先' : '普通',
    },
  }));
  const pages = [database, ...rows];
  const view = { ...newView('table'), filters: {
    id: 'wide-filters', conjunction: 'and' as const,
    rules: [
      { id: 'tag', property: 'field-119', operator: 'is' as const, value: '优先' },
      { id: 'ready', property: 'field-118', operator: 'is' as const, value: '已准备' },
    ],
  }, sorts: [{ id: 'index', property: 'field-117', direction: 'asc' as const }] };
  const matched = queryRows(database, view, pages);
  assert.equal(matched.length, 100);
  assert.equal(matched[0].id, 'row-0');
  assert.equal(matched.at(-1)!.id, 'row-693');
  assert.ok(propertyReads <= columns.length * 2,
    `wide filters and sorts rescanned columns ${propertyReads} times`);
});


test('template ancestry checks stay linear for deeply nested database records', () => {
  const database = makePage({ id: 'deep-db', database: { view: 'table', columns: [], subItems: true } });
  const depth = 4000;
  let parentReads = 0;
  const rows = Array.from({ length: depth }, (_, index) => {
    const row = makePage({ id: `deep-${index}`, parentId: database.id });
    Object.defineProperty(row, 'subItemOf', {
      enumerable: true,
      get: () => {
        parentReads++;
        return index ? `deep-${index - 1}` : null;
      },
    });
    return row;
  });
  const view = newView('table');
  const pages = [database, ...rows];
  assert.equal(queryRows(database, view, pages).length, depth);
  assert.ok(parentReads <= depth * 8,
    `template ancestry read ${parentReads} links for ${depth} database records`);
  const updated = pages.map(page => page.id === 'deep-2000'
    ? { ...page, templateFor: database.id } : page);
  assert.deepEqual(queryRows(database, view, updated).map(row => row.id),
    rows.slice(0, 2000).map(row => row.id));
  assert.equal(queryRows(database, view, pages).length, depth,
    'immutable older workspace snapshots must preserve their cached template membership');
});

test('unfinished OR filters and nested drafts do not reveal unrelated records or paint rows', () => {
  const database = { view: 'table' as const, columns: [] };
  const pages = ['甲记录', '乙记录', '丙记录'].map((title, index) =>
    makePage({ id: `record-${index}`, title }));
  const match = { id: 'match', property: 'title', operator: 'contains' as const, value: '甲' };
  const draft = { id: 'draft', property: 'title', operator: 'contains' as const, value: '' };
  const filters = { id: 'or-filter', conjunction: 'or' as const, rules: [match, draft] };
  const selected = (group: Parameters<typeof matchesFilters>[1]) =>
    pages.filter(page => matchesFilters(page, group, database, pages)).map(page => page.id);
  assert.deepEqual(selected(filters), ['record-0']);
  assert.deepEqual(selected({ ...filters, conjunction: 'and' }), ['record-0']);
  assert.deepEqual(selected({ ...filters, rules: [draft] }), ['record-0', 'record-1', 'record-2']);
  assert.deepEqual(selected({ ...filters, rules: [match, { ...draft, value: '乙' }] }), ['record-0', 'record-1']);
  assert.deepEqual(selected({ ...filters, rules: [match, {
    id: 'nested', conjunction: 'and' as const, rules: [draft],
  }] }), ['record-0']);
  assert.deepEqual(selected({ ...filters, rules: [{ ...draft, operator: 'empty' as const }] }), []);
  const view = { ...newView('table'), conditionalColors: [
    { id: 'draft-color', color: 'blue' as const, filter: { ...filters, rules: [draft] } },
  ] };
  assert.equal(conditionalColor(pages[0], view, database, pages), undefined);
});

test('text sorting reuses locale collation and preserves numeric Chinese title ordering', () => {
  const database = makePage({ id: 'db', database: { view: 'table', columns: [] } });
  const rows = ['任务20', '任务2', '任务10', '任务1'].map(title => makePage({ title, parentId: database.id }));
  const view = { ...newView('table'), sorts: [{ id: 'title', property: 'title', direction: 'asc' as const }] };
  assert.deepEqual(queryRows(database, view, [database, ...rows]).map(row => row.title), ['任务1', '任务2', '任务10', '任务20']);
  assert.deepEqual(queryRows(database, { ...view, sorts: [{ ...view.sorts[0], direction: 'desc' }] }, [database, ...rows]).map(row => row.title), ['任务20', '任务10', '任务2', '任务1']);
});

test('multi-select sorting follows configured tag order regardless of chosen order', () => {
  const database = makePage({ id: 'tag-sort-db', database: {
    view: 'table',
    columns: [{ id: 'tags', name: '标签', type: 'multiSelect', options: ['待办', '进行中', '完成'] }],
  } });
  const values = [
    ['finished', '已完成', ['完成']],
    ['unknown', '未配置', ['待审核']],
    ['empty', '未选择', []],
    ['doing', '进行中', ['进行中']],
    ['planned', '待办', ['待办']],
    ['mixed', '跨阶段', ['完成', '待办']],
  ] as const;
  const rows = values.map(([id, title, tags]) => makePage({
    id, title, parentId: database.id, values: { tags: [...tags] },
  }));
  const pages = [database, ...rows];
  const view = { ...newView('table'), sorts: [{ id: 'tags', property: 'tags', direction: 'asc' as const }] };
  assert.deepEqual(queryRows(database, view, pages).map(row => row.id),
    ['planned', 'mixed', 'doing', 'finished', 'unknown', 'empty']);
  assert.deepEqual(queryRows(database, { ...view, sorts: [{ ...view.sorts[0], direction: 'desc' }] }, pages)
    .map(row => row.id), ['empty', 'unknown', 'finished', 'doing', 'mixed', 'planned']);
  const selectDatabase = makePage({ id: 'stage-db', database: {
    view: 'table',
    columns: [{ id: 'stage', name: '状态', type: 'select', options: ['待办', '完成'] }],
  } });
  const selected = [
    makePage({ id: 'unknown-stage', parentId: selectDatabase.id, values: { stage: '未配置' } }),
    makePage({ id: 'done-stage', parentId: selectDatabase.id, values: { stage: '完成' } }),
    makePage({ id: 'todo-stage', parentId: selectDatabase.id, values: { stage: '待办' } }),
  ];
  assert.deepEqual(queryRows(selectDatabase, { ...view, sorts: [{ ...view.sorts[0], property: 'stage' }] },
    [selectDatabase, ...selected]).map(row => row.id), ['todo-stage', 'done-stage', 'unknown-stage']);
});

