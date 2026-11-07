const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWorkspace } = require('../electron/storage.cjs');

const workspace = pages => ({ version: 1, name: 'Tree validation', pages, settings: {}, expanded: [], recent: [] });
const page = (id, parentId = null) => ({ id, parentId, title: id, blocks: [], values: {} });

test('storage validates a reversed deep tree with one parent read per page', () => {
  let reads = 0;
  const pages = Array.from({ length: 20000 }, (_, i) => {
    const value = page(`p${i}`);
    Object.defineProperty(value, 'parentId', { get: () => { reads++; return i ? `p${i - 1}` : null; } });
    return value;
  }).reverse();
  const state = workspace(pages);
  assert.equal(validateWorkspace(state), state);
  assert.equal(reads, pages.length);
});

test('storage rejects self loops, indirect cycles and missing ancestors after shared valid chains', () => {
  const common = [page('root'), page('left', 'root'), page('right', 'root')];
  assert.throws(() => validateWorkspace(workspace([...common, page('self', 'self')])), /层级无效/);
  assert.throws(() => validateWorkspace(workspace([...common, page('x', 'y'), page('y', 'z'), page('z', 'x')])), /层级无效/);
  assert.throws(() => validateWorkspace(workspace([...common, page('tail', 'middle'), page('middle', 'missing')])), /层级无效/);
  assert.throws(() => validateWorkspace(workspace([...common, page('root')])), /页面数据无效/);
  assert.doesNotThrow(() => validateWorkspace(workspace([...common, page('leaf', 'right')])));
});
