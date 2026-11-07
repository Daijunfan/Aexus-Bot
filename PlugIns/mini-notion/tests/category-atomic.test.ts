import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkspaceCommand } from '../src/core/commands';
import { createWorkspace } from '../src/seed';
import type { Workspace } from '../src/types';

test('atomic category edits preserve new options, records and group metadata', () => {
  let ws: Workspace = { ...createWorkspace(), pages: [], activePageId: null };
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const operation = executeWorkspaceCommand(ws, method, params);
    if (operation.changed) ws = operation.workspace!;
    return operation.result;
  };
  const db = call('database.create', { color: 'white', columns: [
    { id: 'status', name: '状态', type: 'status',
      statusGroups: { todo: ['待办'], doing: ['处理中'], done: ['完成'] }, defaultStatus: '待办' },
  ] });
  const row = call('record.create', { databaseId: db.id, color: 'white',
    title: '保留记录', values: { status: '处理中' } });
  const view = call('view.create', { databaseId: db.id, type: 'board',
    config: { groupBy: 'status', hiddenGroups: ['处理中'], groupOrder: ['处理中', '待办'] } });
  const option = (optionEdit: Record<string, unknown>) =>
    call('property.update', { databaseId: db.id, propertyId: 'status', optionEdit });
  const property = () => call('property.list', { databaseId: db.id })[0];
  const currentView = () => call('view.list', { databaseId: db.id })
    .find((item: { id: string }) => item.id === view.id);
  option({ kind: 'create', name: '审核', bucket: 'doing', color: 'blue' });
  option({ kind: 'create', name: '待发布', bucket: 'done', color: 'green' });
  assert.deepEqual(property().options, ['待办', '处理中', '审核', '完成', '待发布']);
  option({ kind: 'update', value: '处理中', name: '执行', bucket: 'done', color: 'red' });
  assert.equal(call('page.get', { pageId: row.id }).values.status, '执行');
  assert.deepEqual(currentView().hiddenGroups, ['执行']);
  assert.deepEqual(currentView().groupOrder[0], '执行');
  assert.deepEqual(property().statusGroups.done, ['完成', '待发布', '执行']);
  assert.throws(() => option({ kind: 'update', value: '处理中', name: '旧版本覆盖' }), /已被修改或删除/);
  assert.throws(() => option({ kind: 'create', name: '审核' }), /已存在/);
  option({ kind: 'delete', value: '执行' });
  assert.equal(call('page.get', { pageId: row.id }).values.status, '待办');
  assert.deepEqual(currentView().hiddenGroups, []);
  option({ kind: 'create', name: '执行', bucket: 'doing' });
  assert.equal(currentView().hiddenGroups.includes('执行'), false);
  assert.equal(call('page.get', { pageId: row.id }).title, '保留记录');

  call('view.update', { databaseId: db.id, viewId: view.id,
    changes: { hideEmptyGroups: true } });
  call('property.update', { databaseId: db.id, propertyId: 'status',
    optionEdit: { kind: 'create', name: '单独显示', bucket: 'doing' },
    revealViewId: view.id });
  assert.equal(currentView().hideEmptyGroups, true);
  assert.deepEqual(currentView().revealedGroups, ['单独显示']);
  assert.ok(call('view.render', { databaseId: db.id, viewId: view.id })
    .groups.some((item: { key: string }) => item.key === '单独显示'));
  assert.throws(() => call('property.update', { databaseId: db.id, propertyId: 'status',
    optionEdit: { kind: 'create', name: '错误输入' },
    changes: { options: [] } }), /不能与整列属性修改/);
});
