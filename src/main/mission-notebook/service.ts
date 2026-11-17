import { getBlock } from '../../shared/mission-notebook/core/blocks';
import { workspaceDelta } from '../../shared/mission-notebook/core/stateDelta';
import { FolderWorkspace, withinFolder } from './folder';
import { FolderStorage } from './folderStorage';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Storage, atomicWrite, validateWorkspace, assetPath } from './storage';
import { executeWorkspaceCommand as executeCoreCommand, requirePage } from '../../shared/mission-notebook/core/commands';
import { commands } from '../../shared/mission-notebook/core/catalog';
import { normalizeWorkspace } from '../../shared/mission-notebook/core/normalize';
import { parseDay, dateKey } from '../../shared/mission-notebook/database/dates';
import { validateDomain } from '../../shared/mission-notebook/core/validate';
import { CommandError, requiredString } from '../../shared/mission-notebook/core/errors';
import type { ApiRequest, ApiResponse, ServiceEvent } from '../../shared/mission-notebook/core/protocol';
import type { Workspace, SpaceFileRecord } from '../../shared/mission-notebook/types';
import { runFileCommand } from './files';
import { Changes } from './changes';
import packageInfo from '../../../package.json';
import { evaluateSchedules } from '../../shared/mission-notebook/scheduling/engine';
import { parseScheduleTime } from '../../shared/mission-notebook/scheduling/commands';
import { applyAutomations, appendRun, type TriggerMemory } from '../../shared/mission-notebook/actions/engine';
import { findButton } from '../../shared/mission-notebook/actions/commands';
import { runScheduledAutomations } from '../../shared/mission-notebook/actions/scheduled';
import type { ActionEffect } from '../../shared/mission-notebook/actions/types';
import { diffWorkspace } from '../../shared/mission-notebook/core/patch';
import { applyDependencyShifts } from '../../shared/mission-notebook/database/dependencies';
import { finalizeProperties } from '../../shared/mission-notebook/database/propertyData';
import { descendants, pageIndex } from '../../shared/mission-notebook/model';
import { pageResources, pageRights, checkPageChanges, executePageAccess, type PageScope } from './pageAccess';

export class DataService {
  private executeWorkspaceCommand = (input: Workspace | null, method: string, params: Record<string, any> = {}) => executeCoreCommand(input, method, params, { folderMode: !!this.folder, folderRootId: this.folder?.index.files['index.mininotion.json']?.id });
  readonly storage: Storage;
  readonly folder?: FolderWorkspace;
  readonly changes: Changes;
  private readonly onActionEffects?: (effects: ActionEffect[]) => void | Promise<void>;
  workspace: Workspace | null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: ServiceEvent) => void>();
  readonly guiClients = new Set<string>();
  readonly desktopClients = new Set<string>();
  private resolvedPatches = new Set<string>();
  private schedulerTimer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private schedulerError = '';
  private automationSignals: TriggerMemory = {};
  private lastSchedulerCheck = 0;
  private queuedCommitEffects: ActionEffect[] = [];
  startScheduler() {
    // The single writer sees every committed workspace revision. Recalculate
    // whether background work exists only when that revision changes; a normal
    // notebook without scheduled tasks should cost nothing on idle ticks.
    let checked: Workspace | null = null, hasScheduledWork = false;
    const tick = async () => {
      const workspace = this.workspace;
      if (this.ticking || !workspace) return;
      if (workspace !== checked) {
        checked = workspace;
        hasScheduledWork = workspace.pages.some(page => !page.trashedAt && (
          (page.templateFor && page.repeat?.enabled) ||
          page.reminders?.some(reminder => reminder.enabled && !reminder.deletedAt) ||
          page.database?.automations?.some(rule => rule.enabled && rule.schedule?.enabled)
        ));
      }
      if (!hasScheduledWork) { this.lastSchedulerCheck = Date.now(); return; }
      this.ticking = true;
      try {
        const result = await this.request({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'scheduler.run',
          client: 'scheduler',
        });
        this.schedulerError = result.error?.message || '';
        this.lastSchedulerCheck = Date.now();
      } finally {
        this.ticking = false;
      }
    };
    // First allow the GUI to receive its verified notebook snapshot. The first
    // scheduled check runs within one second; explicit scheduler.run is still
    // available immediately for CLI and tests.
    this.schedulerTimer = setInterval(() => void tick(), 1000);
    this.schedulerTimer.unref();
  }
  stopScheduler() {
    clearInterval(this.schedulerTimer);
  }

  constructor(
    directory: string,
    folderRoot?: string,
    onActionEffects?: (effects: ActionEffect[]) => void | Promise<void>,
  ) {
    this.storage = folderRoot ? new FolderStorage(directory) : new Storage(directory);
    this.onActionEffects = onActionEffects;
    if (folderRoot) {
      this.folder = new FolderWorkspace(folderRoot);
      this.storage.assetPath = (url: string) => assetPath(directory, url, this.folder!.root);
    }
    this.changes = new Changes(directory, !!folderRoot);
    const loaded = this.storage.load();
    this.workspace = loaded ? normalizeWorkspace(loaded, true) : null;
    for (const space of Object.values(this.workspace?.spaces || {}))
      for (const agent of [
        space.agent,
        ...(space.agent.sessions || []).flatMap((session) => (session.state ? [session.state] : [])),
      ])
        if (agent.status === 'running') {
          agent.status = 'error';
          agent.error = '服务重启，会话已中断';
        }
    const migratedAssets = new Map<string, string>();
    // Upgrade the old flat asset URLs without moving or overwriting existing bytes.
    for (const page of this.workspace?.pages || []) {
      if (!page.space) continue;
      fs.mkdirSync(this.storage.spaceRoot(page.id), { recursive: true, mode: 0o700 });
      for (const file of page.files || []) {
        if (!/^asset:\/\/local\/[^/]+$/.test(file.url) || fs.existsSync(this.storage.assetPath(file.url)))
          continue;
        const name = path.basename(this.storage.assetPath(file.url));
        const candidates = [null, ...(page.folders || []).map((folder) => folder.id)];
        const source = candidates
          .map((id) => path.join(this.storage.spaceDirectory(page.id, id), name))
          .find((source) => fs.existsSync(source));
        if (source) {
          const url = `asset://local/${path.relative(this.storage.directory, source).split(path.sep).join('/')}`;
          migratedAssets.set(file.url, url);
          file.url = url;
        }
      }
    }
    if (migratedAssets.size)
      this.workspace = JSON.parse(
        JSON.stringify(this.workspace, (_key, value) =>
          typeof value === 'string' ? migratedAssets.get(value) || value : value,
        ),
      );
    if (this.workspace) validateDomain(this.workspace);
    if (loaded && (JSON.stringify(loaded) !== JSON.stringify(this.workspace) || this.storage instanceof FolderStorage && !this.storage.initialized))
      this.storage.save(this.workspace!);
    for (const name of fs.readdirSync(this.conflictDirectory()).filter((name) => name.endsWith('.json'))) {
      const item = JSON.parse(fs.readFileSync(path.join(this.conflictDirectory(), name), 'utf8'));
      if (item.resolvedAt && item.patch?.id) this.resolvedPatches.add(item.patch.id);
    }
  }
  get revision() {
    return this.workspace?.revision || 0;
  }
  subscribe(listener: (event: ServiceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  broadcast(event: ServiceEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
  state(): ServiceEvent {
    return { type: 'state', workspace: this.workspace, revision: this.revision };
  }
  request(request: ApiRequest, internal = false): Promise<ApiResponse> {
    // Durable draft checkpoints must remain responsive while a long operation is queued.
    if (!request.agentToken && ['fs.draft-read', 'fs.draft-write'].includes(request.method)) return this.execute(request, internal);
    // Interactive engine calls must not hold the data queue while waiting for tool approval.
    if (
      !request.agentToken &&
      [
        'agent.capabilities',
        'agent.control',
        'agent.steer',
        'agent.command',
        'agent.protocol',
        'agent.context-usage',
        'agent.rename',
      ].includes(request.method)
    )
      return this.execute(request, internal);
    const operation = this.queue.then(() => this.execute(request, internal));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async idle() {
    await this.queue;
  }
  private prepareAction = (before: Workspace, after: Workspace) => {
    after = finalizeProperties(before, after, 'action');
    validateWorkspace(after);
    validateDomain(after, before);
    const result = applyDependencyShifts(before, after);
    validateDomain(result, before);
    return result;
  };
  private async sendEffects(effects: ActionEffect[] = []) {
    const combined = [...this.queuedCommitEffects.splice(0), ...effects];
    if (!combined.length) return;
    if (this.guiClients.size) {
      for (const effect of combined) {
        if (
          effect.type === 'open' &&
          this.workspace?.pages.some((page) => page.id === effect.pageId && !page.trashedAt)
        ) {
          this.broadcast({
            type: 'ui',
            command: 'open-page',
            params: { pageId: effect.pageId, mode: effect.mode },
          });
        }
      }
    }
    if (this.onActionEffects) {
      await this.onActionEffects(combined);
    }
  }
  private commit(workspace: Workspace, request: ApiRequest,checkAccess?:(next:Workspace)=>void) {
    const previousPages = this.workspace ? pageIndex(this.workspace.pages) : undefined;
    // A duplicated main Page gets independent file bytes and a fresh Agent session.
    for (const page of workspace.pages) {
      if (page.space && page !== previousPages?.get(page.id))
        fs.mkdirSync(this.storage.spaceRoot(page.id), { recursive: true, mode: 0o700 });
      if (!page.space || this.workspace?.spaces?.[page.id] || !page.files?.length) continue;
      const replacements = new Map<string, string>();
      const files = page.files.map((file) => {
        if (
          !file.url.startsWith('asset://local/spaces/') ||
          file.url.startsWith(`asset://local/spaces/${page.id}/`)
        )
          return file;
        const saved = this.storage.saveSpaceFile(
          page.id,
          file.folderId,
          file.name,
          fs.readFileSync(this.storage.assetPath(file.url)),
        );
        const id = randomUUID();
        replacements.set(file.url, saved.url);
        replacements.set(file.id, id);
        return { ...file, id, url: saved.url };
      });
      if (replacements.size) {
        const ids = descendants(workspace.pages, page.id);
        workspace = {
          ...workspace,
          pages: workspace.pages.map((value) => {
            if (!ids.has(value.id)) return value;
            return JSON.parse(
              JSON.stringify(value.id === page.id ? { ...value, files } : value, (_key, entry) => {
                if (typeof entry !== 'string') return entry;
                for (const [before, after] of replacements) entry = entry.replaceAll(before, after);
                return entry;
              }),
            );
          }),
        };
      }
    }
    if (this.folder) workspace = this.folder.materializeDirectories(workspace, this.workspace);
    workspace = normalizeWorkspace(finalizeProperties(this.workspace, workspace, request.method), false, this.workspace);
    validateWorkspace(workspace);
    validateDomain(workspace, this.workspace);
    if (
      this.workspace &&
      ![
        'workspace.replace',
        'backup.restore',
        'file.import',
        'page.duplicate',
        'template.duplicate',
        'history.restore',
        'history.undo',
        'history.redo',
      ].includes(request.method)
    )
      workspace = applyDependencyShifts(this.workspace, workspace);
    const quiet = [
      'workspace.replace',
      'backup.restore',
      'file.import',
      'history.restore',
      'history.undo',
      'history.redo',
      'page.restore',
      'scheduler.run',
      'repeat.run',
      'automation.run',
      'action.failure',
      'person.update',
    ].includes(request.method);
    let signals = [
      'workspace.replace',
      'backup.restore',
      'history.undo',
      'history.redo',
      'history.restore',
    ].includes(request.method)
      ? {}
      : this.automationSignals;
    let autoEffects: ActionEffect[] = [];
    if (this.workspace && !quiet) {
      const automated = applyAutomations(
        this.workspace,
        workspace,
        this.executeWorkspaceCommand,
        Date.now(),
        this.prepareAction,
        this.automationSignals,
      );
      workspace = automated.workspace;
      signals = automated.signals;
      autoEffects = automated.effects;
    }
    workspace = finalizeProperties(this.workspace, workspace, request.method);
    validateWorkspace(workspace);
    validateDomain(workspace, this.workspace);
    const next = { ...workspace, revision: this.revision + 1 };
    const previous = this.workspace;
    const recordChange = previous ? this.changes.prepare(previous, next, request) : undefined;
    checkAccess?.(next);
    if (this.folder) this.folder.save(next, previous, () => this.storage.save(next));
    else this.storage.save(next);
    this.workspace = next;
    const nextPages = pageIndex(next.pages);
    for (const id of Object.keys(previous?.spaces || {})) {
      const page = nextPages.get(id);
      if (!page) {
        this.storage.removeSpace(id);
        this.storage.removeAgentLog(id);
      }
    }
    this.automationSignals = signals;
    if (autoEffects.length) this.queuedCommitEffects.push(...autoEffects);
    recordChange?.();
    this.broadcast({
      type: 'state',
      workspace: next,
      revision: next.revision,
      requestId: String(request.id),
      method: request.method,
    });
    if (
      ![
        'workspace.replace',
        'backup.restore',
        'file.import',
        'history.restore',
        'history.undo',
        'history.redo',
      ].includes(request.method)
    ) {
      const existing = new Set(previous?.inbox?.map((item) => item.id));
      for (const item of next.inbox || [])
        if (!existing.has(item.id)) this.broadcast({ type: 'notification', item });
    }
  }
  private conflictDirectory() {
    const directory = path.join(this.storage.directory, 'conflicts');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }
  private conflictFile(id: string) {
    if (!/^[0-9a-f-]+$/i.test(id)) throw new CommandError('INVALID_ARGUMENT', '冲突 ID 无效');
    return path.join(this.conflictDirectory(), id + '.json');
  }
  private async execute(request: ApiRequest, internal = false): Promise<ApiResponse> {
    const params = request.params || {};
    const responseBase = this.workspace;
    const response = (result: unknown, changed = false): ApiResponse => ({
      jsonrpc: '2.0',
      id: request.id,
      result: result === undefined ? null : result,
      revision: this.revision,
      ...(changed && !request.agentToken && request.stateMode !== 'none'
        ? request.stateMode === 'delta' && responseBase && this.workspace
          ? { delta: workspaceDelta(responseBase, this.workspace) }
          : { workspace: this.workspace }
        : {}),
    });
    try {
      if(request.method==='host.resources')return response(pageResources(this.workspace));
      if (request.method === 'host.execute') {
        if (!this.workspace) throw new CommandError('NOT_INITIALIZED', '请先初始化工作空间');
        const { scope, method, params: input = {} } = params as { scope: PageScope; method: string; params: Record<string, any> };
        scope.rootId = this.folder?.index.files['index.mininotion.json']?.id;
        if (['fs.read', 'fs.write'].includes(method)) {
          const page = this.workspace.pages.find(p => p.sourceFile?.path === input.path), rights = page && pageRights(this.workspace, scope, page.id);
          if (!this.folder || !page || String(input.path).endsWith('.mininotion.json') || String(input.path).split('/').includes('.mininotion') || !(method === 'fs.read' ? rights?.read : rights?.write)) throw new CommandError('PAGE_ACCESS_DENIED', '文件不属于已授权页面');
          if (method === 'fs.read') return response({ data: this.folder.read(input.path), created: [] });
          this.folder.write(input.path, String(input.content ?? ''), input.hash);
          const scanned = this.folder.scan(this.workspace);
          if (scanned) this.commit(scanned, request);
          await this.sendEffects();
          return response({ data: this.folder.read(input.path), created: [] });
        }
        const before = this.workspace, value = await executePageAccess(before, scope, method, input, (workspace, name, data) => runFileCommand({ workspace } as DataService, name, data));
        if (value.workspace !== before) this.commit(value.workspace, { ...request, method, params: input, client: 'employee:' + scope.employeeId }, next => checkPageChanges(before, next, scope));
        await this.sendEffects(value.result?.effects || []);
        return response({ data: value.result, created: value.created });
      }
      if(request.method.startsWith('fs.')&&!this.folder)throw new CommandError('WORKSPACE_REQUIRED','此接口需要 --workspace 工作文件夹');
      if(this.folder) {
        const folder=this.folder;
        if(request.method.startsWith('agent.'))throw new CommandError('HOST_MANAGED_AGENT','文件夹模式由宿主提供 Agent；此服务只处理文档和文件');
        if(['workspace.replace','backup.restore','backup.export'].includes(request.method))throw new CommandError('FOLDER_OPERATION_UNSUPPORTED','文件夹模式请通过文件和页面 API 修改数据；备份或迁移请复制整个 Workspace');
        if(request.method==='fs.asset-upload')return response(this.storage.saveAsset(params.name||path.basename(params.path||'asset'),params.path?fs.readFileSync(withinFolder(folder.root,params.path)):Buffer.from(String(params.contentBase64||''),'base64')));
        if(['fs.draft-read','fs.draft-write'].includes(request.method)){
          const file=params.key?path.join(folder.directory,'drafts',createHash('sha256').update(String(params.key)).digest('hex')+'.json'):path.join(folder.directory,'hosted-draft.json');
          if(request.method==='fs.draft-read')return response(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[]);
          if(params.draft===null)fs.rmSync(file,{force:true});else atomicWrite(file,params.draft||[]);
          return response({saved:true});
        }
        if(request.method==='fs.list')return response(folder.list(params.path||''));
        if(request.method==='fs.read')return response(folder.read(requiredString(params.path,'path')));
        if(request.method==='fs.mkdir'){const target=withinFolder(folder.root,requiredString(params.path,'path'),true);fs.mkdirSync(target,{recursive:true});}
        if(request.method==='fs.write')folder.write(requiredString(params.path,'path'),String(params.content??''),params.hash);
        if(request.method==='fs.restore')folder.restore(requiredString(params.path,'path'));
        if(request.method==='fs.remove')folder.remove(requiredString(params.path,'path'));
        if(['file.import','asset.add','space.upload'].includes(request.method)&&params.path)params.path=withinFolder(folder.root,requiredString(params.path,'path'));
        if(request.method==='asset.get'&&params.output)params.output=withinFolder(folder.root,params.output,true);
        if(['file.export','file.write','backup.export'].includes(request.method)) {
          const key=request.method==='backup.export'?'path':'output';
          params[key]=withinFolder(folder.root,params[key]||`Exports/${params.pageId||'export'}.${params.type||'json'}`,true);
        }
        if(request.client!=='scheduler' && !['status','service.stop','ui.register'].includes(request.method) && !(request.stateMode==='delta' && ['workspace.patch','page.open','ui.command'].includes(request.method))) {
          const scanned=folder.scan(this.workspace);
          if(scanned){folder.importing=true;try{this.commit(scanned,{...request,id:randomUUID(),method:'fs.sync'})}finally{folder.importing=false}}
        }
        if(request.method==='fs.info')return response(folder.info(this.workspace));
        if(request.method==='fs.audit')return response(folder.audit(this.workspace!));
        if(request.method==='fs.path')return response(folder.location(requiredString(params.pageId,'pageId'),this.workspace!));
        if(request.method==='fs.mkdir')return response({path:params.path},true);
        if(request.method==='fs.bind'){
          const result=folder.bind(requiredString(params.path,'path'),this.workspace!,params.title,params.color||'white');
          const scanned=folder.scan(this.workspace);
          if(scanned){folder.importing=true;try{this.commit(scanned,{...request,id:randomUUID(),method:'fs.sync'})}finally{folder.importing=false}}
          return response({...result,...folder.location(result.pageId,this.workspace!)},true);
        }
        if(request.method==='fs.organize'){
          const moves=folder.organizationPlan(this.workspace!);
          if(params.dryRun!==false)return response({dryRun:true,moves});
          folder.organizing=true;
          try{this.commit(structuredClone(this.workspace!),request)}finally{folder.organizing=false}
          return response({dryRun:false,moves},true);
        }
        if(request.method==='fs.sync')return response({files:Object.keys(folder.index.files).length,errors:folder.errors},true);
        if(request.method==='fs.write')return response(folder.read(params.path),true);
        if(request.method==='fs.restore')return response({restored:params.path},true);
        if(request.method==='fs.remove')return response({removed:params.path},true);
      }
      if (request.method === 'workspace.patch' && this.resolvedPatches.has(params.patch?.id))
        return response({ applied: params.patch.id, previouslyResolved: true }, true);
      if (request.method === 'status')
        return response({
          apiVersion: 1,
          workspaceRoot: this.folder?.root,
          version: packageInfo.version,
          pid: process.pid,
          dataDirectory: this.storage.directory,
          revision: this.revision,
          initialized: !!this.workspace,
          guiClients: this.guiClients.size,
          desktopClients: this.desktopClients.size,
          pages: this.workspace?.pages.filter((page) => !page.trashedAt).length || 0,
        });
      if (request.method === 'ui.register') {
        if (request.client?.startsWith('gui-')) {
          if (params.ready === false) this.guiClients.delete(request.client);
          else this.guiClients.add(request.client);
        }
        return response({ connected: true });
      }
      if (request.method === 'page.open' || request.method === 'ui.command') {
        if (!this.workspace) throw new CommandError('NOT_INITIALIZED', '请先初始化工作空间');
        const uiParams = request.method === 'page.open' ? params : params.params || {};
        const command = request.method === 'page.open' ? 'open-page' : String(params.command);
        if (
          !this.guiClients.size &&
          !(this.desktopClients.size && ['quit', 'window-show', 'window-close'].includes(command))
        )
          throw new CommandError('GUI_NOT_RUNNING', '图形端未打开，请先运行 ui launch');
        const controls = [
          'open-page',
          'new-page',
          'new-tab',
          'search',
          'comments',
          'button',
          'automations',
          'action-history',
          'inbox',
          'scheduler',
          'reminder',
          'repeat',
          'settings',
          'import',
          'export',
          'help',
          'find',
          'select-all',
          'comment-selection',
          'sidebar',
          'theme',
          'back',
          'forward',
          'home',
          'save',
          'trash',
          'templates',
          'history',
          'conflicts',
          'operations',
          'space',
          'agent',
          'calendar-day',
          'appearance',
          'view-settings',
          'close-dialog',
          'window-show',
          'window-hide',
          'window-minimize',
          'window-close',
          'quit',
          'window-fullscreen',
          'zoom',
        ];
        if (!controls.includes(command))
          throw new CommandError('INVALID_UI_COMMAND', `未知 GUI 命令 ${command}`, { commands: controls });
        if (command === 'calendar-day') {
          const page = requirePage(this.workspace, uiParams.pageId);
          if (!page.database) throw new CommandError('NOT_A_DATABASE', '目标必须是数据库');
          if (uiParams.visible !== false) {
            const date = parseDay(uiParams.date);
            if (!date) throw new CommandError('INVALID_DATE', 'date 必须是有效日期');
            uiParams.date = dateKey(date);
          }
        }
        if (command === 'appearance') requirePage(this.workspace, uiParams.pageId);
        if (command === 'open-page') {
          const target = requirePage(this.workspace, uiParams.pageId);
          if (uiParams.blockId) getBlock(target.blocks, uiParams.blockId);
          if (uiParams.viewId) {
            const selected = this.executeWorkspaceCommand(this.workspace, 'view.select', {
              databaseId: uiParams.pageId,
              viewId: uiParams.viewId,
            });
            this.commit(selected.workspace!, request);
          }
        }
        this.broadcast({ type: 'ui', command, params: uiParams, requestId: String(request.id) });
        return response({ sent: true });
      }
      if (request.method === 'service.stop') {
        this.broadcast({ type: 'shutdown' });
        return response({ stopping: true });
      }
      if (request.method === 'scheduler.status')
        return response({
          ...this.executeWorkspaceCommand(this.workspace, 'scheduler.status').result,
          backgroundError: this.schedulerError || null,
          lastCheckedAt: this.lastSchedulerCheck,
        });
      if (request.method === 'scheduler.run') {
        if (!this.workspace) return response({ runs: [], notifications: [], automations: [] });
        const now = params.at !== undefined ? parseScheduleTime(params.at) : Date.now();
        const operation = evaluateSchedules(this.workspace, now);
        const automated = runScheduledAutomations(
          operation.workspace,
          now,
          this.executeWorkspaceCommand,
          this.prepareAction,
        );
        if (operation.changed || automated.changed) this.commit(automated.workspace, request);
        await this.sendEffects(automated.effects || []);
        return response(
          {
            runs: operation.runs,
            notifications: operation.notifications,
            pendingTemplates: operation.pendingTemplates,
            automations: automated.runs,
          },
          operation.changed || automated.changed,
        );
      }
      if (request.method.startsWith('agent.')) {
        throw new CommandError('METHOD_NOT_FOUND', '独立 Space Agent 已由 Aexus Bot AI 员工工作流接管');
      }
      if (request.method === 'history.operations') return response(this.changes.list(params.pageId));
      if (request.method === 'history.undo' || request.method === 'history.redo') {
        if (!this.workspace) throw new CommandError('NOT_INITIALIZED', '请先初始化工作空间');
        const operation = this.changes.apply(this.workspace, request.method === 'history.redo', params);
        this.commit(operation.workspace, request);
        operation.committed();
        return response({ id: operation.id, undone: request.method === 'history.undo' }, true);
      }
      if (request.method === 'conflict.list')
        return response(
          fs
            .readdirSync(this.conflictDirectory())
            .filter((name) => name.endsWith('.json'))
            .map((name) => JSON.parse(fs.readFileSync(path.join(this.conflictDirectory(), name), 'utf8')))
            .filter((item) => !item.resolvedAt)
            .map(({ id, at, message, requestId, patch }) => ({
              id,
              at,
              message,
              requestId,
              pageIds: patch?.pages?.map((page: any) => page.id) || [],
            })),
        );
      if (request.method === 'conflict.get')
        return response(JSON.parse(fs.readFileSync(this.conflictFile(params.id), 'utf8')));
      if (request.method === 'conflict.resolve') {
        const file = this.conflictFile(params.id);
        const item = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (item.resolvedAt)
          return response({ resolved: params.id, alreadyResolved: true, strategy: item.strategy }, true);
        if (params.strategy === 'local') {
          const applied = this.executeWorkspaceCommand(this.workspace, 'workspace.patch', {
            patch: item.patch,
            force: true,
          });
          this.commit(applied.workspace!, request);
        } else if (params.strategy !== 'remote')
          throw new CommandError('INVALID_ARGUMENT', 'strategy 必须是 local 或 remote');
        atomicWrite(file, { ...item, resolvedAt: Date.now(), strategy: params.strategy });
        this.resolvedPatches.add(item.patch.id);
        this.broadcast({
          type: 'state',
          workspace: this.workspace,
          revision: this.revision,
          resolution: { id: params.id, patchId: item.patch.id, strategy: params.strategy },
        });
        return response({ resolved: params.id, strategy: params.strategy }, true);
      }
      if (request.method === 'batch') {
        if (!Array.isArray(params.operations))
          throw new CommandError('INVALID_ARGUMENT', 'operations 必须是数组');
        let candidate = this.workspace;
        const results: any[] = [];
        for (const operation of params.operations) {
          const result = this.executeWorkspaceCommand(candidate, operation.method, operation.params || {});
          candidate = result.workspace;
          results.push(result.result);
        }
        if (candidate) this.commit(candidate, request);
        const batchEffects: ActionEffect[] = [];
        params.operations.forEach((operation: any, index: number) => {
          if (['button.run', 'automation.run'].includes(operation.method) && results[index]?.effects) {
            batchEffects.push(...results[index].effects);
          }
        });
        await this.sendEffects(batchEffects);
        return response(results, true);
      }
      const fileResult = await runFileCommand(this, request.method, params);
      if (fileResult) {
        if (fileResult.workspace) this.commit(fileResult.workspace, request);
        if (request.method === 'page.write-markdown' && fileResult.workspace) {
          const saved = requirePage(this.workspace!, params.pageId);
          fileResult.result = { ...fileResult.result, hash: createHash('sha256').update(JSON.stringify(saved.blocks)).digest('hex') };
        }
        await this.sendEffects();
        return response(fileResult.result, !!fileResult.workspace);
      }
      const operation = this.executeWorkspaceCommand(this.workspace, request.method, params);
      if (
        ['button.preview', 'automation.preview'].includes(request.method) &&
        this.workspace &&
        operation.workspace
      ) {
        let preview = this.prepareAction(this.workspace, operation.workspace);
        if (request.method === 'button.preview')
          preview = applyAutomations(
            this.workspace,
            preview,
            this.executeWorkspaceCommand,
            Date.now(),
            this.prepareAction,
            this.automationSignals,
          ).workspace;
        return response({ ...operation.result, changes: diffWorkspace(this.workspace, preview) });
      }
      if (operation.changed && operation.workspace) this.commit(operation.workspace, request);
      const explicitEffects =
        operation.changed && ['button.run', 'automation.run'].includes(request.method)
          ? (operation.result?.effects as ActionEffect[] | undefined) || []
          : [];
      await this.sendEffects(explicitEffects);
      if (operation.changed && operation.result?.id && Array.isArray(operation.result?.blocks))
        operation.result =
          this.workspace!.pages.find((page) => page.id === operation.result.id) || operation.result;
      return response(operation.result, operation.changed);
    } catch (error) {
      const commandError =
        error instanceof CommandError
          ? error
          : new CommandError('OPERATION_FAILED', error instanceof Error ? error.message : String(error));
      if (
        this.workspace &&
        !request.agentToken &&
        ['button.run', 'automation.run'].includes(request.method) &&
        !['CONFIRMATION_REQUIRED', 'BUTTON_CHANGED'].includes(commandError.code)
      ) {
        try {
          const button = request.method === 'button.run' ? findButton(this.workspace, params) : null;
          const rule = this.workspace.pages
            .find((page) => page.id === params.databaseId)
            ?.database?.automations?.find((rule) => rule.id === params.automationId);
          this.commit(
            appendRun(this.workspace, {
              id: randomUUID(),
              at: Date.now(),
              kind: button ? 'button' : 'automation',
              name: button?.config.label || rule?.name || '动作',
              ownerId: button?.owner.id || params.databaseId,
              sourceId: params.pageId || params.databaseId,
              status: 'error',
              error: commandError.message,
            }),
            { ...request, method: 'action.failure' },
          );
        } catch {
          /* The original failure remains the useful response if even logging cannot be saved. */
        }
      }
      if (commandError.code === 'CONFLICT' && params.patch) {
        const id = randomUUID();
        atomicWrite(this.conflictFile(id), {
          id,
          at: Date.now(),
          message: commandError.message,
          requestId: request.id,
          patch: params.patch,
          current: this.workspace,
        });
        commandError.details = { ...(commandError.details as object), conflictId: id };
      }
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: commandError.code, message: commandError.message, details: commandError.details },
        revision: this.revision,
        ...(!request.agentToken ? { workspace: this.workspace } : {}),
      };
    }
  }
}
