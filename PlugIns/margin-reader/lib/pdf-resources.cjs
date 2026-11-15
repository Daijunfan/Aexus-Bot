'use strict';
const path = require('node:path');

// PDF.js Node factories read filesystem paths, but require a URL-style trailing slash.
module.exports = function pdfResources(base = path.dirname(require.resolve('pdfjs-dist/package.json'))) {
  const directory = name => path.join(base, name).split(path.sep).join('/') + '/';
  return { cMapUrl: directory('cmaps'), cMapPacked: true,
    standardFontDataUrl: directory('standard_fonts'), wasmUrl: directory('wasm') };
};
