// @ts-nocheck
// Source: local Bots-API project; native account transport, copied without credentials.
// Small, dependency-free HTTPS client with HTTP CONNECT proxy support.
//
// Node's built-in fetch ignores proxy environment variables (unless the whole
// process is launched with NODE_USE_ENV_PROXY=1), and both chatgpt.com and
// api2.cursor.sh are frequently only reachable through a local proxy. So we
// build an https.Agent whose sockets tunnel through the configured proxy.

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {once} from 'node:events';
import { execFile } from 'node:child_process';

export class HttpError extends Error {
  constructor(message, { status = 0, body = '', url = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

let proxyCache = null;

function systemProxyFromScutil() {
  return new Promise((resolve) => {
    execFile('scutil', ['--proxy'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const enabled = /HTTPSEnable\s*:\s*1/.test(stdout) || /HTTPEnable\s*:\s*1/.test(stdout);
      if (!enabled) return resolve(null);
      const httpsHost = stdout.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
      const httpsPort = stdout.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
      const httpHost = stdout.match(/HTTPProxy\s*:\s*(\S+)/)?.[1];
      const httpPort = stdout.match(/HTTPPort\s*:\s*(\d+)/)?.[1];
      const host = httpsHost || httpHost;
      const port = httpsPort || httpPort;
      if (!host) return resolve(null);
      resolve(`http://${host}:${port || 80}`);
    });
  });
}

function envProxy() {
  const raw =
    process.env.BOTS_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    null;
  if (!raw) return null;
  return raw.includes('://') ? raw : `http://${raw}`;
}

/** Resolve the proxy for a URL. Localhost always goes direct. */
export async function resolveProxy(url) {
  const host = typeof url === 'string' ? new URL(url).hostname : url.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
  if (process.env.BOTS_NO_PROXY === '1') return null;
  const fromEnv = envProxy();
  if (fromEnv) return fromEnv;
  if (!proxyCache || Date.now() - proxyCache.at > 60_000) {
    proxyCache = { at: Date.now(), value: await systemProxyFromScutil() };
  }
  return proxyCache.value;
}

const agentCache = new Map();

function makeProxyAgent(proxyUrl, stream=false) {
  const proxy = new URL(proxyUrl);
  const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);

  // Must be a subclass: node only consults Agent#createConnection, not a
  // createConnection property passed in the options object.
  class ProxyAgent extends https.Agent {
    createConnection(options, callback) {
      const targetHost = options.host;
      const targetPort = Number(options.port) || 443;
      const connectReq = http.request({
        host: proxy.hostname,
        port: proxyPort,
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        headers: { Host: `${targetHost}:${targetPort}` },
        agent: false,
        timeout: 15_000,
      });
      connectReq.once('timeout', () => {
        connectReq.destroy(new Error(`Proxy CONNECT timed out (${proxy.host})`));
      });
      connectReq.once('error', (err) => callback(err));
      connectReq.once('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          callback(new Error(`Proxy CONNECT failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }
        const tlsSocket = tls.connect(
          { socket, servername: targetHost, ALPNProtocols: ['http/1.1'] },
          () => callback(null, tlsSocket),
        );
        tlsSocket.once('error', (err) => callback(err));
      });
      connectReq.end();
    }
  }

  return new ProxyAgent({ keepAlive: true, maxSockets: stream ? Infinity : 8 });
}

function agentForProxy(proxyUrl,stream=false) {
  const key=proxyUrl+':'+(stream?'stream':'request');
  if (agentCache.has(key)) return agentCache.get(key);
  const agent = makeProxyAgent(proxyUrl,stream);
  agentCache.set(key, agent);
  return agent;
}

/**
 * Perform an HTTPS/HTTP request and buffer the response as JSON.
 * @returns {Promise<{status:number, headers:object, data:any, text:string}>}
 */
export async function httpJson(url, opts = {}):Promise<any> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 60_000,
    signal,
    maxBytes = 16 * 1024 * 1024,
    expectJson = true,
  } = opts;

  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const proxy = await resolveProxy(target);
  const agent = proxy && isHttps ? agentForProxy(proxy) : undefined;
  const streaming=body?.[Symbol.asyncIterator];
  const payload = body == null || streaming ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    let absoluteTimer;
    const req = (isHttps ? https : http).request(
      target,
      {
        method,
        agent,
        signal,
        headers: {
          accept: 'application/json',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error(`Response larger than ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(absoluteTimer);
          const bytes = Buffer.concat(chunks);
          const text = expectJson ? bytes.toString('utf8') : '';
          let data = null;
          if (expectJson && text) {
            try {
              data = JSON.parse(text);
            } catch {
              // leave data null; callers see status/text
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, data, text, bytes });
        });
        res.on('error', (err) => reject(new HttpError(err.message, { url })));
      },
    );

    absoluteTimer=setTimeout(()=>{const error=new Error(`Request deadline exceeded after ${timeoutMs}ms`);req.destroy(error);reject(error)},timeoutMs);
    req.once('error',()=>clearTimeout(absoluteTimer));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${method} ${target.host}${target.pathname}`));
    });
    req.on('error', (err) => {
      if (err?.name === 'AbortError') return reject(err);
      reject(new HttpError(err.message, { url }));
    });
    if(streaming){void(async()=>{try{for await(const chunk of body)if(!req.write(chunk))await once(req,'drain');req.end()}catch(error){req.destroy(error)}})()}
    else{if (payload) req.write(payload);req.end();}
  });
}

/**
 * Issue a request and hand back the live response stream instead of buffering.
 * Used for Connect server-streaming and SSE-style upstreams. The caller owns
 * `res` and must consume/abort it.
 * @returns {Promise<{status:number, headers:object, res:import('node:http').IncomingMessage, req:import('node:http').ClientRequest}>}
 */
export async function httpStream(url, opts = {}):Promise<any> {
  const {
    method = 'POST',
    headers = {},
    body,
    timeoutMs = 120_000,
    signal,
  } = opts;

  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const proxy = await resolveProxy(target);
  const agent = proxy && isHttps ? agentForProxy(proxy,true) : undefined;
  const streaming=body?.[Symbol.asyncIterator];
  const payload = body == null || streaming ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      target,
      {
        method,
        agent,
        signal,
        headers: {
          accept: 'application/json',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          ...(payload ? { 'content-length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        // Idle timeout: heartbeats keep a healthy stream alive.
        req.setTimeout(timeoutMs, () => {
          res.destroy(new Error(`Stream idle for ${timeoutMs}ms: ${method} ${target.host}${target.pathname}`));
        });
        resolve({ status: res.statusCode, headers: res.headers, res, req, url });
      },
    );
    req.on('error', (err) => {
      if (err?.name === 'AbortError') return reject(err);
      reject(new HttpError(err.message, { url }));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** JSON request that throws a descriptive HttpError on non-2xx. */
export async function requestJson(url, opts = {}) {
  const res = await httpJson(url, opts);
  if (res.status < 200 || res.status >= 300) {
    const detail = res.data ? JSON.stringify(res.data).slice(0, 800) : res.text.slice(0, 800);
    throw new HttpError(`${opts.method || 'GET'} ${new URL(url).pathname} → HTTP ${res.status}: ${detail}`, {
      status: res.status,
      body: res.text,
      url,
    });
  }
  if (res.data == null) {
    throw new HttpError(`Expected JSON from ${url}, got non-JSON response`, {
      status: res.status,
      body: res.text,
      url,
    });
  }
  return res.data;
}
