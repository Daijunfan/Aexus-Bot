"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const cli = path.resolve(__dirname, "../cli.cjs"),
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENTS_")));

test("TUI help variants work without a workspace, host or interactive terminal", () => {
  let help;
  for (const args of [["tui", "--help"], ["--help", "tui"], ["help", "tui"], ["--workspace", "/not-used-by-tui-help", "tui", "--help"]]) {
    const child = spawnSync(process.execPath, [cli, ...args], {
      env: { ...env, TERM: "dumb", AGENTS_COMPANY_EMPLOYEE: "discovery-without-host" },
      encoding: "utf8", timeout: 10000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.match(child.stdout, /Usage: margin-reader --workspace DIR tui/);
    assert.match(child.stdout, /TTY_REQUIRED/);
    assert.match(child.stdout, /Tab \/ Shift-Tab/);
    assert.match(child.stdout, /Ctrl-J/);
    assert.match(child.stdout, /docs\/TERMINAL_WORKSPACE\.md/);
    assert(!child.stdout.includes("\x1b"));
    if (help !== undefined) assert.equal(child.stdout, help);
    help = child.stdout;
  }
});

test("TUI help does not load runtime or the terminal module", () => {
  const code = [
    "const M=require('node:module'),load=M._load;",
    "M._load=function(id,...args){if(id==='./runtime.cjs'||id==='./tui/index.cjs')throw Error('must not initialize '+id);return load.call(this,id,...args)};",
    "process.argv=['node','cli','tui','--help'];",
    "require(" + JSON.stringify(cli) + ").main().catch(e=>{console.error(e);process.exitCode=1});",
  ].join("");
  const child = spawnSync(process.execPath, ["-e", code], {
    env: { ...env, TERM: "dumb" }, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, "");
  assert.match(child.stdout, /local keyboard-driven reading and knowledge workspace/);
});

test("noninteractive CLI TUI fails before Core creates workspace metadata and emits no ANSI", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mr-cli-tui-guard-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [cli, "--workspace", workspace, "tui"], {
    env: { ...env, TERM: "xterm-256color" }, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 1, child.stderr);
  assert.equal(JSON.parse(child.stdout).error.data.code, "TTY_REQUIRED");
  assert.match(child.stderr, /TTY.*read --text/);
  assert(!child.stdout.includes("\x1b") && !child.stderr.includes("\x1b"));
  assert.deepEqual(await fs.readdir(workspace), []);
});

test("TERM=dumb is rejected before loading either runtime or the TUI module", () => {
  const code = [
    "Object.defineProperty(process.stdin,'isTTY',{value:true});",
    "Object.defineProperty(process.stdout,'isTTY',{value:true});",
    "const M=require('node:module'),load=M._load;",
    "M._load=function(id,...args){if(id==='./runtime.cjs'||id==='./tui/index.cjs')throw Error('must not initialize '+id);return load.call(this,id,...args)};",
    "process.argv=['node','cli','--workspace','/path-not-needed','tui'];",
    "require(" + JSON.stringify(cli) + ").main().then(()=>{throw Error('expected TTY rejection')}).catch(e=>{if(e.code!=='TTY_REQUIRED'){console.error(e);process.exitCode=1}else console.log(e.code)});",
  ].join("");
  const child = spawnSync(process.execPath, ["-e", code], {
    env: { ...env, TERM: "dumb" }, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "TTY_REQUIRED\n");
  assert.equal(child.stderr, "");
});
