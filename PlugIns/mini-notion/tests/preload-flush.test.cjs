const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const tick = () => new Promise(resolve => setImmediate(resolve));
function preload() {
  const ipc = new EventEmitter(), sent = [];
  let native;
  ipc.send = (...args) => sent.push(args);
  const context = { require: name => {
    assert.equal(name, 'electron');
    return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_, api) => { native = api; } } };
  }, process: { argv: [] } };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/preload.cjs'), 'utf8'), context);
  return { ipc, sent, native };
}
test('desktop acknowledges a flush only after both workspace and file editor finish', async () => {
  const { ipc, sent, native } = preload();
  let release;
  native.onFlush(async () => {});
  native.onFlush(() => new Promise(resolve => { release = resolve; }));
  ipc.emit('workspace:flush', {}, 'close-1');
  await tick();
  assert.deepEqual(sent, []);
  release(); await tick();
  assert.deepEqual(sent, [['workspace:flushed', 'close-1']]);
});
test('unmounted editors unsubscribe, while any active save failure blocks closing', async () => {
  const { ipc, sent, native } = preload();
  native.onFlush(async () => {});
  const off = native.onFlush(async () => { throw Error('removed'); }); off();
  native.onFlush(async () => { throw Error('draft not durable'); });
  ipc.emit('workspace:flush', {}, 'close-2');
  await tick();
  assert.deepEqual(sent, [['workspace:flushed', 'close-2', 'draft not durable']]);
});
