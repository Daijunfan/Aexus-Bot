import {pluginPage} from '../../../test/fixtures/plugin-page.mjs';
import {desktopExecutable} from '../../../test/fixtures/desktop-app.mjs';
// Real Agents Company host, temporary employees, actual bound CLI launchers.
// No session.send, paid models, production workspace, or visible desktop window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const { _electron: electron, expect } = require('@playwright/test');
const plugin = path.resolve(import.meta.dirname, '..');
const root = path.resolve(plugin, '../..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-notion-workspace-')));
const artifacts = process.env.AGENTS_COMPANY_TEST_ARTIFACTS || path.join(plugin, '.local-data/folder-layout-results/ui');
fs.mkdirSync(artifacts, { recursive: true });
fs.mkdirSync(path.join(temp, 'fixture'));
fs.writeFileSync(path.join(temp, 'fixture/release-all'), '');
const env = {
  ...process.env,
  AGENTS_COMPANY_TEST_BOTS_URL:'http://127.0.0.1:1',
  AGENTS_COMPANY_HOME: path.join(temp, 'state'),
  AGENTS_COMPANY_WORKSPACES: path.join(temp, 'work'),
  AGENTS_COMPANY_PROJECTS: path.join(temp, 'projects'),
  // Default to the host's built-in package. An explicit candidate is opt-in only.
  AGENTS_COMPANY_PLUGIN_DIRS: process.env.MINI_NOTION_TEST_PLUGIN || '',
  AGENTS_COMPANY_HIDDEN: '1',
  CODEX_BIN: path.join(root, 'test/fixtures/initialization-codex.cjs'),
  CODEX_HOME: path.join(temp, 'codex'),
  AC_INIT_FIXTURE: path.join(temp, 'fixture'),
};
for (const key of Object.keys(env))
  if (key.startsWith('AGENTS_COMPANY_TOKEN') || ['ELECTRON_RUN_AS_NODE', 'AGENTS_COMPANY_SOCKET', 'AGENTS_COMPANY_URL', 'AGENTS_COMPANY_EMPLOYEE', 'AGENTS_COMPANY_PLUGIN_RPC', 'MINI_NOTION_SOCKET', 'MINI_NOTION_DATA_DIR', 'MINI_NOTION_WORKSPACE'].includes(key)) delete env[key];
const run = promisify(execFile);
const cli = async (...args) => {
  const result = JSON.parse((await run(process.execPath, [path.join(root, 'bin/agents'), ...args, '--json'], { env, cwd: root, timeout: 30000, maxBuffer: 16e6 })).stdout);
  assert.ok(result.ok, result.error);
  return result.data;
};
const team = '文件夹验收团队';
const api = (method, params = {}) => cli('plugin', 'call', 'mininotion', method, '--params', JSON.stringify(params));
const employeeApi = (employee, method, params = {}) => boundCli(employee,method,params);
const employeeTokens=new Map();
const rawBoundCli = async (employee, method, params = {}) => {
  await expect.poll(async()=>(await cli('session','status','--employee',employee.id))[0].initialization.status).toBe('ready');
  if(!employeeTokens.has(employee.id))employeeTokens.set(employee.id,(await cli('auth','agent-token',employee.id)).token);
  const reply=await run(process.execPath,[path.join(root,'bin/agents'),'plugin','call','mininotion',method,'--employee',employee.id,'--params',JSON.stringify(params),'--json'],{cwd:employee.cwd,env:{...env,AGENTS_COMPANY_TOKEN:employeeTokens.get(employee.id)},timeout:30000,maxBuffer:16e6}).catch(error=>{if(!error.stdout)throw error;return {stdout:error.stdout}});
  return JSON.parse(reply.stdout);
};
const boundCli=async(employee,method,params={})=>{const value=await rawBoundCli(employee,method,params);assert.ok(value.ok,value.error);return value.data};
const app = await electron.launch({ executablePath: desktopExecutable(process.env.AGENTS_COMPANY_TEST_APP) || require('../electron/runtime.cjs').electronRuntime().executable, args: process.env.AGENTS_COMPANY_TEST_APP ? [] : [root], env });
const company = await app.firstWindow();
let page = company;
page.setDefaultTimeout(20000);
const errors = [], requests = [], checks = [];
let log = '';
app.process().stderr.on('data', bytes => { log = (log + bytes).slice(-8000); });
const ok = label => { checks.push(label); console.log('PASS ' + label); };
const watch = window => {
  window.on('pageerror', error => errors.push(error.message));
  window.on('request', request => {
    if (/^https?:/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(request.url())) requests.push(request.url());
  });
};
try {
  await page.locator('.agent-board').waitFor();
  const descriptor = await cli('plugin', 'describe', 'mininotion');
  assert.equal(descriptor.plugin?.version ?? descriptor.version, JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'))).version);
  for (const method of ['fs.path', 'fs.bind', 'fs.organize']) assert.ok(descriptor.api.commands.some(command => command.method === method));
  await cli('group', 'add', team);
  const opened = app.waitForEvent('window');
  await cli('plugin', 'open', 'mininotion');
  const hosted=await opened;page = await pluginPage(hosted); page.setDefaultTimeout(20000); watch(page);
  await page.locator('.sidebar').waitFor();
  await expect(page.getByText('工作区页面', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建页面 ⌘N', exact: true }).click();
  await page.getByRole('textbox', { name: '页面标题', exact: true }).fill('用户创建主页面');
  await expect.poll(async () => (await api('page.list')).some(item => item.title === '用户创建主页面')).toBe(true);
  const main = (await api('page.list')).find(item => item.title === '用户创建主页面');
  const location = await api('fs.path', { pageId: main.id });
  assert.equal(path.basename(location.path), 'index.mininotion.json');
  await page.getByRole('button', { name: '页面更多操作', exact: true }).click();
  await page.locator('.folder-page-location summary').click();
  await expect(page.locator('.folder-page-location')).toContainText(location.absoluteDirectory);
  await page.evaluate(() => {
    window.__testCopiedDirectory = null;
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.__testCopiedDirectory = text; } });
  });
  await page.getByRole('button', { name: '复制员工绑定目录', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__testCopiedDirectory)).toBe(location.absoluteDirectory);
  await page.evaluate(() => { delete navigator.clipboard.writeText; delete window.__testCopiedDirectory; });
  await page.keyboard.press('Escape');
  assert.equal(JSON.parse(fs.readFileSync(location.absolutePath)).page.title, main.title);
  ok('the independent portable plugin collection loads its real hosted renderer; GUI main pages retain exact physical folders');

  for (const [parent, title] of [[main, '用户子页面']]) {
    await page.locator(`[data-page-id="${parent.id}"]`).first().hover();
    await page.getByRole('button', { name: `在 ${parent.title} 中添加子页面`, exact: true }).click();
    await page.getByRole('textbox', { name: '页面标题', exact: true }).fill(title);
    await expect.poll(async () => (await api('page.list')).some(item => item.title === title && item.parentId === parent.id)).toBe(true);
  }
  const child = (await api('page.list')).find(item => item.title === '用户子页面');
  assert.equal(path.dirname((await api('fs.path', { pageId: child.id })).absoluteDirectory), location.absoluteDirectory);
  const second = await api('page.create', { title: '第二工作区', color: 'white' });
  const secondLocation = await api('fs.path', { pageId: second.id });
  const employeeA = await cli('card', 'create', '--title', '知识员工', '--group', team, '--engine', 'codex', '--model', 'gpt-6-luna');
  const employeeB = await cli('card', 'create', '--title', '研究员工', '--group', team, '--engine', 'codex', '--model', 'gpt-6-luna');
  assert.notEqual(employeeA.cwd,location.absoluteDirectory);assert.notEqual(employeeB.cwd,secondLocation.absoluteDirectory);
  const grant=async(titles,employee)=>{
    await hosted.getByRole('button',{name:'内容授权',exact:true}).click();const dialog=hosted.getByRole('dialog',{name:'内容授权',exact:true});await expect(dialog).toBeVisible();
    for(const title of titles)await dialog.locator('.plugin-access-resources label').filter({has:hosted.getByText(title,{exact:true})}).getByRole('checkbox').check();
    for(const right of ['阅读','修改','新增'])await dialog.getByRole('checkbox',{name:employee.title+' '+right,exact:true}).check();
    await dialog.getByRole('button',{name:'保存授权',exact:true}).click();await expect(dialog).toHaveCount(0);
  };
  await grant([main.title,child.title],employeeA);await grant([second.title],employeeB);
  for(const employee of [employeeA,employeeB])fs.writeFileSync(path.join(employee.cwd,'employee-original.txt'),employee.id);
  const identities=store=>store.sessions.map(({id,cwd,engine,threadId,group})=>({id,cwd,engine,threadId,group}));

  for (const employee of [employeeA, employeeB]) {
    await cli('workspace', 'docs', '--employee', employee.id);
    const guide=await cli('api','docs','plugin/mininotion/api');assert.match(guide.markdown,/fs\.path/);assert.equal(fs.existsSync(path.join(employee.cwd,'.agents-company/plugins/mininotion/API.md')),false);
    const denied=await rawBoundCli(employee,'fs.info');assert.equal(denied.ok,false);assert.match(denied.error,/页面未授权/);assert.ok((await boundCli(employee,'page.list')).length>0);
  }
  const originalIdentities=identities(await cli('session','list'));assert.equal((await cli('session','list')).teamSettings[team].mode,'build');
  ok('two ordinary employees keep their project workspaces and receive distinct read/write/create page grants through the real host permission dialog; CLI identity tokens observe the same content isolation');

  const agentChild = await boundCli(employeeA, 'page.create', { title: '员工创建的孙页面', parentId: child.id, color: 'white' });
  await boundCli(employeeA, 'block.append', { pageId: agentChild.id, text: '真实员工启动器写入的正文' });
  assert.equal((await api('page.get', { pageId: agentChild.id })).parentId, child.id);
  assert.ok(!(await employeeApi(employeeB, 'page.list')).some(item => item.id === agentChild.id));
  await api('page.open', { pageId: agentChild.id });
  await expect(page.getByRole('textbox', { name: '页面标题', exact: true })).toHaveValue(agentChild.title);
  await expect(page.locator('.bn-editor')).toContainText('真实员工启动器写入的正文');
  await page.getByRole('textbox', { name: '页面标题', exact: true }).fill('用户继续编辑员工页面');
  await expect.poll(async () => (await boundCli(employeeA, 'page.get', { pageId: agentChild.id })).title).toBe('用户继续编辑员工页面');
  assert.equal(path.dirname((await api('fs.path', { pageId: agentChild.id })).absoluteDirectory), (await api('fs.path', {pageId:child.id})).absoluteDirectory);
  ok('GUI and bound employee CLI edit the same recursive pages bidirectionally');

  const db = await boundCli(employeeA, 'database.create', { title: '员工看板', parentId: main.id, color: 'blue', view: 'board' });
  await boundCli(employeeA, 'record.create', { databaseId: db.id, title: 'CLI 看板任务', color: 'white', values: { status: '进行中' } });
  await api('page.open', { pageId: db.id });
  await expect(page.locator('.database')).toContainText('CLI 看板任务');
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'employee-board.png') });
  const unscopedExport=await rawBoundCli(employeeA,'file.export',{pageId:agentChild.id,type:'md',output:'Exports/not-allowed.md'});assert.equal(unscopedExport.ok,false);assert.match(unscopedExport.error,/页面未授权/);
  const exported=await boundCli(employeeA,'page.read-markdown',{pageId:agentChild.id});
  const written=JSON.parse((await run(process.execPath,[path.join(root,'bin/agents'),'workspace','write','Exports/agent-page.md','--employee',employeeA.id,'--content',exported.markdown,'--create','--json'],{cwd:employeeA.cwd,env:{...env,AGENTS_COMPANY_TOKEN:employeeTokens.get(employeeA.id)},timeout:30000,maxBuffer:16e6})).stdout);assert.ok(written.ok,written.error);
  assert.match(fs.readFileSync(path.join(employeeA.cwd, 'Exports/agent-page.md'), 'utf8'), /真实员工启动器写入的正文/);
  ok('employee database and record APIs render the actual board; a bounded Markdown read and authenticated workspace write export only the authorized content into the employee workspace');

  await api('fs.mkdir', { path: '已有目录' });
  await api('fs.write', { path: '已有目录/原文.md', content: '# 原始资料\n' });
  const rawFolder = (await api('page.list')).find(item => item.sourceFile?.path === '已有目录');
  await api('page.open', { pageId: rawFolder.id });
  await expect(page.getByRole('button', { name: '作为主页面编辑', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '页面标题', exact: true })).toHaveValue('已有目录');
  await page.getByRole('textbox', { name: '页面标题', exact: true }).fill('直接编辑已有目录');
  await expect.poll(async () => (await api('page.get', { pageId: rawFolder.id })).title).toBe('直接编辑已有目录');
  assert.equal((await api('page.get', { pageId: rawFolder.id })).sourceFile, undefined);
  assert.equal((await api('fs.read', { path: '已有目录/原文.md' })).content, '# 原始资料\n');
  await api('page.open', { pageId: main.id });
  await page.getByRole('textbox', { name: '页面标题', exact: true }).fill('改名但不移动绑定目录');
  await expect.poll(async () => (await api('page.get', { pageId: main.id })).title).toBe('改名但不移动绑定目录');
  assert.equal((await api('fs.path', { pageId: main.id })).absoluteDirectory, location.absoluteDirectory);assert.equal((await cli('session','list')).sessions.find(card=>card.id===employeeA.id).cwd,employeeA.cwd);
  await page.getByRole('button', { name: '页面更多操作', exact: true }).click();
  await page.locator('.folder-page-location summary').click();
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'shared-workspace.png') });
  ok('existing directory edits need no promotion and preserve originals; GUI rename preserves employee cwd');

  const windows = await cli('plugin', 'windows');
  assert.equal(windows.length, 1, 'This isolated host has exactly one plugin window');
  const window = windows[0];
  assert.ok(window);
  await cli('plugin', 'dismiss', window.id);
  const reopened = app.waitForEvent('window');
  await cli('plugin', 'open', 'mininotion');
  page = await pluginPage(await reopened); watch(page);
  await page.locator('.sidebar').waitFor();
  await api('page.open', { pageId: agentChild.id });
  await expect(page.getByRole('textbox', { name: '页面标题', exact: true })).toHaveValue('用户继续编辑员工页面');
  await expect(page.locator('.bn-editor')).toContainText('真实员工启动器写入的正文');
  ok('close and reopen preserves shared content');
  await cli('plugin', 'dismiss', (await cli('plugin', 'windows'))[0].id);
  const collectionOpened = app.waitForEvent('window');
  await company.locator('.application-plugins [data-plugin="mininotion"]').click();
  page = await pluginPage(await collectionOpened); page.setDefaultTimeout(20000); watch(page);
  await page.locator('.sidebar').waitFor();
  const collection = (await cli('plugin', 'windows'))[0];
  assert.equal(collection.workspace, path.join(env.AGENTS_COMPANY_WORKSPACES, 'mini-notion-workspace'));
  const collectionApi = (method, params = {}) => cli('plugin', 'call', 'mininotion', method, '--params', JSON.stringify(params));
  assert.equal(path.dirname((await collectionApi('fs.path', { pageId: agentChild.id })).absoluteDirectory), (await collectionApi('fs.path', {pageId:child.id})).absoluteDirectory);
  assert.equal((await collectionApi('fs.audit')).valid, true);
  await collectionApi('page.open', { pageId: agentChild.id });
  await expect(page.getByRole('textbox', { name: '页面标题', exact: true })).toHaveValue('用户继续编辑员工页面');
  await expect(page.locator('.bn-editor')).toContainText('真实员工启动器写入的正文');
  await page.getByRole('textbox', { name: '页面标题', exact: true }).fill('默认窗口与员工共用内容');
  await expect.poll(async () => (await boundCli(employeeA, 'page.get', { pageId: agentChild.id })).title).toBe('默认窗口与员工共用内容');
  await page.getByRole('button', { name: '页面更多操作', exact: true }).click();
  await page.locator('.folder-page-location summary').click();
  await expect(page.locator('.folder-page-location')).toContainText(location.absoluteDirectory);
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'default-collection.png') });
  assert.deepEqual(identities(await cli('session','list')),originalIdentities);for(const employee of [employeeA,employeeB])assert.equal(fs.readFileSync(path.join(employee.cwd,'employee-original.txt'),'utf8'),employee.id);assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible())));
  ok('the global plugin button reopens the same independent collection; authorized employee edits stay synchronized without relocating any original workspace');
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ checks, passed: checks.length, errors, externalRequests: requests, modelsRun: 0 }, null, 2));
  console.log(`PASS=${checks.length} FAIL=0 — isolated host, real CLI, no model inference`);
} catch (error) {
  console.error(log);
  console.error('Renderer errors:', errors);
  await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'error.png') }).catch(() => {});
  throw error;
} finally {
  await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
