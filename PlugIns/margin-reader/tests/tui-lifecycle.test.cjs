"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { PassThrough, Writable } = require("node:stream");
const { runTui } = require("../tui/index.cjs");
const originalTerm = process.env.TERM;
test.before(() => { process.env.TERM = "xterm"; });
test.after(() => { if (originalTerm === undefined) delete process.env.TERM; else process.env.TERM = originalTerm; });
function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  input.pause();
  let text = "";
  const output = new Writable({
    write(chunk, enc, cb) {
      text += chunk.toString();
      cb();
    },
  });
  output.isTTY = true;
  output.columns = 120;
  output.rows = 28;
  return { input, output, text: () => text };
}
async function ready(t) {
  for (let i = 0; i < 100; i++) {
    if (t.text().includes("Ready /")) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("terminal did not start");
}
test("non-TTY and dumb terminal degrade without RPC or control output", async () => {
  const env = process.env.TERM;
  try {
    for (const dumb of [false, true]) {
      const t = terminal();
      if (dumb) process.env.TERM = "dumb";
      else {
        process.env.TERM = "xterm";
        t.input.isTTY = false;
      }
      let message = "";
      const r = await runTui({
        client: {
          request() {
            throw Error("must not RPC");
          },
        },
        workspace: "/unused",
        ...t,
        errorOutput: { write: (s) => (message += s) },
      });
      assert(r.degraded);
      assert.equal(t.text(), "");
      assert.match(message, /TTY/);
      assert(!t.input.isRaw);
    }
  } finally {
    if (env === undefined) delete process.env.TERM;
    else process.env.TERM = env;
  }
});
test("normal stop restores all owned listeners, subscriptions and terminal state", async () => {
  const t = terminal();
  let unsubscribed = 0,
    closed = 0;
  const client = {
    async request({ method }) {
      return { result: method === "fs.list" ? { entries: [] } : { sets: [] } };
    },
    async subscribe() {
      return () => unsubscribed++;
    },
    close() {
      closed++;
    },
  };
  const before = Object.fromEntries(
    ["SIGINT", "SIGTERM", "uncaughtException"].map((s) => [
      s,
      process.listenerCount(s),
    ]),
  );
  const running = runTui({
    client,
    workspace: "/unused",
    input: t.input,
    output: t.output,
    errorOutput: t.output,
  });
  await ready(t);
  assert(t.input.isRaw);
  t.input.write("q");
  await running;
  assert(!t.input.isRaw);
  assert(t.input.isPaused());
  assert.equal(unsubscribed, 1);
  assert.equal(closed, 0);
  for (const [s, count] of Object.entries(before))
    assert.equal(process.listenerCount(s), count);
  for (const event of ["data", "keypress", "end", "close", "error"])
    assert.equal(t.input.listenerCount(event), 0, event);
  assert.equal(t.output.listenerCount("resize"), 0);
  assert(t.text().endsWith("\x1b[?25h\x1b[?1049l"));
});
test("stream exception restores terminal before rejecting; previously raw input stays raw", async () => {
  const t = terminal();
  t.input.isRaw = true;
  const client = {
    async request({ method }) {
      return { result: method === "fs.list" ? { entries: [] } : { sets: [] } };
    },
  };
  const running = runTui({
    client,
    workspace: "/unused",
    input: t.input,
    output: t.output,
    errorOutput: t.output,
  });
  await ready(t);
  t.output.emit("error", Error("injected output failure"));
  await assert.rejects(running, /injected/);
  assert(t.input.isRaw);
  assert(t.text().endsWith("\x1b[?25h\x1b[?1049l"));
  assert.equal(t.input.listenerCount("data"), 0);
});
test("exit waits for in-flight request before CLI may close client", async () => {
  const t = terminal();
  let release;
  const client = {
    request() {
      return new Promise((r) => (release = r));
    },
  };
  let resolved = false;
  const running = runTui({
    client,
    workspace: "/unused",
    input: t.input,
    output: t.output,
    errorOutput: t.output,
  }).then(() => (resolved = true));
  await ready(t);
  t.input.write("q");
  await new Promise((r) => setTimeout(r, 20));
  assert(!resolved);
  assert(!t.input.isRaw);
  release({ result: { entries: [] } });
  await running;
  assert(resolved);
});

test("initialization failure rejects after cleanup and unsubscribes without leaving input flowing", async () => {
  const t = terminal();
  let unsubscribed = 0;
  const running = runTui({
    client: {
      async request() {
        return {
          error: {
            message: "initialization failed",
            data: { code: "INIT_FAILURE" },
          },
        };
      },
      async subscribe() {
        return () => unsubscribed++;
      },
    },
    workspace: "/unused",
    input: t.input,
    output: t.output,
    errorOutput: t.output,
  });
  await assert.rejects(running, /initialization failed/);
  assert(!t.input.isRaw);
  assert(t.input.isPaused());
  assert.equal(t.input.listenerCount("data"), 0);
  assert.equal(unsubscribed, 1);
  assert(t.text().endsWith("\x1b[?25h\x1b[?1049l"));
});
