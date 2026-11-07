import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkspaceCommand } from '../src/core/commands';
import { validateDomain } from '../src/core/validate';
import { createWorkspace } from '../src/seed';
import type { Workspace, DatabaseView } from '../src/types';

test('option rename preserves group visibility, collapse and order in saved and linked views', () => {
  let workspace: Workspace = { ...createWorkspace(), pages: [], activePageId: null };
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const result = executeWorkspaceCommand(workspace, method, params);
    if (result.changed) {
      validateDomain(result.workspace!, workspace);
      workspace = result.workspace!;
    }
    return result.result;
  };
  const source = call('database.create', {
    color: 'white',
    title: 'Group source',
    columns: [
      {
        id: 'stage',
        name: '阶段',
        type: 'status',
        statusGroups: { todo: ['A'], doing: ['B'], done: ['C'] },
        defaultStatus: 'B',
        optionColors: { B: 'blue' },
      },
      { id: 'category', name: '分类', type: 'select', options: ['A', 'B', 'C'] },
    ],
  });
  const row = call('record.create', {
    databaseId: source.id,
    title: 'Existing',
    color: 'white',
    values: { stage: 'B', category: 'B' },
  });
  const groups = { hiddenGroups: ['B'], collapsedGroups: ['B', ''], groupOrder: ['C', 'B', 'A', ''], revealedGroups: ['B'] };
  const grouped = call('view.create', {
    databaseId: source.id,
    type: 'board',
    config: { groupBy: 'stage', ...groups },
  });
  const otherProperty = call('view.create', {
    databaseId: source.id,
    type: 'board',
    config: { groupBy: 'category', subGroupBy: 'stage', ...groups },
  });
  const implicit = call('view.create', { databaseId: source.id, type: 'board', config: groups });
  call('view.update', { databaseId: source.id, viewId: implicit.id, changes: { groupBy: undefined } });
  const unrelated = call('database.create', {
    color: 'white',
    columns: [{ id: 'stage', name: '阶段', type: 'select', options: ['A', 'B', 'C'] }],
  });
  const unrelatedView = call('view.create', {
    databaseId: unrelated.id,
    type: 'board',
    config: { groupBy: 'stage', ...groups },
  });
  const linkedViews: DatabaseView[] = [
    { ...grouped, id: 'linked-stage', type: 'table' },
    { ...otherProperty, id: 'linked-category' },
    { ...implicit, id: 'linked-implicit', groupBy: undefined },
  ];
  const host = call('page.create', {
    title: 'Linked groups',
    color: 'white',
    blocks: [
      {
        type: 'databaseView',
        props: {
          databaseId: source.id,
          linked: true,
          viewState: JSON.stringify({ views: linkedViews, activeViewId: 'linked-stage', view: 'table' }),
        },
      },
    ],
  });
  const before = workspace;
  call('property.update', {
    databaseId: source.id,
    propertyId: 'stage',
    optionRenames: { B: '制作中' },
    changes: {
      statusGroups: { todo: ['A'], doing: ['制作中'], done: ['C'] },
      defaultStatus: '制作中',
      optionColors: { 制作中: 'blue' },
    },
  });
  const expected = {
    hiddenGroups: ['制作中'],
    collapsedGroups: ['制作中', ''],
    groupOrder: ['C', '制作中', 'A', ''],
    revealedGroups: ['制作中'],
  };
  const state = (view: DatabaseView) => ({
    hiddenGroups: view.hiddenGroups,
    collapsedGroups: view.collapsedGroups,
    groupOrder: view.groupOrder,
    revealedGroups: view.revealedGroups,
  });
  const views = call('view.list', { databaseId: source.id });
  assert.deepEqual(state(views.find((view: DatabaseView) => view.id === grouped.id)), expected);
  assert.deepEqual(state(views.find((view: DatabaseView) => view.id === implicit.id)), expected);
  assert.deepEqual(state(views.find((view: DatabaseView) => view.id === otherProperty.id)), groups);
  const linked = JSON.parse(call('page.get', { pageId: host.id }).blocks[0].props.viewState).views;
  assert.deepEqual(state(linked[0]), expected);
  assert.deepEqual(state(linked[1]), groups);
  assert.deepEqual(state(linked[2]), expected);
  assert.deepEqual(
    state(
      call('view.list', { databaseId: unrelated.id }).find(
        (view: DatabaseView) => view.id === unrelatedView.id,
      ),
    ),
    groups,
  );
  assert.equal(call('page.get', { pageId: row.id }).values.stage, '制作中');
  assert.equal(call('page.get', { pageId: row.id }).values.category, 'B');
  assert.ok(
    !call('view.render', { databaseId: source.id, viewId: grouped.id }).groups.some(
      (group: { key: string }) => group.key === '制作中',
    ),
  );
  call('view.update', { databaseId: source.id, viewId: grouped.id, changes: { hiddenGroups: [] } });
  assert.deepEqual(
    call('view.render', { databaseId: source.id, viewId: grouped.id }).groups.map(
      (group: { key: string }) => group.key,
    ),
    ['C', '制作中', 'A', ''],
  );
  assert.equal(
    before.pages.find((page) => page.id === row.id)!.values.stage,
    'B',
    'the previous workspace snapshot is unchanged',
  );
});

test('deleted group option clears stale visibility before recreating the same label', () => {
  let workspace: Workspace = { ...createWorkspace(), pages: [], activePageId: null };
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const result = executeWorkspaceCommand(workspace, method, params);
    if (result.changed) {
      validateDomain(result.workspace!, workspace);
      workspace = result.workspace!;
    }
    return result.result;
  };
  const source = call('database.create', {
    color: 'white',
    columns: [
      { id: 'stage', name: '阶段', type: 'select', options: ['A', 'B'] },
      { id: 'team', name: '团队', type: 'select', options: ['A', 'B'] },
    ],
  });
  const groupState = {
    hiddenGroups: ['B'], collapsedGroups: ['A', 'B'],
    groupOrder: ['B', 'A'], revealedGroups: ['B'], hideEmptyGroups: false,
  };
  const board = call('view.create', {
    databaseId: source.id, type: 'board', config: { groupBy: 'stage', ...groupState },
  });
  const team = call('view.create', {
    databaseId: source.id, type: 'board', config: { groupBy: 'team', ...groupState },
  });
  const host = call('page.create', {
    title: 'Linked board', color: 'white',
    blocks: [{ type: 'databaseView', props: {
      databaseId: source.id, linked: true,
      viewState: JSON.stringify({
        views: [{ ...board, id: 'linked-stage' }, { ...team, id: 'linked-team' }],
        activeViewId: 'linked-stage', view: 'board',
      }),
    } }],
  });
  const row = call('record.create', {
    databaseId: source.id, color: 'white', title: 'Old B',
    values: { stage: 'B', team: 'B' },
  });
  call('property.update', {
    databaseId: source.id, propertyId: 'stage', changes: { options: ['A'] },
  });
  const view = (id: string): DatabaseView =>
    call('view.list', { databaseId: source.id }).find((item: DatabaseView) => item.id === id);
  const linked = (): DatabaseView[] =>
    JSON.parse(call('page.get', { pageId: host.id }).blocks[0].props.viewState).views;
  const cleared = { hiddenGroups: [], collapsedGroups: ['A'], groupOrder: ['A'], revealedGroups: [] };
  for (const candidate of [view(board.id), linked()[0]])
    for (const field of Object.keys(cleared) as (keyof typeof cleared)[])
      assert.deepEqual(candidate[field], cleared[field], field);
  for (const candidate of [view(team.id), linked()[1]])
    for (const field of Object.keys(cleared) as (keyof typeof cleared)[])
      assert.deepEqual(candidate[field], groupState[field], 'unrelated grouping ' + field);
  assert.equal(call('page.get', { pageId: row.id }).values.stage, '');
  assert.equal(call('page.get', { pageId: row.id }).values.team, 'B');

  // Same-name recreation must be visible and must not restore deleted records.
  call('property.update', {
    databaseId: source.id, propertyId: 'stage', changes: { options: ['A', 'B'] },
  });
  const render = call('view.render', { databaseId: source.id, viewId: board.id });
  assert.ok(render.groups.some((group: { key: string }) => group.key === 'B'));
  assert.equal(call('page.get', { pageId: row.id }).values.stage, '');
});
