import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCustomEmojis } from '../src/core/icons';
import { searchCustomEmojis } from '../src/core/iconSearch';
import { inlineContentTypes, validateBlocks } from '../src/core/blocks';
import { createWorkspace } from '../src/seed';
import { executeWorkspaceCommand } from '../src/core/commands';
import { validateDomain } from '../src/core/validate';
import { plainText, duplicatePage } from '../src/model';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const custom = {
  id: 'emoji-rocket',
  name: '小火箭',
  url: 'asset://local/rocket.png',
  keywords: 'ship launch',
};
const inline = { type: 'customEmoji', props: { id: custom.id, name: custom.name, url: custom.url } };

test('custom emoji library validates names and image references and searches aliases', () => {
  validateCustomEmojis([custom]);
  assert.deepEqual(searchCustomEmojis([custom], '：ＬＡＵＮＣＨ：'), [custom]);
  assert.deepEqual(searchCustomEmojis([custom], '火箭'), [custom]);
  for (const value of [
    null,
    {},
    [{ ...custom, url: 'javascript:alert(1)' }],
    [{ ...custom, name: '' }],
    [custom, { ...custom, id: 'another' }],
    [
      { ...custom, name: 'rocket' },
      { ...custom, id: 'another', name: 'ＲＯＣＫＥＴ' },
    ],
  ])
    assert.throws(() => validateCustomEmojis(value));
  assert.ok(inlineContentTypes.includes('customEmoji'));
  validateBlocks([{ id: 'valid', type: 'paragraph', content: [inline] }]);
  assert.throws(() =>
    validateBlocks([
      {
        id: 'invalid',
        type: 'paragraph',
        content: [{ type: 'customEmoji', props: { name: 'missing-image' } }],
      },
    ]),
  );
});

test('library settings preserve page references, while documents and copies keep images after library removal', () => {
  const original = createWorkspace();
  let workspace = executeWorkspaceCommand(original, 'settings.set', {
    changes: { customEmojis: [custom] },
  }).workspace!;
  validateDomain(workspace, original);
  assert.equal(workspace.pages, original.pages);
  const created = executeWorkspaceCommand(workspace, 'page.create', {
    title: '图片表情',
    color: 'white',
    icon: custom.url,
    blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '出发', styles: {} }, inline] }],
  });
  workspace = created.workspace!;
  validateDomain(workspace);
  const page = workspace.pages.find((page) => page.id === created.result.id)!;
  assert.equal(plainText(page.blocks), '出发:小火箭:');
  workspace = executeWorkspaceCommand(workspace, 'settings.set', {
    changes: { customEmojis: [] },
  }).workspace!;
  validateDomain(workspace);
  const copy = duplicatePage(workspace, page.id);
  const copied = copy.workspace.pages.find((page) => page.id === copy.id)!;
  assert.equal(copied.icon, custom.url);
  assert.equal(copied.blocks[0].content[1].props.url, custom.url);
  assert.equal(plainText(copied.blocks), '出发:小火箭:');
});

test('headless HTML preserves real inline images and Markdown exports image syntax', async (t) => {
  // The production converter is ESM; its BlockNote dependencies cannot be required as CJS.
  const directory = fs.mkdtempSync(path.resolve('node_modules/.cache/custom-emoji-converter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, 'converter.mjs');
  await build({
    entryPoints: ['src/backend/converter.ts'],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const { parseDocument, serializeDocument } = await import(pathToFileURL(outfile).href);
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Launch ', styles: {} }, inline] }];
  const html = await serializeDocument(blocks, 'html');
  assert.match(html, /<img\b/);
  assert.match(html, /asset:\/\/local\/rocket\.png/);
  const parsed = await parseDocument(html, 'html');
  assert.ok(
    parsed.some(
      (block) =>
        Array.isArray(block.content) &&
        block.content.some((item: any) => item.type === 'customEmoji' && item.props.url === custom.url),
    ),
  );
  const markdown = await serializeDocument(blocks, 'md');
  assert.match(markdown, /!\[:小火箭:\]\(asset:\/\/local\/rocket\.png\)/);
});
