"use strict";
const readline = require("node:readline");
const { PassThrough } = require("node:stream");
const { Workspace } = require("./workspace.cjs");
const { render } = require("./screen.cjs");
async function runTui({
  client,
  workspace,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
}) {
  if (!input.isTTY || !output.isTTY || process.env.TERM === "dumb") {
    errorOutput.write(
      "MarginReader TUI requires interactive TTY input/output and TERM other than dumb. Use list, read --text, or api for redirected output.\n",
    );
    return { degraded: true };
  }
  const { default: width } = await import("string-width");
  const app = new Workspace(client);
  app.width = width;
  app.workspace = workspace;
  let done = false,
    unsubscribe,
    resolveDone,
    rejectDone,
    timer,
    painting = false,
    started = false;
  const keyboard = new PassThrough();
  const forward = (chunk) => keyboard.write(chunk);
  const active = new Set(),
    wasRaw = Boolean(input.isRaw),
    wasPaused = input.readableFlowing !== true;
  const completion = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  function paint() {
    if (done || painting) return;
    painting = true;
    try {
      output.write(
        "\x1b[H" +
          render(app, output.columns || 80, output.rows || 24) +
          "\x1b[J",
      );
    } catch (e) {
      finish(e);
    } finally {
      painting = false;
    }
  }
  function cleanup() {
    clearTimeout(timer);
    input.removeListener("data", forward);
    keyboard.removeListener("keypress", onKey);
    keyboard.destroy();
    input.removeListener("end", onEnd);
    input.removeListener("close", onEnd);
    input.removeListener("error", onError);
    output.removeListener("resize", paint);
    output.removeListener("error", onError);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("uncaughtException", onError);
    try {
      input.setRawMode?.(wasRaw);
    } catch {}
    if (wasPaused) input.pause();
    if (started)
      try {
        output.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
      } catch {}
  }
  function track(p) {
    active.add(p);
    p.catch((e) => {
      if (!done) app.error(e);
    }).finally(() => active.delete(p));
    return p;
  }
  function onKey(str, key) {
    if (done) return;
    // A bracketed paste is a single draft edit, not thousands of independently
    // tracked navigation/submit shortcuts. Always drain its end marker.
    if (app.handlePaste(str, key)) return;
    if (app.pending && !(key?.ctrl && key.name === "c") && str !== "q") {
      app.status = "Pending: wait for current operation";
      return paint();
    }
    track(app.key(str, key));
  }
  function onEnd() {
    finish();
  }
  function onSignal() {
    finish();
  }
  function onError(e) {
    finish(e);
  }
  function finish(error) {
    if (done) return;
    done = true;
    app.dead = true;
    ++app.nav;
    cleanup();
    // CLI owns client.close; do not resolve until in-flight requests have settled.
    Promise.allSettled([...active]).then(async () => {
      try {
        await unsubscribe?.();
      } catch (e) {
        error ||= e;
      }
      if (error) rejectDone(error);
      else resolveDone({ degraded: false });
    });
  }
  app.stop = () => finish();
  app.changed = paint;
  try {
    readline.emitKeypressEvents(keyboard, { escapeCodeTimeout: 40 });
    keyboard.on("keypress", onKey);
    input.on("data", forward);
    input.once("end", onEnd);
    input.once("close", onEnd);
    input.on("error", onError);
    output.on("resize", paint);
    output.on("error", onError);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.once("uncaughtException", onError);
    started = true;
    output.write("\x1b[?1049h\x1b[?25l\x1b[?2004h");
    input.setRawMode?.(true);
    input.resume();
    paint();
    if (typeof client.subscribe === "function") {
      const sub = await client.subscribe(() => {
        if (!done) {
          app.status =
            "Workspace changed externally; refresh explicitly before editing / 外部更新";
          paint();
        }
      });
      if (done) await sub?.();
      else unsubscribe = sub;
    }
    if (!done) track(app.init()).catch(finish);
  } catch (e) {
    finish(e);
  }
  return completion;
}
module.exports = { runTui };
