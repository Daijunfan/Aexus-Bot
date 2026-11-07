// @ts-nocheck
// Source: local Bots-API project; native account transport, copied without credentials.
// Dots provider — talks to the ChatGPT backend that powers the official
// ChatGPT desktop app's "Dots" tab.
//
// Auth: the OAuth bearer stored by Codex (same account as the ChatGPT app).
// Conversation: the account's primary Dot = a "messaging room".
// Send: POST /backend-api/messaging/rooms/{room}/messages
// Read: GET  /backend-api/messaging/rooms/{room}/messages?limit=N

import { getChatGptAuth, CredentialError } from './credentials';
import { httpJson } from './http';
import { openWebSocket } from './ws';

const BASE = 'https://chatgpt.com/backend-api';
const POLL_MS = 600;
const STABLE_POLLS = 3;
const REPLY_TIMEOUT_MS = 15 * 60_000;
const WS_QUIET_MS = Number(process.env.BOTS_DOTS_QUIET_MS) || 1_200;

export const provider = {
  id: 'dots',
  name: 'Dots',
  tagline: 'ChatGPT 官方 Dots',
  color: '#10a37f',
};

let roomCache = null;

export function headers(auth) {
  const h = {
    authorization: `Bearer ${auth.accessToken}`,
    origin: 'https://chatgpt.com',
    referer: 'https://chatgpt.com/',
    'oai-language': 'zh-CN',
  };
  if (auth.accountId) h['chatgpt-account-id'] = auth.accountId;
  return h;
}

export async function api(path, { method = 'GET', body, auth }:any = {}):Promise<any> {
  const a = auth || getChatGptAuth();
  if (a.expired) {
    throw new CredentialError('ChatGPT 登录已过期，请运行 `codex login` 后重试。', 'expired');
  }
  try {
    return await httpJson(BASE + path, { method, body, headers: headers(a), timeoutMs: 45_000 });
  } catch (err) {
    if (err?.status === 401) {
      throw new CredentialError('ChatGPT 拒绝了这个会话（401），请运行 `codex login` 刷新登录。', 'unauthorized');
    }
    throw err;
  }
}

function assertOk(res, what) {
  if (res.status < 200 || res.status >= 300) {
    const detail = res.data ? JSON.stringify(res.data).slice(0, 500) : res.text.slice(0, 500);
    throw new Error(`${what}失败：HTTP ${res.status} ${detail}`);
  }
  return res.data;
}

/** Resolve the primary Dot's room id. Cached for 10 minutes. */
export async function getPrimaryRoom({ force = false, auth } = {}) {
  if (!force && roomCache && Date.now() - roomCache.at < 10 * 60_000) return roomCache.roomId;
  const res = await api('/tbo/primary', { auth });
  const data = assertOk(res, '读取 Dots 主会话');
  const roomId = data?.selection?.messaging_room_id;
  if (!roomId) {
    throw new Error('这个 ChatGPT 账号还没有可用的 Dot（/tbo/primary 未返回 messaging_room_id）。请先在 ChatGPT 官方应用里创建一个 Dot。');
  }
  roomCache = { at: Date.now(), roomId };
  return roomId;
}

export function isDot(msg) {
  return typeof msg?.account_user_id === 'string' && msg.account_user_id.startsWith('calpico-member-');
}

export function textOf(msg) {
  const content = msg?.content;
  if (!content) return '';
  if (typeof content.text === 'string') return content.text;
  if (Array.isArray(content.parts)) return content.parts.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  return '';
}

async function getLiveUrl(auth) {
  const res = await api('/celsius/ws/user', { auth });
  const data = assertOk(res, '获取 Dots 实时通道');
  const url = data?.websocket_url;
  if (!url) throw new Error('Dots 没有返回实时通道地址');
  return url;
}

/**
 * Open the account-wide pubsub socket and subscribe to the messaging topic.
 * The reply itself is still a complete message — the socket just delivers it
 * the moment it is created, plus typing/turn state that polling cannot see.
 */
export async function openLiveStream({ auth, room, signal }:any):Promise<any> {
  const url = await getLiveUrl(auth);
  const ws = await openWebSocket(url, {
    headers: { origin: 'https://chatgpt.com' },
    timeoutMs: 15_000,
    signal,
  });

  const listeners = new Set();
  const pending = new Map();
  let nextId = 1;

  ws.on('message', (raw) => {
    let frames;
    try {
      frames = JSON.parse(raw);
    } catch {
      return;
    }
    for (const frame of Array.isArray(frames) ? frames : [frames]) {
      if (!frame || typeof frame !== 'object') continue;
      if (process.env.BOTS_DEBUG && frame.type === 'message') {
        console.log(`[dots] frame ${frame.topic_id} ${frame.payload?.type}`);
      }
      if (frame.type === 'reply' && frame.id != null) {
        const resolve = pending.get(String(frame.id));
        if (resolve) {
          pending.delete(String(frame.id));
          resolve(frame);
        }
        continue;
      }
      for (const listener of listeners) listener(frame);
    }
  });

  const replyFor = (id, ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        resolve(null);
      }, ms);
      timer.unref?.();
      pending.set(String(id), (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });

  // Register the waiter before writing: an ack can arrive in the same tick.
  const command = (cmd, waitMs = 0) => {
    const id = nextId++;
    const waiter = waitMs ? replyFor(id, waitMs) : null;
    ws.sendText(JSON.stringify([{ command: cmd, id }]));
    return { id, waiter };
  };

  const conn = command(
    { type: 'connect', presence: { type: 'presence', state: 'foreground' } },
    4_000,
  );
  const sub = command({ type: 'subscribe', topic_id: 'calpico-chatgpt-messaging' }, 4_000);
  const liveSub = command({ type: 'subscribe', topic_id: `calpico-room-live:${room}` }, 4_000);

  const [, subscribed, liveSubscribed] = await Promise.all([
    conn.waiter,
    sub.waiter,
    liveSub.waiter,
  ]);
  if (process.env.BOTS_DEBUG) {
    console.log(
      `[dots] subscribe messaging=${JSON.stringify(subscribed?.reply)} roomLive=${JSON.stringify(liveSubscribed?.reply)}`,
    );
  }
  if (!subscribed) {
    ws.close();
    throw new Error('订阅 Dots 消息主题超时');
  }

  return {
    ws,
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      ws.close();
    },
  };
}

