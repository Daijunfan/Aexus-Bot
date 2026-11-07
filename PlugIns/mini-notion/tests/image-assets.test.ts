import test from 'node:test';
import assert from 'node:assert/strict';
import { probeImage, saveImageAsset } from '../src/content/assets.ts';

function installImage(behavior: 'load' | 'error' | 'timeout') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  class TestImage {
    naturalWidth = 800; naturalHeight = 400;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => behavior === 'load' ? this.onload?.() : behavior === 'error' ? this.onerror?.() : undefined); }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: TestImage });
  return () => previous ? Object.defineProperty(globalThis, 'Image', previous) : Reflect.deleteProperty(globalThis, 'Image');
}

test('image probing reports dimensions and rejects broken or stalled sources', async () => {
  let restore = installImage('load');
  try { assert.deepEqual(await probeImage('blob:good'), { width: 800, height: 400 }); } finally { restore(); }
  restore = installImage('error');
  try { await assert.rejects(probeImage('blob:broken'), /无法读取图片/); } finally { restore(); }
  restore = installImage('timeout');
  try { await assert.rejects(probeImage('blob:stalled', 5), /加载超时/); } finally { restore(); }
});
test('an invalid image cannot write an asset or replace the current cover', async () => {
  const restore = installImage('error');
  try { await assert.rejects(saveImageAsset(new File(['bad data'], 'bad.png', { type: 'image/png' })), /无法读取图片/); }
  finally { restore(); }
});
test('validated originals are saved byte-for-byte and temporary preview URLs are released', async () => {
  const restore = installImage('load');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldRevoke = URL.revokeObjectURL;
  const released: string[] = [];
  const content = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3]);
  let saved: ArrayBuffer | undefined;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { native: { saveAsset: async (name: string, bytes: ArrayBuffer) => { assert.equal(name, 'animated.gif'); saved = bytes; return 'asset://local/animated.gif'; } } } });
  URL.revokeObjectURL = url => { released.push(url); oldRevoke(url); };
  try {
    assert.equal(await saveImageAsset(new File([content], 'animated.gif', { type: 'image/gif' })), 'asset://local/animated.gif');
    assert.deepEqual(new Uint8Array(saved!), content);
    assert.equal(released.length, 1);
  } finally {
    restore(); URL.revokeObjectURL = oldRevoke;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
