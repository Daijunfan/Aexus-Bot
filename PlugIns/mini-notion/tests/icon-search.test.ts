import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { emojis, emojiGroups, symbols, searchEmojis, searchSymbols } from '../src/core/iconSearch';
import { iconNames, parseIcon } from '../src/core/icons';
import { icons } from 'lucide-react';

test('complete offline catalogs preserve Unicode sequences and every declared vector', () => {
  assert.equal(emojis.length, 3953);
  assert.equal(new Set(emojis.map((item) => item.emoji)).size, 3953);
  for (const item of emojis) {
    assert.ok(item.name && item.keywords);
    assert.ok(item.group in emojiGroups, item.group);
  }
  for (const emoji of ['🫪', '🫍', '🪾', '🧑🏽‍💻', '👩🏽‍🤝‍👨🏿', '🏳️‍⚧️', '🇨🇳', '🏻', '🦰'])
    assert.ok(
      emojis.some((item) => item.emoji === emoji),
      emoji,
    );
  assert.equal(symbols.length, iconNames.length);
  for (const name of iconNames) {
    assert.ok(icons[name as keyof typeof icons], name);
    assert.equal(parseIcon(`icon:${name}:blue`)?.name, name);
  }
});

test('Chinese, English, shortcodes and variation selectors search the same offline catalog', () => {
  assert.ok(searchEmojis('程序员 中等肤色').some((item) => item.emoji === '🧑🏽‍💻'));
  assert.ok(searchEmojis('flag china').some((item) => item.emoji === '🇨🇳'));
  assert.ok(searchEmojis('中国').some((item) => item.emoji === '🇨🇳'));
  assert.ok(searchEmojis('：ＦＩＲＥ：').some((item) => item.emoji === '🔥'));
  assert.equal(searchEmojis('❤')[0].emoji, '❤️');
  assert.equal(searchEmojis('🧑🏽‍💻')[0].emoji, '🧑🏽‍💻');
  assert.deepEqual(searchEmojis('this emoji does not exist'), []);
  const flags = searchEmojis('', 'Flags');
  assert.ok(flags.length > 250);
  assert.ok(flags.every((item) => item.group === 'Flags'));
  assert.equal(searchEmojis('猫', 'Flags').length, 0);
});

test('official Lucide tags and aliases supplement names and Chinese keywords', () => {
  assert.ok(searchSymbols('home').some((item) => item.name === 'House'));
  assert.ok(searchSymbols('reading').some((item) => item.name === 'BookOpen'));
  assert.ok(searchSymbols('书').some((item) => item.name === 'BookOpen'));
  assert.ok(searchSymbols('book-open').some((item) => item.name === 'BookOpen'));
  assert.equal(searchSymbols('ＢＯＯＫＯＰＥＮ')[0].name, 'BookOpen');
  assert.equal(searchSymbols('Book')[0].name, 'Book');
  assert.deepEqual(searchSymbols('nonexistent symbol phrase'), []);
});

test('indexed searches avoid repeatedly normalizing all catalog entries', () => {
  const queries = ['face', 'hand', 'red', 'woman', 'flag', 'book', 'cat', 'fire', '咖啡', '中国'];
  const legacy = (query: string) =>
    emojis.filter((item) => {
      const value = [item.emoji, item.name, item.keywords].join(' ').toLocaleLowerCase();
      return query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .every((word) => value.includes(word));
    });
  // Warm both paths, then compare the original scan with the new index on identical data.
  for (const query of queries) {
    legacy(query);
    searchEmojis(query);
  }
  const measure = (run: (query: string) => unknown) => {
    const times: number[] = [];
    for (let repeat = 0; repeat < 20; repeat++)
      for (const query of queries) {
        const start = performance.now();
        run(query);
        times.push(performance.now() - start);
      }
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)] };
  };
  const before = measure(legacy),
    after = measure(searchEmojis);
  console.log(
    'ICON SEARCH BENCHMARK',
    JSON.stringify({ entries: emojis.length, before, after, medianSpeedup: before.median / after.median }),
  );
  assert.ok(after.median < before.median, 'precomputed index should improve the full catalog scan');
  assert.ok(after.p95 < 16, 'search fits within one frame on this test machine');
});
