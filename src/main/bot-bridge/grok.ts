// @ts-nocheck
// Source: local Bots-API project; native account transport, copied without credentials.
// Grok Bot provider — talks to the Cursor-hosted Grok Bot backend used by the
// official "Grok Bot" desktop app.
//
// Protocol: Connect RPC over HTTPS at api2.cursor.sh.
//   ListGrokBotAgents                  → agents owned by this account
//   SendGrokBotUserMessage             → deliver a user turn to an agent
//   ListGrokBotTranscriptEntries       → read the conversation transcript
//
// Transcript entry formats (body is base64 JSON):
//   { kind:"message", role:"user", content, clientNonce, requestId, ... }
//   { kind:"send-message", message:{type:"text",content}, requestId, ... }   ← the reply
//   { kind:"message", role:"assistant", toAgent:{...} }                      ← agent↔agent noise

import { EventEmitter } from 'node:events';
import { getGrokAuth, CredentialError } from './credentials';
import { httpJson, httpStream } from './http';
import type {BotIssue} from '../../shared/bot-workers';

const BASE = 'https://api2.cursor.sh/aiserver.v1.GrokBotService/';
const WATCH_IDLE_MS = 150_000; // heartbeats every few seconds keep this alive
const WATCH_MAX_FRAME = 32 * 1024 * 1024;

export const provider = {
  id: 'grok',
  name: 'Grok Bot',
  tagline: 'Cursor Grok Bot 团队智能体',
  color: '#c9a0ff',
};

function headers(auth) {
  return {
    authorization: `Bearer ${auth.accessToken}`,
    'connect-protocol-version': '1',
    'x-cursor-client-type':'sand',
    'x-cursor-client-version':'0.78.5',
    'x-cursor-client-os':'darwin',
    'x-cursor-client-source':'sand-desktop',
    'x-sand-box-namespace':'prod',
  };
}

export async function rpc(method, body, { auth, timeoutMs = 45_000, service = 'GrokBotService' } = {}) {
  const a = auth || getGrokAuth();
  if (a.expired) {
    throw new CredentialError('Grok Bot 登录已过期，请打开一次 Grok Bot 应用刷新会话。', 'expired');
  }
  let res;
  try {
    res = await httpJson(`https://api2.cursor.sh/aiserver.v1.${service}/${method}`, {
      method: 'POST',
      body: body || {},
      headers: {...headers(a),'connect-timeout-ms':String(timeoutMs)},
      timeoutMs,
    });
  } catch (err) {
    throw new Error(`Grok Bot ${method} 网络错误：${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CredentialError('Grok Bot 拒绝了这个会话（401/403），请打开一次 Grok Bot 应用。', 'unauthorized');
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = res.data ? JSON.stringify(res.data).slice(0, 600) : res.text.slice(0, 600);
    throw new Error(`Grok Bot ${method} 失败：HTTP ${res.status} ${detail}`);
  }
  return res.data || {};
}

export function turnFailure(value):BotIssue {
  const details=value.errorDetails?.details,reset=Date.parse(details?.additionalInfo?.nextResetAt??'');
  return {code:value.code||'GROK_BOT_TURN_FAILURE',message:value.summary||details?.title||'Grok Bot could not complete this request',detail:details?.detail,at:Number(value.failedAtMs)||Date.now(),turnId:value.turnId,...(Number.isFinite(reset)?{retryAt:reset}:{})};
}

let usageCache;
export function invalidateUsage(){usageCache=undefined;}
/** Read-only account availability; never changes a plan or enables spending. */
export function usageStatus(){
  const auth=getGrokAuth(),now=Date.now();
  if(usageCache?.accountId===auth.accountId&&now-usageCache.at<60_000)return usageCache.promise;
  const promise=rpc('GetSandUsageStatus',{}, {auth,service:'DashboardService'}).then(value=>{
    if(typeof value.hasAvailableUsage!=='boolean')throw Error('Grok did not return account availability');
    const reset=Date.parse(value.nextResetTimestampUtc??'');
    // The native endpoint can report hasAvailableUsage=true at 100% while
    // on-demand is disabled; actual turns then fail with USAGE_LIMIT.
    const exhausted=!value.hasAvailableUsage||value.usagePercent>=100&&value.onDemandSettings?.enabled!==true;
    const issue:BotIssue|null=exhausted?{code:'GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT',message:'Your Grok Bot usage limit has been reached',at:now,...(Number.isFinite(reset)?{retryAt:reset}:{})}:null;
    return {issue,checkedAt:now};
  });
  usageCache={accountId:auth.accountId,at:now,promise};
  promise.catch(()=>{if(usageCache?.promise===promise)invalidateUsage();});
  return promise;
}

export async function ensureRunning(){
  const result=await rpc('EnsureSandBox',{wake:true,supportsAsleepBox:true},{timeoutMs:90_000});
  if(result.runState!=='SAND_BOX_RUN_STATE_RUNNING')throw Error('Grok Bot is still starting. Try sending again shortly.');
}

export function replyText(body) {
  const msg = body?.message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part) => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('');
  }
  return '';
}

function streamHeaders(auth) {
  return {
    ...headers(auth),
    accept: 'application/connect+json',
    'content-type': 'application/connect+json',
  };
}

/** Connect server-streaming requests carry a 5-byte envelope per message. */
function connectEnvelope(json) {
  const payload = Buffer.from(JSON.stringify(json), 'utf8');
  const head = Buffer.alloc(5);
  head[0] = 0x00;
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

function readSome(res, max = 8 * 1024) {
  return new Promise((resolve) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      text += chunk;
      if (text.length >= max) {
        res.destroy();
        resolve(text.slice(0, max));
      }
    });
    res.on('end', () => resolve(text));
    res.on('error', () => resolve(text));
  });
}

/**
 * Open WatchGrokBotTranscripts and emit decoded frames.
 * Events: 'rows' (rows payload), 'connected', 'tooOld', 'turnFailed',
 *         'endStream' (json), 'end', 'streamError'.
 */
export async function openWatch({ agentId, afterUpdatedSeq, auth, signal }:any):Promise<any> {
  const { status, res, req } = await httpStream(BASE + 'WatchGrokBotTranscripts', {
    method: 'POST',
    headers: streamHeaders(auth),
    body: connectEnvelope({
      cursors: [
        {
          agentId,
          generation: '0',
          afterUpdatedSeq: String(afterUpdatedSeq || 0),
          sessionId: '',
        },
      ],
      inlineBodyMaxBytes: 65536,
    }),
    timeoutMs: WATCH_IDLE_MS,
    signal,
  });

  if (status !== 200) {
    const detail = await readSome(res);
    throw new Error(`Grok Bot WatchGrokBotTranscripts 失败：HTTP ${status} ${detail.slice(0, 600)}`);
  }

  const emitter = new EventEmitter();
  let buffer = Buffer.alloc(0);
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      req.destroy();
    } catch {
      // already gone
    }
  };
  emitter.close = close;

  const handleFrame = (frame) => {
    if (!frame || typeof frame !== 'object') return;
    if (frame.rows) emitter.emit('rows', frame.rows);
    else if (frame.cursorTooOld || frame.cursor_too_old) emitter.emit('tooOld', frame);
    else if (frame.turnFailed || frame.turn_failed) {
      emitter.emit('turnFailed', frame.turnFailed || frame.turn_failed);
    } else if (frame.connected) emitter.emit('connected', frame.connected);
  };

  res.on('data', (chunk) => {
    if (closed) return;
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (buffer.length >= 5) {
      const flag = buffer[0];
      const len = buffer.readUInt32BE(1);
      if (len > WATCH_MAX_FRAME) {
        emitter.emit('streamError', new Error('Grok Bot 实时帧过大'));
        close();
        return;
      }
      if (buffer.length < 5 + len) break;
      const payload = buffer.subarray(5, 5 + len);
      buffer = buffer.subarray(5 + len);
      let json = {};
      if (len) {
        try {
          json = JSON.parse(payload.toString('utf8'));
        } catch {
          continue;
        }
      }
      if (flag === 0x02) {
        emitter.emit('endStream', json);
        close();
        return;
      }
      if (flag === 0x00) handleFrame(json);
    }
  });

  res.on('end', () => emitter.emit('end'));
  res.on('error', (err) => {
    if (!closed) emitter.emit('streamError', err);
  });
  res.on('aborted', () => emitter.emit('streamError', new Error('Grok Bot 实时通道中断')));

  if (signal) {
    const onAbort = () => {
      close();
      emitter.emit('streamError', abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    emitter.once('end', () => signal.removeEventListener('abort', onAbort));
    emitter.once('endStream', () => signal.removeEventListener('abort', onAbort));
  }

  return emitter;
}

function abortError() {
  const err = new Error('请求已取消');
  err.name = 'AbortError';
  return err;
}
