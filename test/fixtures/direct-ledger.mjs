import fs from 'node:fs'
import path from 'node:path'

/** Minimal builders for the real DirectState shape (src/main/direct-messages.ts). */

export function directImage(id, name = 'photo.png', bytes = 1) {
  return {path: `@direct/${id}/${name}`, name, bytes, mimeType: 'image/png', kind: 'image'}
}

export function directFile(id, name = 'report.txt', bytes = 1, mimeType = 'text/plain') {
  return {path: `@direct/${id}/${name}`, name, bytes, mimeType, kind: 'file'}
}

export function directEntry({id, sequence, createdAt, author, text = '', attachments = [], delivery, reply, clientMessageId}) {
  return {
    id,
    sequence,
    createdAt,
    author,
    text,
    attachments,
    clientMessageId: clientMessageId ?? id,
    fingerprint: 'fixture:' + id,
    ...(delivery ? {delivery} : {}),
    ...(reply ? {reply} : {})
  }
}

export function directState(entries, {revision = 1, readSequence = 0} = {}) {
  return {version: 1, revision, readSequence, entries}
}

/** Seed an isolated employee ledger; reads use the normal versioned DirectState cache. */
export function writeDirectLedger(home, employee, value) {
  const state = Array.isArray(value) ? directState(value) : value
  const directory = path.join(home, 'direct')
  fs.mkdirSync(directory, {recursive: true, mode: 0o700})
  const file = path.join(directory, employee + '.json')
  fs.writeFileSync(file, JSON.stringify(state))
  return file
}
