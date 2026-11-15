'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pdfResources = require('../lib/pdf-resources.cjs');

function windowsResources() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/pdf-resources.cjs'), 'utf8'), {
    module, require: name => name === 'node:path' ? path.win32 : require(name)
  });
  return module.exports;
}

test('PDF.js Node auxiliary paths have trailing slashes and read the installed resources', () => {
  const options = pdfResources();
  assert.equal(options.cMapPacked, true);
  for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
    assert.ok(options[key].endsWith('/'), key);
    assert.ok(!options[key].startsWith('file:'), 'Node factories pass these strings to fs.readFile');
  }
  assert.ok(fs.readFileSync(options.cMapUrl + 'Adobe-Japan1-UCS2.bcmap').length > 0);
  assert.ok(fs.readFileSync(options.standardFontDataUrl + 'LiberationSans-Regular.ttf').length > 0);
  const wasm = fs.readdirSync(options.wasmUrl).find(name => name.endsWith('.wasm'));
  assert.ok(wasm && fs.readFileSync(options.wasmUrl + wasm).length > 0);
});

test('Windows drive and UNC installations keep readable filesystem paths with forward slashes', () => {
  const resourcePaths = windowsResources();
  const drive = resourcePaths('C:\\Program Files\\Aexus Bot\\资料\\pdfjs-dist');
  assert.equal(drive.cMapUrl, 'C:/Program Files/Aexus Bot/资料/pdfjs-dist/cmaps/');
  assert.equal(drive.standardFontDataUrl, 'C:/Program Files/Aexus Bot/资料/pdfjs-dist/standard_fonts/');
  assert.equal(drive.wasmUrl, 'C:/Program Files/Aexus Bot/资料/pdfjs-dist/wasm/');
  const share = resourcePaths('\\\\server\\shared folder\\pdfjs-dist');
  assert.equal(share.cMapUrl, '//server/shared folder/pdfjs-dist/cmaps/');
});

test('The actual PDF.js API accepts normalized Windows paths where the old backslash form rejects', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await require('pdf-lib').PDFDocument.create();
  document.addPage([100, 120]);
  const bytes = await document.save(), base = 'C:\\Program Files\\Aexus Bot\\pdfjs-dist';
  assert.throws(() => pdfjs.getDocument({
    data: bytes.slice(), cMapUrl: path.win32.join(base, 'cmaps') + path.win32.sep
  }), /Invalid factory url.*must include trailing slash/);
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, ...windowsResources()(base) });
  try { assert.equal((await task.promise).numPages, 1); }
  finally { await task.destroy(); }
});
