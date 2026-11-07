import test from 'node:test';
import assert from 'node:assert/strict';
import { CoalescedWriter } from '../src/core/coalescedWriter.ts';

test('a typing burst persists only its latest draft', async () => {
  const values: string[] = [];
  const writer = new CoalescedWriter<string>(async value => { values.push(value); }, assert.fail, 1000);
  for (let i = 0; i < 100; i++) writer.set(`draft ${i}`);
  await writer.flush();
  assert.deepEqual(values, ['draft 99']);
});
test('a slow older draft cannot overwrite a new draft or resurrect a cleared draft', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const values: (string | null)[] = [];
  const writer = new CoalescedWriter<string | null>(async value => {
    if (value === 'old') await held;
    values.push(value);
  }, assert.fail, 1000);
  writer.set('old');
  const first = writer.flush();
  writer.set('new');
  writer.set(null);
  const cleared = writer.flush();
  release();
  await Promise.all([first, cleared]);
  assert.deepEqual(values, ['old', null]);
});
test('failed checkpoints remain pending and can be retried', async () => {
  let fail = true;
  const values: string[] = [];
  const writer = new CoalescedWriter<string>(async value => {
    if (fail) throw new Error('disk unavailable');
    values.push(value);
  }, assert.fail, 1000);
  writer.set('recover me');
  await assert.rejects(writer.flush(), /disk unavailable/);
  fail = false;
  await writer.flush();
  assert.deepEqual(values, ['recover me']);
});
test('continuous editing is checkpointed before the typing session finishes', async () => {
  const values: string[] = [];
  const writer = new CoalescedWriter<string>(async value => { values.push(value); }, assert.fail, 15);
  writer.set('start');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(values, ['start']);
  writer.set('finish');
  await writer.flush();
  assert.deepEqual(values, ['start', 'finish']);
});
