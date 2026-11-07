// Regression test for src/main/bot-bridge/http.ts proxy transport pools.
//
// Contract under test:
//   1. Long-lived httpStream responses use a separate proxy socket pool, so
//      twelve open streams do not starve an ordinary httpJson RPC.
//   2. httpJson applies its absolute deadline from before socket assignment, so
//      a request that never gets a socket (ordinary pool full) still rejects.
//   3. A response that keeps sending bytes never triggers the idle timeout, but
//      the absolute deadline still rejects it.
//
// Everything is local: an ephemeral HTTPS origin for fixture.invalid and an
// ephemeral HTTP CONNECT proxy that maps only fixture.invalid to that origin.
// The child process trusts the disposable test CA through NODE_EXTRA_CA_CERTS;
// TLS verification is never disabled anywhere.

import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import esbuild from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-workers-transport-'));
const resultPath = path.join(repoRoot, 'artifacts/bot-workers/transport-result.json');

const sockets = new Set();
const upstreamSockets = new Set();
const intervals = new Set();
let httpsServer = null;
let proxyServer = null;
let child = null;
let httpsPort = 0;
let proxyPort = 0;
let report = null;
let fixtureDump = {};

function trackConnections(server) {
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await Promise.race([
    new Promise((resolve) => server.close(() => resolve())),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

/**
 * Disposable self-signed CA/server certificate for fixture.invalid.
 * A config file is used instead of -addext so this works with both OpenSSL and
 * the LibreSSL shipped on macOS.
 */
function makeFixtureCertificate() {
  const keyPath = path.join(tempRoot, 'fixture-key.pem');
  const certPath = path.join(tempRoot, 'fixture-cert.pem');
  const configPath = path.join(tempRoot, 'fixture-openssl.cnf');
  fs.writeFileSync(configPath, [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3',
    'prompt = no',
    '[dn]',
    'CN = fixture.invalid',
    'O = Bot Workers Transport Test',
    '[v3]',
    'subjectAltName = DNS:fixture.invalid',
    'basicConstraints = critical,CA:TRUE',
    'keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign',
    'extendedKeyUsage = serverAuth',
    '',
  ].join('\n'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
      '-keyout', keyPath, '-out', certPath, '-config', configPath,
    ], {stdio: 'pipe'});
  } catch (error) {
    throw new Error(
      'openssl is required to generate the disposable test certificate: ' +
      (error?.stderr?.toString?.() || error?.message || String(error)),
    );
  }
  return {keyPath, certPath};
}

function makeOrigin(keyPath, certPath) {
  const state = {
    activeStreams: 0,
    maxActiveStreams: 0,
    streamRequests: 0,
    holdJson: 0,
    maxHoldJson: 0,
    rpcCount: 0,
    dripBytes: 0,
  };

  const server = https.createServer(
    {key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath)},
    (req, res) => {
      res.on('error', () => {});
      req.on('error', () => {});
      let pathname = '/';
      try {
        pathname = new URL(req.url, 'https://fixture.invalid').pathname;
      } catch {
        pathname = '/';
      }

      if (pathname === '/rpc') {
        state.rpcCount += 1;
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify({ok: true}));
        return;
      }
      if (pathname === '/stats') {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify(state));
        return;
      }
      if (pathname === '/hold') {
        state.streamRequests += 1;
        state.activeStreams += 1;
        state.maxActiveStreams = Math.max(state.maxActiveStreams, state.activeStreams);
        res.writeHead(200, {'content-type': 'application/json'});
        res.write('{"stream":true}\n');
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          intervals.delete(timer);
          state.activeStreams -= 1;
        };
        const timer = setInterval(() => {
          if (res.destroyed || res.writableEnded) {
            finish();
            return;
          }
          res.write('{"heartbeat":true}\n');
        }, 40);
        intervals.add(timer);
        res.on('close', finish);
        return;
      }
      if (pathname === '/hold-json') {
        state.holdJson += 1;
        state.maxHoldJson = Math.max(state.maxHoldJson, state.holdJson);
        res.writeHead(200, {'content-type': 'application/json'});
        res.write('{"partial":');
        let done = false;
        res.on('close', () => {
          if (done) return;
          done = true;
          state.holdJson -= 1;
        });
        return;
      }
      if (pathname === '/drip') {
        res.writeHead(200, {'content-type': 'application/octet-stream'});
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          intervals.delete(timer);
        };
        const timer = setInterval(() => {
          if (res.destroyed || res.writableEnded) {
            finish();
            return;
          }
          state.dripBytes += 1;
          res.write(' ');
        }, 20);
        intervals.add(timer);
        res.on('close', finish);
        return;
      }
      res.writeHead(404, {'content-type': 'application/json'});
      res.end('{}');
    },
  );
  trackConnections(server);
  return {server, state};
}

function makeProxy() {
  const proxyState = {connectCount: 0, rejectedHosts: []};
  const server = http.createServer((req, res) => {
    res.writeHead(405);
    res.end();
  });
  trackConnections(server);
  server.on('connect', (req, clientSocket, head) => {
    clientSocket.on('error', () => {});
    const authority = String(req.url || '');
    const match = /^([^:]+):(\d+)$/.exec(authority);
    const host = match ? match[1].toLowerCase() : '';
    // Only the fixture host is mapped, and it is always mapped to the local
    // HTTPS origin. Every other CONNECT authority is refused.
    if (!match || host !== 'fixture.invalid') {
      proxyState.rejectedHosts.push(authority);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    proxyState.connectCount += 1;
    const upstream = net.connect({host: '127.0.0.1', port: httpsPort}, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstreamSockets.add(upstream);
    upstream.on('close', () => upstreamSockets.delete(upstream));
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
    clientSocket.on('close', () => upstream.destroy());
    upstream.on('close', () => clientSocket.destroy());
  });
  return {server, proxyState};
}

function connectProbe(authority) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (status) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: authority,
      headers: {host: authority},
      agent: false,
    });
    req.on('connect', (res, socket) => {
      socket.destroy();
      done(res.statusCode);
    });
    req.on('response', (res) => {
      res.resume();
      done(res.statusCode);
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.end();
  });
}

const childSource = String.raw`
import fs from 'node:fs';
import https from 'node:https';
import {performance} from 'node:perf_hooks';

const {httpJson, httpStream} = await import(process.env.BUNDLE_URL);
const BASE = 'https://fixture.invalid:' + process.env.HTTPS_PORT;
const CA = fs.readFileSync(process.env.CERT_PATH);
const report = {phaseStream: null, phaseDrip: null, phasePool: null, failure: null};

function assert(condition, message) {
  if (!condition) throw new Error('ASSERT: ' + message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Test-control request that bypasses the proxy and the product's agents. It
// still verifies the fixture certificate normally (custom lookup only maps the
// fixture name to loopback).
function directJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'fixture.invalid',
      port: Number(process.env.HTTPS_PORT),
      path: pathname,
      method: 'GET',
      ca: CA,
      agent: false,
      lookup: (hostname, options, callback) => {
        if (options && options.all) callback(null, [{address: '127.0.0.1', family: 4}]);
        else callback(null, '127.0.0.1', 4);
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(2000, () => req.destroy(new Error('direct stats request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(fn, label, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(25);
  }
  throw new Error('Timed out waiting for ' + label + ' (last=' + JSON.stringify(last) + ')');
}

async function phaseStream() {
  const streams = [];
  for (let index = 0; index < 12; index += 1) {
    const stream = await httpStream(BASE + '/hold', {timeoutMs: 20000});
    assert(stream.status === 200, 'hold stream ' + index + ' status ' + stream.status);
    const state = {stream, bytes: 0};
    stream.res.on('data', (chunk) => { state.bytes += chunk.length; });
    stream.res.on('error', () => {});
    streams.push(state);
  }
  await waitFor(
    () => streams.every((state) => state.bytes > 0),
    'heartbeat data on all twelve held streams',
  );

  const startedAt = performance.now();
  const rpc = await httpJson(BASE + '/rpc', {timeoutMs: 3000});
  const elapsed = performance.now() - startedAt;
  assert(rpc.status === 200, 'rpc status ' + rpc.status + ' with twelve streams open');
  assert(rpc.data && rpc.data.ok === true, 'rpc body ok with twelve streams open');
  assert(elapsed < 2000, 'rpc took ' + Math.round(elapsed) + 'ms with twelve streams open');

  const stats = await directJson('/stats');
  assert(stats.activeStreams >= 12, 'server saw ' + stats.activeStreams + ' active streams');
  const minBytes = Math.min(...streams.map((state) => state.bytes));
  assert(minBytes > 0, 'every stream received heartbeat bytes');

  for (const state of streams) {
    state.stream.res.destroy();
    state.stream.req.destroy();
  }
  await waitFor(
    async () => (await directJson('/stats')).activeStreams === 0,
    'every held stream closed',
  );

  report.phaseStream = {
    heldStreams: streams.length,
    everyStreamReceivedHeartbeat: true,
    minHeartbeatBytes: minBytes,
    rpcStatus: rpc.status,
    rpcOk: true,
    rpcElapsedMs: Math.round(elapsed),
    serverActiveStreamsWhileHeld: stats.activeStreams,
    serverMaxActiveStreams: stats.maxActiveStreams,
    allStreamsClosed: true,
  };
}

async function phaseDrip() {
  const startedAt = performance.now();
  let error = null;
  try {
    await httpJson(BASE + '/drip', {timeoutMs: 400});
  } catch (caught) {
    error = caught;
  }
  const elapsed = performance.now() - startedAt;
  assert(error, 'drip request should reject at the absolute deadline');
  assert(
    /deadline exceeded/i.test(error.message),
    'expected absolute deadline error, got: ' + error.message,
  );
  assert(elapsed >= 250, 'deadline fired too early: ' + Math.round(elapsed) + 'ms');
  assert(elapsed < 2500, 'deadline was not bounded: ' + Math.round(elapsed) + 'ms');

  const stats = await directJson('/stats');
  assert(
    stats.dripBytes > 8,
    'server sent only ' + stats.dripBytes + ' bytes before the deadline',
  );

  report.phaseDrip = {
    rejected: true,
    errorMessage: error.message,
    timeoutMs: 400,
    elapsedMs: Math.round(elapsed),
    bytesArrivingBeforeDeadline: stats.dripBytes,
  };
}

async function phasePool() {
  const controllers = [];
  const held = [];
  for (let index = 0; index < 8; index += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    held.push(httpJson(BASE + '/hold-json', {
      timeoutMs: 20000,
      signal: controller.signal,
    }).then(
      () => ({resolved: true}),
      (error) => ({resolved: false, error: error.message}),
    ));
  }

  await waitFor(
    async () => (await directJson('/stats')).holdJson === 8,
    'all eight ordinary-pool sockets held',
  );
  const before = await directJson('/stats');

  const startedAt = performance.now();
  let error = null;
  try {
    await httpJson(BASE + '/rpc', {timeoutMs: 600});
  } catch (caught) {
    error = caught;
  }
  const elapsed = performance.now() - startedAt;
  const after = await directJson('/stats');

  assert(error, 'ninth request should reject while the eight-socket pool is full');
  assert(
    /deadline exceeded/i.test(error.message),
    'expected absolute deadline error for queued request, got: ' + error.message,
  );
  assert(elapsed >= 400, 'queued deadline fired too early: ' + Math.round(elapsed) + 'ms');
  assert(elapsed < 3000, 'queued deadline was not bounded: ' + Math.round(elapsed) + 'ms');
  assert(
    after.rpcCount === before.rpcCount,
    'the queued request reached the server before its deadline',
  );

  for (const controller of controllers) controller.abort();
  const settled = await Promise.all(held);
  assert(settled.every((entry) => entry.resolved === false), 'held requests aborted');
  await waitFor(
    async () => (await directJson('/stats')).holdJson === 0,
    'held ordinary-pool sockets closed',
  );

  const afterReleaseAt = performance.now();
  const rpc = await httpJson(BASE + '/rpc', {timeoutMs: 3000});
  const afterReleaseElapsed = performance.now() - afterReleaseAt;
  assert(rpc.status === 200 && rpc.data && rpc.data.ok === true, 'rpc ok after pool release');
  assert(afterReleaseElapsed < 2000, 'rpc prompt after pool release');

  report.phasePool = {
    heldOrdinaryRequests: 8,
    serverObservedHeld: before.holdJson,
    ninthRejected: true,
    ninthErrorMessage: error.message,
    ninthTimeoutMs: 600,
    ninthElapsedMs: Math.round(elapsed),
    ninthReachedServer: after.rpcCount !== before.rpcCount,
    abortedWithoutResolving: true,
    poolReleased: true,
    rpcAfterReleaseOk: true,
    rpcAfterReleaseElapsedMs: Math.round(afterReleaseElapsed),
  };
}

function finish(code) {
  process.stdout.write(JSON.stringify(report) + '\n', () => process.exit(code));
}

try {
  await phaseStream();
  await phaseDrip();
  await phasePool();
  finish(0);
} catch (error) {
  report.failure = error && error.stack ? error.stack : String(error);
  finish(1);
}
`;

function parseReport(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object') return value;
    } catch {
      // Not the JSON report line.
    }
  }
  return null;
}

function startChild(runnerPath, env) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [runnerPath], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('child timed out\nstdout:\n' + stdout.join('') + '\nstderr:\n' + stderr.join('')));
    }, 60_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({code, signal, stdout: stdout.join(''), stderr: stderr.join('')});
    });
  });
}

function writeResult(payload) {
  fs.mkdirSync(path.dirname(resultPath), {recursive: true});
  fs.writeFileSync(resultPath, JSON.stringify({
    at: new Date().toISOString(),
    node: process.version,
    test: 'test/bot-workers-transport-test.mjs',
    command: 'node test/bot-workers-transport-test.mjs',
    tls: 'child-only NODE_EXTRA_CA_CERTS; TLS verification never disabled',
    ...payload,
  }, null, 2) + '\n');
}

async function main() {
  const {keyPath, certPath} = makeFixtureCertificate();

  const bundlePath = path.join(tempRoot, 'http-' + randomUUID() + '.mjs');
  await esbuild.build({
    entryPoints: [path.join(repoRoot, 'src/main/bot-bridge/http.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });

  const origin = makeOrigin(keyPath, certPath);
  httpsServer = origin.server;
  const proxy = makeProxy();
  proxyServer = proxy.server;

  httpsPort = await listen(httpsServer);
  proxyPort = await listen(proxyServer);

  // Negative control: the proxy refuses CONNECT for any other authority.
  const rejectedStatus = await connectProbe('example.invalid:443');
  assert.equal(rejectedStatus, 403, 'proxy refuses non-fixture CONNECT authority');
  assert.ok(
    proxy.proxyState.rejectedHosts.includes('example.invalid:443'),
    'proxy recorded the refused authority',
  );

  const runnerPath = path.join(tempRoot, 'runner-' + randomUUID() + '.mjs');
  fs.writeFileSync(runnerPath, childSource);

  const env = {
    ...process.env,
    NODE_EXTRA_CA_CERTS: certPath,
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
    BOTS_PROXY: 'http://127.0.0.1:' + proxyPort,
    BOTS_NO_PROXY: '',
    HTTPS_PROXY: '',
    https_proxy: '',
    ALL_PROXY: '',
    all_proxy: '',
    BUNDLE_URL: pathToFileURL(bundlePath).href,
    CERT_PATH: certPath,
    HTTPS_PORT: String(httpsPort),
  };

  const run = await startChild(runnerPath, env);
  report = parseReport(run.stdout);
  fixtureDump = {
    origin: origin.state,
    proxy: proxy.proxyState,
    ephemeral: {httpsPort, proxyPort},
  };

  assert.equal(
    run.code,
    0,
    'child exit ' + run.code + (run.signal ? ' signal ' + run.signal : '') +
      '\nstdout:\n' + run.stdout + '\nstderr:\n' + run.stderr,
  );
  assert.ok(report, 'child printed a JSON report; stdout was:\n' + run.stdout);
  assert.equal(report.failure, null, 'child reported a failure: ' + report.failure);

  const streaming = report.phaseStream;
  assert.ok(streaming, 'stream phase present');
  assert.ok(streaming.heldStreams >= 12, 'held at least twelve streams');
  assert.equal(streaming.everyStreamReceivedHeartbeat, true);
  assert.ok(streaming.minHeartbeatBytes > 0, 'heartbeat bytes observed');
  assert.equal(streaming.rpcStatus, 200);
  assert.equal(streaming.rpcOk, true, 'ordinary rpc succeeded while streams were held');
  assert.ok(streaming.rpcElapsedMs < 2000, 'ordinary rpc was prompt while streams were held');
  assert.ok(streaming.serverActiveStreamsWhileHeld >= 12);
  assert.equal(streaming.allStreamsClosed, true);
  assert.ok(origin.state.maxActiveStreams >= 12, 'origin observed twelve concurrent streams');

  const drip = report.phaseDrip;
  assert.ok(drip, 'drip phase present');
  assert.equal(drip.rejected, true);
  assert.match(drip.errorMessage, /deadline exceeded/i);
  assert.ok(drip.elapsedMs >= 250, 'drip deadline did not fire prematurely');
  assert.ok(drip.elapsedMs < 2500, 'drip deadline was bounded');
  assert.ok(drip.bytesArrivingBeforeDeadline > 8, 'bytes kept arriving while waiting');

  const pool = report.phasePool;
  assert.ok(pool, 'pool phase present');
  assert.equal(pool.heldOrdinaryRequests, 8);
  assert.equal(pool.serverObservedHeld, 8, 'eight ordinary sockets were occupied');
  assert.equal(pool.ninthRejected, true);
  assert.match(pool.ninthErrorMessage, /deadline exceeded/i);
  assert.ok(pool.ninthElapsedMs >= 400, 'queued deadline did not fire prematurely');
  assert.ok(pool.ninthElapsedMs < 3000, 'queued deadline was bounded');
  assert.equal(pool.ninthReachedServer, false, 'queued request never reached the origin');
  assert.equal(pool.abortedWithoutResolving, true);
  assert.equal(pool.poolReleased, true);
  assert.equal(pool.rpcAfterReleaseOk, true);
  assert.ok(pool.rpcAfterReleaseElapsedMs < 2000);

  assert.equal(origin.state.maxHoldJson, 8, 'origin observed exactly eight held JSON sockets');
  assert.ok(origin.state.rpcCount >= 2, 'origin served rpc before and after the pool test');
  assert.ok(proxy.proxyState.connectCount >= 20, 'all traffic used CONNECT');
  assert.ok(
    proxy.proxyState.rejectedHosts.includes('example.invalid:443'),
    'proxy still only maps fixture.invalid',
  );

  fixtureDump.origin = {...origin.state};
  fixtureDump.proxy = {...proxy.proxyState};
  writeResult({passed: true, report, fixture: fixtureDump});
  console.log(JSON.stringify({
    passed: true,
    result: path.relative(repoRoot, resultPath),
    heldStreams: streaming.heldStreams,
    rpcElapsedMs: streaming.rpcElapsedMs,
    dripDeadlineMs: drip.elapsedMs,
    queuedDeadlineMs: pool.ninthElapsedMs,
    connects: proxy.proxyState.connectCount,
  }));
}

try {
  await main();
} catch (error) {
  writeResult({
    passed: false,
    error: error && error.stack ? error.stack : String(error),
    report,
    fixture: fixtureDump,
  });
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
} finally {
  for (const interval of intervals) clearInterval(interval);
  intervals.clear();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  for (const socket of sockets) socket.destroy();
  for (const socket of upstreamSockets) socket.destroy();
  sockets.clear();
  upstreamSockets.clear();
  await closeServer(httpsServer);
  await closeServer(proxyServer);
  fs.rmSync(tempRoot, {recursive: true, force: true});
}
