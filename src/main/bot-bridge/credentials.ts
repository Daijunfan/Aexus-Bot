// @ts-nocheck
// Source: local Bots-API project; native account transport, copied without credentials.
// Credential access for the two official apps, without launching them.
//
// Both apps keep long-lived sessions on disk:
//   • ChatGPT / Codex  -> ~/.codex/auth.json (OAuth access token)
//   • Grok Bot         -> ~/Library/Application Support/Grok Bot/sand-secrets.json
//                         (v10 blobs encrypted with a Keychain-held password)
//
// Nothing here writes tokens to disk or logs them. Values live in memory only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const CHATGPT_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
export const GROK_APP_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Grok Bot');
export const GROK_SECRETS_PATH = path.join(GROK_APP_DIR, 'sand-secrets.json');

const GROK_KEYCHAIN = { service: 'Grok Bot Safe Storage', account: 'Grok Bot Key' };

export class CredentialError extends Error {
  constructor(message, code = 'credential_error') {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
  }
}

export function decodeJwt(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  try {
    const part = token.split('.')[1];
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Only ever show a token's shape, never its value. */
export function redact(token) {
  if (!token || typeof token !== 'string') return null;
  return `${token.slice(0, 3)}…${token.slice(-2)} (${token.length} chars)`;
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new CredentialError(
        `${label} not found at ${file}. Open the app once (or run \`codex login\`) so it can store a session.`,
        'missing',
      );
    }
    throw new CredentialError(`Cannot read ${label} at ${file}: ${err.message}`, 'unreadable');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CredentialError(`${label} at ${file} is not valid JSON: ${err.message}`, 'corrupt');
  }
}

/* ------------------------------------------------------------------ ChatGPT */

export function getChatGptAuth() {
  const data = readJson(CHATGPT_AUTH_PATH, 'ChatGPT/Codex session');
  const tokens = data.tokens || {};
  const accessToken = tokens.access_token || data.OPENAI_API_KEY;
  if (!accessToken) {
    throw new CredentialError(
      'No ChatGPT access token found. Run `codex login` (or open the ChatGPT app) and try again.',
      'missing_token',
    );
  }

  const claims = decodeJwt(accessToken) || {};
  const auth = claims['https://api.openai.com/auth'] || {};
  const expiresAt = claims.exp ? claims.exp * 1000 : null;

  return {
    provider: 'dots',
    accessToken,
    refreshToken: tokens.refresh_token || null,
    accountId: tokens.account_id || auth.chatgpt_account_id || null,
    userId: auth.chatgpt_user_id || auth.user_id || null,
    email: claims.email || null,
    plan: auth.chatgpt_plan_type || null,
    expiresAt,
    expired: expiresAt ? expiresAt < Date.now() + 60_000 : false,
    source: CHATGPT_AUTH_PATH,
  };
}

/* ----------------------------------------------------------------- Grok Bot */

function keychainPassword() {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', GROK_KEYCHAIN.service, '-a', GROK_KEYCHAIN.account, '-w'],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
  } catch (err) {
    throw new CredentialError(
      `Cannot read "${GROK_KEYCHAIN.service}" from the macOS Keychain. ` +
        'Open Grok Bot once so macOS stores its Safe Storage key, then allow access when prompted.',
      'keychain',
    );
  }
}

function decryptV10(blob, password) {
  if (typeof blob !== 'string' || !blob.startsWith('djEw')) {
    // "v10" base64-encoded. Some builds store plaintext behind a prefix.
    if (typeof blob === 'string' && blob.startsWith('plaintext:v1:')) {
      return blob.slice('plaintext:v1:'.length);
    }
    throw new CredentialError('Unexpected encrypted value format in Grok secrets', 'decrypt_failed');
  }
  const padded = blob + '='.repeat((4 - (blob.length % 4)) % 4);
  const raw = Buffer.from(padded, 'base64');
  if (raw.subarray(0, 3).toString('latin1') !== 'v10') {
    throw new CredentialError('Grok secret is not a v10 blob', 'decrypt_failed');
  }
  const key = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const iv = Buffer.alloc(16, 0x20); // Chromium uses 16 spaces for v10
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(raw.subarray(3)), decipher.final()]);
  const pad = plain[plain.length - 1];
  if (!pad || pad > 16) throw new CredentialError('Bad padding while decrypting Grok secret', 'decrypt_failed');
  return plain.subarray(0, plain.length - pad).toString('utf8');
}

let grokCache = null;

/** Native machine identity and sealed-file key, kept inside the local Core only. */
export function getGrokComputerKeys() {
  const data = readJson(GROK_SECRETS_PATH, 'Grok Bot session'), password = keychainPassword();
  const machineId = decryptV10(data['cursor-machine-id'], password);
  const fileKey = decryptV10(data['local-exec-file-key'], password);
  if (!/^[0-9A-Za-z_-]{1,127}$/.test(machineId) || Buffer.from(fileKey, 'base64').length !== 32) {
    throw new CredentialError('Grok Bot has no usable native computer identity. Connect this Mac once in Grok Bot.', 'missing_computer');
  }
  return {machineId, fileKey};
}

export function getGrokAuth({ maxAgeMs = 60_000 } = {}) {
  if (grokCache && Date.now() - grokCache.cachedAt < maxAgeMs) return grokCache.value;

  const data = readJson(GROK_SECRETS_PATH, 'Grok Bot session');
  let accounts;
  try {
    accounts = typeof data['cursor-accounts'] === 'string'
      ? JSON.parse(data['cursor-accounts'])
      : data['cursor-accounts'];
  } catch (err) {
    throw new CredentialError(`Grok account blob is malformed: ${err.message}`, 'corrupt');
  }
  if (!accounts?.accounts || !accounts.active || !accounts.accounts[accounts.active]) {
    throw new CredentialError('No active Grok Bot account found. Sign in to Grok Bot once.', 'missing_account');
  }

  const password = keychainPassword();
  const activeId = accounts.active;
  const account = accounts.accounts[activeId];

  const accessToken = decryptV10(account['cursor-access-token'], password);
  const refreshToken = account['cursor-refresh-token']
    ? decryptV10(account['cursor-refresh-token'], password)
    : null;

  let profile = null;
  if (account['cursor-account-profile']) {
    try {
      profile = JSON.parse(decryptV10(account['cursor-account-profile'], password));
    } catch {
      // Profile is decorative (name/email); never fail auth over it.
    }
  }

  const claims = decodeJwt(accessToken) || {};
  const expiresAt = claims.exp ? claims.exp * 1000 : null;

  const value = {
    provider: 'grok',
    accessToken,
    refreshToken,
    accountId: activeId,
    email: profile?.email || claims.email || null,
    name: profile?.name || null,
    expiresAt,
    expired: expiresAt ? expiresAt < Date.now() + 60_000 : false,
    source: GROK_SECRETS_PATH,
  };
  grokCache = { cachedAt: Date.now(), value };
  return value;
}

export function clearCredentialCache() {
  grokCache = null;
}

/** Local, offline snapshot used by /health — never throws. */
export function credentialStatus() {
  const out = {
    dots: { configured: false, source: CHATGPT_AUTH_PATH, error: null, plan: null, expiresAt: null },
    grok: { configured: false, source: GROK_SECRETS_PATH, error: null, name: null, expiresAt: null },
  };
  try {
    const a = getChatGptAuth();
    out.dots = {
      configured: true,
      source: a.source,
      error: a.expired ? 'ChatGPT token expired — run `codex login`' : null,
      plan: a.plan,
      expiresAt: a.expiresAt,
      expired: a.expired,
    };
  } catch (err) {
    out.dots.error = err.message;
  }
  try {
    const g = getGrokAuth();
    out.grok = {
      configured: true,
      source: g.source,
      error: g.expired ? 'Grok Bot token expired — open Grok Bot once' : null,
      name: g.name,
      email: g.email,
      expiresAt: g.expiresAt,
      expired: g.expired,
    };
  } catch (err) {
    out.grok.error = err.message;
  }
  return out;
}
