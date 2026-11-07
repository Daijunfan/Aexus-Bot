// Rebuild the bundled catalogs from pinned, public upstream data. No runtime requests.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { iconNames } from '../src/core/icons.ts';

const root = path.resolve(import.meta.dirname, '..');
const unicodeVersion = '17.0';
const cldrVersion = '48.0.0';
const lucideVersion = JSON.parse(
  await fs.readFile(path.join(root, 'node_modules/lucide-react/package.json'), 'utf8'),
).version;
const exec = promisify(execFile);
async function download(url) {
  const { stdout } = await exec(
    'curl',
    ['--http1.1', '--fail', '--silent', '--show-error', '--location', '--max-time', '90', url],
    { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 },
  );
  return new Response(stdout);
}
const emojiURL = `https://unicode.org/Public/${unicodeVersion}.0/emoji/emoji-test.txt`;
const annotationURL = (language, derived) =>
  `https://raw.githubusercontent.com/unicode-org/cldr-json/${cldrVersion}/cldr-json/cldr-annotations${derived ? '-derived' : ''}-full/${derived ? 'annotationsDerived' : 'annotations'}/${language}/annotations.json`;
const stripVariation = (text) => text.replace(/\uFE0F/g, '');
const annotations = await Promise.all(
  ['zh', 'en'].map(async (language) => {
    const tables = await Promise.all(
      [false, true].map(async (derived) => {
        const json = await (await download(annotationURL(language, derived))).json();
        return json[derived ? 'annotationsDerived' : 'annotations'].annotations;
      }),
    );
    return new Map(
      Object.entries(Object.assign({}, ...tables)).map(([emoji, annotation]) => [
        stripVariation(emoji),
        annotation,
      ]),
    );
  }),
);
const source = await (await download(emojiURL)).text();
if (!source.includes(`# Version: ${unicodeVersion}`)) throw new Error('Unexpected Unicode version');
let group,
  translated = 0;
const emojis = [];
for (const line of source.split('\n')) {
  if (line.startsWith('# group: ')) group = line.slice(9);
  const match = /^([0-9A-F ]+)\s*;\s*(fully-qualified|component)\s*#\s*\S+\s+E[\d.]+\s+(.+)$/.exec(line);
  if (!match) continue;
  const emoji = String.fromCodePoint(
    ...match[1]
      .trim()
      .split(/\s+/)
      .map((code) => parseInt(code, 16)),
  );
  const [zh, en] = annotations.map((table) => table.get(stripVariation(emoji)));
  const name = zh?.tts?.[0] || match[3];
  if (zh?.tts?.[0]) translated++;
  const keywords = [
    ...new Set([match[3], ...(en?.tts || []), ...(en?.default || []), ...(zh?.default || [])]),
  ].join(' ');
  emojis.push([emoji, name, keywords, group === 'Component' ? 'People & Body' : group, match[3]]);
}
if (emojis.length !== 3953 || new Set(emojis.map(([emoji]) => emoji)).size !== emojis.length)
  throw new Error('Incomplete Unicode Emoji 17.0 catalog');

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mininotion-icons-'));
try {
  const archive = await download(
    `https://codeload.github.com/lucide-icons/lucide/tar.gz/refs/tags/${lucideVersion}`,
  );
  const archivePath = path.join(temp, 'lucide.tar.gz');
  await fs.writeFile(archivePath, Buffer.from(await archive.arrayBuffer()));
  execFileSync('tar', ['-xzf', archivePath, '-C', temp, `lucide-${lucideVersion}/icons`]);
  const directory = path.join(temp, `lucide-${lucideVersion}/icons`);
  const metadata = {};
  for (const filename of await fs.readdir(directory)) {
    if (!filename.endsWith('.json')) continue;
    const name = filename
      .slice(0, -5)
      .split('-')
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join('');
    if (!iconNames.includes(name)) continue;
    const data = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
    metadata[name] = [
      ...new Set([
        ...(data.tags || []),
        ...(data.categories || []),
        ...(data.aliases || []).map((alias) => (typeof alias === 'string' ? alias : alias.name)),
      ]),
    ].join(' ');
  }
  if (Object.keys(metadata).length !== iconNames.length)
    throw new Error(
      `Missing Lucide metadata: ${iconNames.filter((name) => !Object.hasOwn(metadata, name)).join(', ')}`,
    );
  await fs.writeFile(path.join(root, 'src/core/iconKeywords.json'), JSON.stringify(metadata) + '\n');
  await fs.writeFile(path.join(root, 'src/core/emojis.json'), JSON.stringify(emojis) + '\n');
  console.log(
    JSON.stringify({
      unicodeVersion,
      cldrVersion,
      lucideVersion,
      emojis: emojis.length,
      translated,
      icons: Object.keys(metadata).length,
    }),
  );
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
