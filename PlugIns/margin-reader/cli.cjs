#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const { ReaderError, assert, errorResponse } = require('./lib/safety.cjs');
const schema = require('./schema.json');
async function createClient(workspace, options) {
  const mailbox = process.env.AGENTS_COMPANY_PLUGIN_RPC;
  if (mailbox) return require('./lib/mailbox.cjs').mailboxClient(workspace, mailbox, options);
  assert(!process.env.AGENTS_COMPANY_EMPLOYEE, 'HOST_UNAVAILABLE', 'An employee must use its assigned plugin mailbox. Reopen the employee; standalone fallback is disabled.');
  return require('./runtime.cjs').createPlugin({ workspace, pluginRoot: __dirname, executable: process.execPath });
}
function describeCommand(name) {
  const command = schema.commands.find(item => item.method === name);
  assert(command, 'METHOD_NOT_FOUND', `Unknown API method: ${name}. Run schema to list all commands.`);
  return { pluginId: schema.pluginId, version: schema.version, transport: schema.transport, ...command };
}
// Task-focused discovery is only a guide to public schema methods.
// No extra runtime method, hidden credential or workspace-wide database is introduced.
const workflowMethods = {
  database: ['study.list', 'study.get', 'study.board.query', 'study.board.save', 'study.board.remove', 'study.cards.query', 'study.cards.batch', 'study.search'],
  excerpt: ['document.open', 'study.documents.add', 'study.card.create', 'study.card.update', 'study.annotation.update', 'study.cards.query'],
};
function workflowTopic(raw) {
  const topic = String(raw || '').trim().toLowerCase();
  if (['database', 'db', '数据库'].includes(topic)) return 'database';
  if (['excerpt', 'capture', '摘录', '批注'].includes(topic)) return 'excerpt';
  return null;
}
function workflowListing(topic) {
  return workflowMethods[topic].map(method => {
    const command = describeCommand(method);
    return command.method + '\n  ' + command.description;
  }).join('\n') + '\n';
}
function workflowHelp(topic) {
  if (topic === 'database') return [
    'DATABASE / 数据库 — query, save views and bulk-edit excerpts in one authorized workspace',
    'All commands below call the same public Core methods as the database UI.',
    '',
    '1. Find study IDs and their current revisions:',
    '   margin-reader --workspace DIR study list',
    '   margin-reader --workspace DIR study get SET_ID',
    '2. Filter, group and sort cards (two grouping levels; page with --offset):',
    '   margin-reader --workspace DIR study.board.query --set-id SET_ID --filter \'{"query":"term"}\' --group-by \'["document","tag"]\' --sort title --direction desc --limit 50',
    '3. Save a reusable database view, then query it by the returned board ID:',
    '   margin-reader --workspace DIR study.board.save --set-id SET_ID --expected-revision REV --title "Reading queue" --filter \'{"tags":["review"]}\' --sort updated --direction desc',
    '   margin-reader --workspace DIR study.board.query --set-id SET_ID --board-id BOARD_ID',
    '4. Atomically tag selected cards; IDs must come from your own query:',
    '   margin-reader --workspace DIR study.cards.batch --set-id SET_ID --expected-revision REV --card-ids \'["CARD_ID"]\' --patch \'{"addTags":["review"]}\'',
    '',
    'Re-read study.get for REV before writing; stale revisions fail without automatic retry.',
    'Cross-study search: study.search --query TERM --limit 100 --offset 0.',
    'Exact options: help study.board.query | help study.board.save | help study.cards.batch.',
  ].join('\n') + '\n';
  return [
    'EXCERPT / 摘录 — capture original text and its annotation in one transaction',
    'The source document must belong to the selected study; no external source is modified.',
    '',
    '1. Open a source and read its id/sourceVersion:',
    '   margin-reader --workspace DIR document open PATH',
    '2. Create/select a study, then add the source file if needed:',
    '   margin-reader --workspace DIR study list',
    '   margin-reader --workspace DIR study.documents.add --set-id SET_ID --expected-revision REV --paths \'["PATH"]\'',
    '3. Create a capture using schema-validated JSON (see help study.card.create):',
    '   margin-reader --workspace DIR api study.card.create --data @capture.json',
    '   Include setId, expectedRevision, documentId, expectedSourceVersion, captureId (UUID),',
    '   text, locator, color; optionally selection, note, tags, annotationStyle and inMap.',
    '   Flow selection uses UTF-16 {start,end}; PDF text-only captures use a page locator.',
    '4. Find, annotate or edit saved excerpts:',
    '   margin-reader --workspace DIR study.cards.query --set-id SET_ID --query TERM',
    '   margin-reader --workspace DIR study.card.update --set-id SET_ID --card-id CARD_ID --expected-revision REV --note "My observation"',
    '   margin-reader --workspace DIR study.annotation.update --set-id SET_ID --card-id CARD_ID --expected-revision REV --style underline',
    '',
    'TUI shortcut: select text with v or Shift+arrows, then c; n note, t tags, s style; Enter confirms.',
    'Exact options: help study.card.create | help study.cards.query | help study.annotation.update.',
  ].join('\n') + '\n';
}
async function main() {
  if(process.argv[2]==='_complete'){process.stdout.write(require('./lib/cli/completion.cjs').candidates(process.argv.slice(3)).join('\n')+'\n');return;}
  const parsed = await require('./lib/cli/parse.cjs').parse(process.argv.slice(2));
  const {options,positionals} = parsed;
  const [command,...rest] = positionals;
  if (parsed.discovery) {
    const {help,listing} = require('./lib/cli/help.cjs');
    if (options.version) { assert(!command, 'INVALID_PARAMS', '--version takes no command'); process.stdout.write(schema.version+'\n'); return; }
    if (command === 'schema') {
      assert(rest.length<=1, 'INVALID_PARAMS', 'schema [METHOD]');
      process.stdout.write(JSON.stringify(rest.length?describeCommand(rest[0]):schema,null,2)+'\n'); return;
    }
    if (command === 'completion') { assert(rest.length===1,'INVALID_PARAMS','completion bash|zsh|fish'); process.stdout.write(require('./lib/cli/completion.cjs').completion(rest[0])); return; }
    if (command === 'commands') {
      const query = rest.join(' '), workflow = workflowTopic(query);
      process.stdout.write(workflow ? workflowListing(workflow) : listing(query));
      return;
    }
    const topic = command==='help'?rest.join(' '):(options.help?positionals.join(' '):'');
    const workflow = workflowTopic(topic);
    // Historical help METHOD is a machine-readable contract; --output text opts into friendly help.
    if(command==='help' && rest.length===1 && rest[0].includes('.') && !options.output) process.stdout.write(JSON.stringify(describeCommand(rest[0]),null,2)+'\n');
    else process.stdout.write(workflow ? workflowHelp(workflow) : help(topic) + (!topic ? '\nTask guides: help database | help excerpt\n' : ''));
    return;
  }
  const workspaceInput = options.workspace || process.env.AGENTS_WORKSPACE;
  assert(workspaceInput, 'INVALID_WORKSPACE', '--workspace DIR is required, or use AGENTS_WORKSPACE.');
  if (process.env.AGENTS_WORKSPACE) assert(path.resolve(workspaceInput) === path.resolve(process.env.AGENTS_WORKSPACE), 'SCOPE_DENIED', 'Cannot override the assigned AGENTS_WORKSPACE.');
  if (command === 'tui') assert(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb', 'TTY_REQUIRED', 'MarginReader TUI requires interactive TTY input/output and TERM other than dumb. Use list, read --text, or api for redirected output.');
  const workspace = process.env.AGENTS_COMPANY_PLUGIN_RPC ? path.resolve(workspaceInput) : await fs.realpath(workspaceInput);
  if (command === 'serve') {
    assert(!process.env.AGENTS_COMPANY_PLUGIN_RPC && !process.env.AGENTS_COMPANY_EMPLOYEE, 'SCOPE_DENIED', 'A sandboxed employee must use its assigned mailbox, not start another transport.');
    const server = await require('./lib/server.cjs').startServer({ workspace, port: Number(options.port || 0) });
    process.stdout.write(JSON.stringify({ url: server.url, workspace }) + '\n');
    const stop = async () => { process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); await server.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  const client = await createClient(workspace);
  const rpc = async (method, params = {}) => client.request({ jsonrpc: '2.0', id: randomUUID(), method, params });
  const must = async (method, params) => { const reply = await rpc(method, params); if (reply.error) { const error = new ReaderError(reply.error.data?.code || 'RPC_ERROR', reply.error.message, reply.error.data?.details); throw error; } return reply.result; };
  try {
    let reply;
    if (command === 'tui') { const result = await require('./tui/index.cjs').runTui({client,workspace,input:process.stdin,output:process.stdout,errorOutput:process.stderr}); if (result?.degraded) process.exitCode = 1; return; }
    if(parsed.action==='map-render'){
      const p=parsed.params;
      const result=await require('./terminal-visuals/cli.cjs').renderMapSnapshot({request:must,setId:p.setId,columns:p.columns,rows:p.rows,selectedId:p.select,zoom:p.zoom});
      reply={jsonrpc:'2.0',id:randomUUID(),result};
    }
    else if (parsed.method) { reply = await rpc(parsed.method, parsed.params); }
    else if (command === 'import') {
      assert(rest.length === 1 && options.to, 'INVALID_PARAMS', 'Usage: import FILE --to workspace/filename');
      const handle = await fs.open(path.resolve(rest[0]), 'r'); let upload;
      try {
        const st = await handle.stat(); assert(st.isFile(), 'INVALID_FILE', 'Import source must be a regular file.');
        upload = await must('import.begin', { path: options.to, totalBytes: st.size });
        const hash = createHash('sha256'); const buffer = Buffer.alloc(upload.chunkSize); let offset = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) break;
          const bytes = buffer.subarray(0, bytesRead); hash.update(bytes);
          await must('import.chunk', { uploadId: upload.uploadId, offset, contentBase64: bytes.toString('base64') }); offset += bytesRead;
        }
        reply = await rpc('import.finish', { uploadId: upload.uploadId, sha256: hash.digest('hex'), ...(options.password ? { password: options.password } : {}) });
      } catch (e) { if (upload) await rpc('import.abort', { uploadId: upload.uploadId }).catch(() => {}); throw e; }
      finally { await handle.close(); }
    } else if (command === 'api') {
      assert(rest.length === 1, 'INVALID_PARAMS', 'Usage: api METHOD --data JSON|@file|-');
      let raw = options.data || '{}';
      if (raw === '-') raw = fsSync.readFileSync(0, 'utf8'); else if (raw.startsWith('@')) raw = await fs.readFile(raw.slice(1), 'utf8');
      let params; try { params = JSON.parse(raw); } catch { throw new ReaderError('INVALID_PARAMS', '--data must contain valid JSON.'); }
      reply = await rpc(rest[0], params);
    } else { throw new ReaderError('INVALID_PARAMS', 'Unknown command: '+command); }
    process.stdout.write(require('./lib/cli/output.cjs').render(reply,options));
    if (reply.error) { process.exitCode = 1; process.stderr.write(require('./lib/cli/output.cjs').safe(reply.error.data?.code+': '+reply.error.message)+'\n'); }
  } finally { await client.close(); }
}
if (require.main === module) {
  process.stdout.on('error', error => { if(error.code==='EPIPE') { process.exitCode=0; process.stdout.destroy(); } else { process.stderr.write(error.message+'\n'); process.exitCode=1; } });
  main().catch(error => {
    const reply=errorResponse(null,error);
    process.stdout.write(JSON.stringify(reply)+'\n');
    process.stderr.write(require('./lib/cli/output.cjs').safe(reply.error.data.code+': '+reply.error.message)+'\n');
    process.exitCode=1;
  });
}
module.exports = { createClient, describeCommand, main };
