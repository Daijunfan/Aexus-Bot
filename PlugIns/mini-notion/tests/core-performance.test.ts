import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestors, descendants, makePage, searchPages } from '../src/model.ts';
import { normalizeWorkspace } from '../src/core/normalize.ts';
import { executeWorkspaceCommand, pageSummary } from '../src/core/commands.ts';
import { isTemplatePage } from '../src/model.ts';
import type { Page } from '../src/types.ts';

// Keep the preceding algorithm as an independent oracle for its observable Set order.
function scannedDescendants(pages: Page[], id: string) {
  const found = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const page of pages)
      if (((page.parentId && found.has(page.parentId)) || (page.subItemOf && found.has(page.subItemOf))) && !found.has(page.id)) {
        found.add(page.id);
        changed = true;
      }
  }
  return [...found];
}

test('descendants retain scan ordering for shuffled parent/sub-item graphs and cycles', () => {
  let seed = 771;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 100; run++) {
    const pages = Array.from({ length: 64 }, (_, i) => makePage({ id: `p${i}`, parentId: random(5) ? `p${random(68)}` : null, subItemOf: random(3) ? null : `p${random(68)}` }));
    for (let i = pages.length - 1; i > 0; i--) { const j = random(i + 1); [pages[i], pages[j]] = [pages[j], pages[i]]; }
    const root = `p${random(68)}`;
    assert.deepEqual([...descendants(pages, root)], scannedDescendants(pages, root), `graph ${run}`);
  }
});

test('deep reversed trees traverse each parent edge once and preserve ancestor order', () => {
  let reads = 0;
  const count = 12000;
  const pages = Array.from({ length: count }, (_, i) => {
    const page = makePage({ id: `p${i}` });
    Object.defineProperty(page, 'parentId', { get: () => { reads++; return i ? `p${i - 1}` : null; } });
    return page;
  }).reverse();
  const ids = [...descendants(pages, 'p0')];
  assert.equal(ids.length, count);
  assert.equal(ids[1], 'p1');
  assert.equal(ids.at(-1), `p${count - 1}`);
  assert.equal(reads, count);
  const parents = ancestors(pages, `p${count - 1}`);
  assert.equal(parents.length, count - 1);
  assert.equal(parents[0].id, 'p0');
  assert.equal(parents.at(-1)!.id, `p${count - 2}`);
});

test('search retains scope, phrases, title ranking, internal exclusions and derived properties', () => {
  const pages = [
    makePage({ id: 'root', title: 'Notebook' }),
    makePage({ id: 'db', parentId: 'root', title: 'Tasks', database: { view: 'table', columns: [
      { id: 'hours', name: 'Hours', type: 'number' },
      { id: 'total', name: 'Total', type: 'formula', formula: 'prop("Hours") * 10' },
      { id: 'relation', name: 'Related', type: 'relation', relationTo: 'db' },
    ] } }),
    makePage({ id: 'body', parentId: 'db', title: 'Body result', updatedAt: 20, values: { hours: 17, relation: ['title'] }, blocks: [
      { type: 'syncedBlock', props: { sourceId: 'source' } },
    ] }),
    makePage({ id: 'title', parentId: 'db', title: 'Meeting notes', updatedAt: 10 }),
    makePage({ id: 'source', syncedSource: true, blocks: [{ type: 'paragraph', content: 'Meeting notes 离线' }] }),
    makePage({ id: 'template', parentId: 'db', templateFor: 'db', title: 'Meeting notes' }),
    makePage({ id: 'template-child', parentId: 'template', title: 'Meeting notes' }),
    makePage({ id: 'sub-item', parentId: 'db', subItemOf: 'template-child', title: 'Meeting notes' }),
    makePage({ id: 'trash', title: 'Meeting notes', trashedAt: 1 }),
  ];
  const ids = (query: string, options = {}) => searchPages(pages, query, options).map(page => page.id);
  assert.deepEqual(ids('"meeting notes"'), ['title', 'body']);
  assert.deepEqual(ids('meeting notes', { titleOnly: true }), ['title']);
  assert.deepEqual(ids('离线', { inPageId: 'root' }), ['body']);
  assert.deepEqual(ids('170'), ['body']);
  assert.deepEqual(ids('', { kind: 'database' }), ['db']);
  assert.deepEqual(ids('meeting', { sort: 'edited-desc' }), ['body', 'title']);
  assert.deepEqual(ids('meeting', { before: new Date(15).toISOString() }), ['title']);
  pages.find(page => page.id === 'source')!.blocks = [{ type: 'paragraph', content: 'Changed content' }];
  assert.deepEqual(ids('离线'), []);
  assert.deepEqual(ids('changed content'), ['body']);
  assert.throws(() => ids('', { inPageId: 'missing' }), /搜索范围/);
  assert.throws(() => ids('', { after: 'invalid' }), /搜索日期/);
});

test('empty and title-only searches do not read page bodies', () => {
  const page = makePage({ title: 'Local notes' });
  Object.defineProperty(page, 'blocks', { get: () => { throw new Error('body traversed'); } });
  assert.deepEqual(searchPages([page], ''), [page]);
  assert.deepEqual(searchPages([page], 'notes'), [page]);
  assert.deepEqual(searchPages([page], 'absent', { titleOnly: true }), []);
});

test('metadata-only normalization preserves pages, spaces, ledgers and revision semantics', () => {
  const before = normalizeWorkspace({ version: 1, name: 'Fixture', pages: [makePage({ id: 'root' })], expanded: [], recent: [], activePageId: null, settings: { theme: 'light', sidebarWidth: 248, sidebarHidden: false, spellcheck: false } });
  const after = { ...before, revision: 7, activePageId: 'root', settings: { ...before.settings, theme: 'dark' as const } };
  assert.equal(normalizeWorkspace(after, false, before), after);
  const unversioned = { ...after, revision: undefined };
  const normalized = normalizeWorkspace(unversioned, false, before);
  assert.equal(normalized.revision, 0);
  assert.equal(normalized.pages, before.pages);
  assert.equal(normalized.spaces, before.spaces);
  assert.equal(normalized.uniqueIds, before.uniqueIds);
  const changedSpaces = { ...after, spaces: { ...after.spaces, orphan: after.spaces!.root } };
  assert.equal(normalizeWorkspace(changedSpaces, false, before).spaces!.orphan, undefined);
});

test('indexed page projections preserve tree ordering, scope and visibility options', () => {
  const pages = [
    makePage({ id: 'child-b', parentId: 'root' }),
    makePage({ id: 'root' }),
    makePage({ id: 'grandchild', parentId: 'child-a' }),
    makePage({ id: 'child-a', parentId: 'root' }),
    makePage({ id: 'template', parentId: 'root', templateFor: 'root' }),
    makePage({ id: 'nested-template', parentId: 'template' }),
    makePage({ id: 'subitem', parentId: 'root', subItemOf: 'child-a' }),
    makePage({ id: 'source', parentId: 'root', syncedSource: true }),
    makePage({ id: 'trashed', parentId: 'root', trashedAt: 1 }),
    makePage({ id: 'trashed-child', parentId: 'trashed' }),
    makePage({ id: 'file', parentId: 'root', sourceFile: { path: 'note.md', kind: 'markdown' } as Page['sourceFile'] }),
  ];
  const workspace = { version: 1 as const, name: 'Fixture', pages, expanded: [], recent: [], activePageId: null, settings: { theme: 'light' as const, sidebarWidth: 248, sidebarHidden: false, spellcheck: false } };
  for (const params of [{}, { templates: true }, { internal: true }, { trash: true }, { files: true }, { parentId: 'child-a' }]) {
    for (const folderMode of [true, false]) {
      const visible = (page: Page) => ((params as any).trash || !page.trashedAt) && ((params as any).internal || (!page.syncedSource && ((params as any).templates || !isTemplatePage(page, pages))));
      const referenceTree = (id: string | null): any[] => pages.filter(page => (page.subItemOf || page.parentId) === id && visible(page) && (!folderMode || (params as any).files || !page.sourceFile || page.sourceFile.kind === 'directory')).map(page => ({ ...pageSummary(page), children: referenceTree(page.id) }));
      assert.deepEqual(executeWorkspaceCommand(workspace, 'page.tree', params, { folderMode }).result, referenceTree((params as any).parentId || null));
      assert.deepEqual(executeWorkspaceCommand(workspace, 'page.list', params, { folderMode }).result, pages.filter(page => visible(page) && (!('parentId' in params) || page.parentId === params.parentId)).map(pageSummary));
    }
  }
});

test('deep tree projection is iterative and wide audits preserve sibling order', () => {
  const pages = Array.from({ length: 12000 }, (_, i) => makePage({ id: `p${i}`, parentId: i ? `p${i - 1}` : null }));
  const workspace = { version: 1 as const, name: 'Fixture', pages: [...pages].reverse(), expanded: [], recent: [], activePageId: null, settings: { theme: 'light' as const, sidebarWidth: 248, sidebarHidden: false, spellcheck: false } };
  let tree = executeWorkspaceCommand(workspace, 'page.tree').result;
  for (let i = 0; i < pages.length; i++) { assert.equal(tree.length, 1); assert.equal(tree[0].id, `p${i}`); tree = tree[0].children; }
  assert.deepEqual(tree, []);
  const wide = { ...workspace, pages: pages.map((page, i) => ({ ...page, parentId: i ? 'p0' : null })) };
  const audit = executeWorkspaceCommand(wide, 'page.audit', { pageId: 'p0' }).result;
  assert.equal(audit.pageCount, pages.length);
  assert.equal(audit.maxDepth, 2);
  assert.deepEqual(audit.pages.map((page: Page) => page.id), pages.map(page => page.id));
});
