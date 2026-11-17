'use strict';
const path = require('node:path');
const Module = require('node:module');

const unpackedMarker = '.asar.unpacked';
const idx = __dirname.indexOf(unpackedMarker);
if (idx !== -1) {
  const base = __dirname.slice(0, idx);
  const candidates = [
    path.join(base + '.asar.unpacked', 'node_modules'),
    path.join(base + '.asar', 'node_modules'),
  ];
  const existing = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
  process.env.NODE_PATH = [...new Set([...candidates, ...existing])].join(path.delimiter);
  Module._initPaths();
}
