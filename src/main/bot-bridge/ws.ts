// @ts-nocheck
// Source: local Bots-API project; native account transport, copied without credentials.
// Minimal RFC 6455 WebSocket client, text/binary frames only.
//
// The gateway has no npm dependencies on purpose (it is copied into the .app
// as-is), so this implements just enough of the protocol for the ChatGPT pubsub
// socket: handshake, masked client frames, fragmentation, ping/pong and close.
// Connections can tunnel through the same HTTP CONNECT proxy as the HTTPS
// client in ./http.mjs.

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { resolveProxy } from './http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 32 * 1024 * 1024;
const MAX_HANDSHAKE = 64 * 1024;

function abortError() {
  const err = new Error('请求已取消');
  err.name = 'AbortError';
  return err;
}

function withTimeout(promise, ms, label) {
  let timer;
  // The losing branch of the race must not surface as an unhandled rejection.
  const guarded = promise.finally(() => clearTimeout(timer));
  guarded.catch(() => {});
  return Promise.race([
    guarded,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    }),
  ]);
}

/**
 * Open a TCP socket to `host:port`, optionally through an HTTP CONNECT proxy.
 * For wss the returned socket is already TLS-wrapped.
 */
function connectSocket({ host, port, proxyUrl, servername, secure = true }) {
  return new Promise((resolve, reject) => {
    const finish = (socket) => {
      socket.setNoDelay?.(true);
      socket.setKeepAlive?.(true, 30_000);
      resolve(socket);
    };

    if (!proxyUrl) {
      const socket = secure
        ? tls.connect({ host, port, servername, ALPNProtocols: ['http/1.1'] }, () => finish(socket))
        : net.connect({ host, port }, () => finish(socket));
      socket.once('error', reject);
      return;
    }

    const proxy = new URL(proxyUrl);
    const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
    const raw = net.connect({ host: proxy.hostname, port: proxyPort });
    let head = Buffer.alloc(0);

    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      if (head.length > MAX_HANDSHAKE) {
        raw.destroy(new Error('Proxy CONNECT response too large'));
        return;
      }
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      raw.removeListener('data', onData);
      const header = head.subarray(0, end).toString('latin1');
      const statusLine = header.split('\r\n')[0] || '';
      const status = Number(statusLine.split(' ')[1]);
      if (status !== 200) {
        raw.destroy();
        reject(new Error(`Proxy CONNECT failed: ${statusLine}`));
        return;
      }
      raw.removeListener('error', reject);
      if (!secure) {
        finish(raw);
        return;
      }
      const tlsSocket = tls.connect(
        { socket: raw, servername, ALPNProtocols: ['http/1.1'] },
        () => finish(tlsSocket),
      );
      tlsSocket.once('error', reject);
    };

    raw.on('data', onData);
    raw.once('error', reject);
    raw.once('connect', () => {
      raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
  });
}

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

/**
 * Connect to a ws:// or wss:// URL.
 * @returns {Promise<EventEmitter & {sendText(s:string):void, close():void}>}
 * Events: 'message' (text string), 'close', 'error' (only when listened to).
 */
export async function openWebSocket(rawUrl, { headers = {}, timeoutMs = 15_000, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const url = new URL(rawUrl);
  const secure = url.protocol === 'wss:';
  if (!secure && url.protocol !== 'ws:') throw new Error(`不支持的 WebSocket 协议: ${url.protocol}`);
  const host = url.hostname;
  const port = Number(url.port) || (secure ? 443 : 80);
  const proxy = await resolveProxy(url);
  if (signal?.aborted) throw abortError();

  const socket = await withTimeout(
    connectSocket({ host, port, proxyUrl: proxy, servername: secure ? host : undefined, secure }),
    timeoutMs,
    'WebSocket 连接',
  );

  const key = crypto.randomBytes(16).toString('base64');
  const lines = [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  for (const [name, value] of Object.entries(headers)) {
    if (value != null) lines.push(`${name}: ${value}`);
  }
  socket.write(lines.join('\r\n') + '\r\n\r\n');

  const client = new EventEmitter();
  client.ready = false;
  client.closed = false;
  client.socket = socket;

  let buffer = Buffer.alloc(0);
  let handshakeDone = false;
  let fragments = [];
  let fragmentOpcode = 0;
  let closeSent = false;

  const destroy = (err) => {
    if (client.closed) return;
    client.closed = true;
    clearInterval(client.pingTimer);
    if (err && client.listenerCount('error')) client.emit('error', err);
    client.emit('close', err || null);
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  };

  const sendFrame = (opcode, payload) => {
    if (client.closed || socket.destroyed) return;
    socket.write(encodeFrame(opcode, payload));
  };

  client.sendText = (text) => sendFrame(0x1, Buffer.from(String(text), 'utf8'));
  client.close = () => {
    if (client.closed) return;
    if (!closeSent) {
      closeSent = true;
      const body = Buffer.alloc(2);
      body.writeUInt16BE(1000, 0);
      sendFrame(0x8, body);
    }
    setTimeout(() => destroy(null), 300).unref?.();
  };

  const emitMessage = (text) => client.emit('message', text);

  const handleFrame = (fin, opcode, payload) => {
    if (opcode === 0x8) {
      if (!closeSent) {
        closeSent = true;
        sendFrame(0x8, payload.subarray(0, 2));
      }
      destroy(null);
      return;
    }
    if (opcode === 0x9) {
      sendFrame(0xa, payload);
      return;
    }
    if (opcode === 0xa) return;
    if (opcode === 0x0) {
      fragments.push(Buffer.from(payload));
      if (fin) {
        const data = Buffer.concat(fragments);
        fragments = [];
        if (fragmentOpcode === 0x1 || fragmentOpcode === 0x2) emitMessage(data.toString('utf8'));
      }
      return;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) {
        emitMessage(Buffer.from(payload).toString('utf8'));
      } else {
        fragmentOpcode = opcode;
        fragments = [Buffer.from(payload)];
      }
    }
  };

  const parseFrames = () => {
    while (buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) {
          destroy(new Error('WebSocket frame too large'));
          return;
        }
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_FRAME) {
        destroy(new Error('WebSocket frame too large'));
        return;
      }
      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + len) return;
      let payload = buffer.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        const copy = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i += 1) copy[i] = payload[i] ^ mask[i & 3];
        payload = copy;
      }
      buffer = buffer.subarray(offset + maskLen + len);
      handleFrame(fin, opcode, payload);
      if (client.closed) return;
    }
  };

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (client.closed) return;
    if (!handshakeDone) {
      if (buffer.length > MAX_HANDSHAKE) {
        destroy(new Error('WebSocket handshake response too large'));
        return;
      }
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = buffer.subarray(0, end).toString('latin1');
      buffer = buffer.subarray(end + 4);
      const linesOut = header.split('\r\n');
      const status = Number((linesOut[0] || '').split(' ')[1]);
      if (status !== 101) {
        destroy(new Error(`WebSocket 握手失败: ${linesOut[0] || header.slice(0, 120)}`));
        return;
      }
      const accept = linesOut
        .find((line) => line.toLowerCase().startsWith('sec-websocket-accept:'))
        ?.split(':')[1]
        ?.trim();
      if (accept && accept !== acceptKey(key)) {
        destroy(new Error('WebSocket 握手校验失败'));
        return;
      }
      handshakeDone = true;
      client.ready = true;
      client.emit('open');
    }
    parseFrames();
  };

  socket.on('data', onData);
  socket.once('error', (err) => destroy(err));
  socket.once('close', () => destroy(null));

  client.pingTimer = setInterval(() => {
    if (client.closed) return;
    sendFrame(0x9, Buffer.alloc(0));
  }, 25_000);
  client.pingTimer.unref?.();

  if (signal) {
    const onAbort = () => {
      client.close();
      destroy(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    client.once('close', () => signal.removeEventListener?.('abort', onAbort));
  }

  // Wait for the handshake before handing the socket to callers.
  if (!client.ready) {
    await withTimeout(
      new Promise((resolve, reject) => {
        client.once('open', resolve);
        client.once('error', reject);
        client.once('close', () => reject(new Error('WebSocket 在握手完成前关闭')));
      }),
      timeoutMs,
      'WebSocket 握手',
    );
  }
  return client;
}
