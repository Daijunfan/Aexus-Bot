"use strict";
// Read-only presentation benchmark. --root lets the same harness compare a
// pristine source snapshot and a changed snapshot with their real dependencies.
// No workspace is created; any accidental public request fails the benchmark.
const path = require("node:path"), os = require("node:os"),
  { pathToFileURL } = require("node:url"),
  { performance } = require("node:perf_hooks");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw Error("Missing value for " + name);
  return process.argv[index + 1];
}
function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b),
    percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    samples: values.length,
    p50Ms: +percentile(0.5).toFixed(3),
    p95Ms: +percentile(0.95).toFixed(3),
    maxMs: +sorted.at(-1).toFixed(3),
    totalMs: +values.reduce((sum, n) => sum + n, 0).toFixed(3),
  };
}
async function main() {
  const root = path.resolve(argument("--root", path.join(__dirname, ".."))),
    samples = Number(argument("--samples", "24"));
  if (!Number.isInteger(samples) || samples < 8 || samples > 240)
    throw Error("--samples must be an integer from 8 to 240");
  const { Workspace } = require(path.join(root, "tui/workspace.cjs")),
    { render } = require(path.join(root, "tui/screen.cjs")),
    { default: width } = await import(pathToFileURL(require.resolve("string-width", { paths: [root] })).href);
  const keys = ["right", "down", "left", "up", "pagedown", "pageup", "right", "left"],
    viewport = { columns: 132, rows: 36 },
    fixtures = [
      { name: "ascii-270k", text: "The quick brown fox jumps over the lazy dog. ".repeat(6000) },
      { name: "mixed-unicode", text: "中文阅读🙂 with 👩‍👩‍👧‍👦 family é. 下一行知识。\n".repeat(6000) },
    ],
    results = [];
  for (const fixture of fixtures) {
    const create = () => {
      const app = new Workspace({
        request() { throw Error("Presentation benchmark must not call Core"); },
      });
      app.width = width;
      app.focus = 1;
      app.text = fixture.text;
      app.doc = { title: fixture.name };
      return app;
    };
    const cold = [];
    let app, checksum = 0;
    for (let i = 0; i < 3; i++) {
      app = create();
      const start = performance.now();
      const image = render(app, viewport.columns, viewport.rows);
      cold.push(performance.now() - start);
      checksum += image.length;
    }
    const warm = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await app.key("", { name: keys[i % keys.length] });
      const image = render(app, viewport.columns, viewport.rows);
      warm.push(performance.now() - start);
      checksum += image.length;
    }
    results.push({
      fixture: fixture.name,
      sourceUtf16Units: fixture.text.length,
      sourceUtf8Bytes: Buffer.byteLength(fixture.text),
      coldLayout: statistics(cold),
      warmKeyAndFrame: statistics(warm),
      finalCursor: app.cursor,
      checksum,
    });
  }
  process.stdout.write(JSON.stringify({
    scope: "Synthetic read-only TUI presentation; real string-width; no TTY I/O, parsing, PDF images, Core, or hardware-parity claim",
    sourceRoot: root,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model || "unknown",
    viewport,
    keySequence: keys,
    results,
  }, null, 2) + "\n");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
