import packageInfo from '../../../../package.json';
import type { NativeAPI } from '../../../shared/mission-notebook/types';
import type { ApiResponse } from '../../../shared/mission-notebook/core/protocol';
import { applyWorkspaceDelta } from '../../../shared/mission-notebook/core/stateDelta';

type PendingRpc = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

/** Bridge connecting the isolated Mission Notebook iframe to MissionView & Aexus Bot Core. */
export function installMissionNotebookBridge() {
  const params = new URLSearchParams(location.search);
  const printJobId = params.get('printJob');
  const printMode = Boolean(printJobId);
  const webMode = params.get('mode') === 'web';
  const assetPrefix = printMode
    ? `agents-media://notebook-print/${encodeURIComponent(printJobId!)}/asset/`
    : webMode
      ? new URL('./api/notebook-asset/asset/', location.href).href
      : 'agents-media://notebook/asset/';
  const workspaceBaseUrl = printMode
    ? `agents-media://notebook-print/${encodeURIComponent(printJobId!)}/workspace/`
    : webMode
      ? new URL('./api/notebook-asset/workspace/', location.href).href
      : 'agents-media://notebook/workspace/';

  const listeners = {
    state: new Set<(event: any) => void>(),
    ui: new Set<(event: any) => void>(),
    agent: new Set<(event: any) => void>(),
    command: new Set<(name: string) => void>(),
    hostEvent: new Set<(event: { channel: string; payload: any }) => void>(),
    flush: new Set<() => Promise<void>>(),
  };

  let latest: any;
  const pendingRpc = new Map<string, PendingRpc>();
  const pendingHost = new Map<string, PendingRpc>();

  const resourceFields = new Set(['url', 'href', 'icon', 'cover', 'emoji', 'result']);
  const translate = (value: any, incoming: boolean, key = ''): any => {
    if (typeof value === 'string') {
      if (!resourceFields.has(key)) return value;
      if (incoming && value.startsWith('asset://local/')) {
        return assetPrefix + value.slice(14).split('/').map(encodeURIComponent).join('/');
      }
      if (!incoming && value.startsWith(assetPrefix)) {
        return 'asset://local/' + value.slice(assetPrefix.length).split('/').map(decodeURIComponent).join('/');
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => translate(v, incoming, key));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translate(v, incoming, k)]));
    }
    return value;
  };

  const rpc = (method: string, methodParams: Record<string, any> = {}, id: string = crypto.randomUUID()): Promise<ApiResponse> =>
    new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (pendingRpc.delete(id)) {
          resolve({
            jsonrpc: '2.0',
            id,
            revision: latest?.revision ?? 0,
            error: { code: 'TIMEOUT', message: `Mission Notebook RPC 超时: ${method}` },
          });
        }
      }, 60000);
      pendingRpc.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          window.clearTimeout(timer);
          resolve({
            jsonrpc: '2.0',
            id,
            revision: latest?.revision ?? 0,
            error: { code: 'RPC_FAILED', message: err instanceof Error ? err.message : String(err) },
          });
        },
      });
      window.parent.postMessage(
        {
          source: 'aexus-mission-notebook',
          type: 'rpc',
          id,
          method,
          params: translate(methodParams, false),
          stateMode: 'delta',
        },
        '*',
      );
    });

  const hostCall = (command: string, args: Record<string, any> = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        if (pendingHost.delete(id)) reject(new Error(`Core call timed out: ${command}`));
      }, 30000);
      pendingHost.set(id, {
        resolve: (val) => {
          window.clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          window.clearTimeout(timer);
          reject(err);
        },
      });
      window.parent.postMessage(
        { source: 'aexus-mission-notebook', type: 'host', id, command, args },
        '*',
      );
    });

  const publish = (event: any) => {
    if (!latest || (typeof event.revision === 'number' && event.revision >= (latest.revision ?? 0))) {
      latest = event;
    }
    listeners.state.forEach((fn) => fn({ ...event, workspace: latest.workspace, revision: latest.revision }));
  };

  let refreshing: Promise<any> | undefined;
  const refresh = () =>
    (refreshing ||= (async () => {
      const response = await rpc('workspace.get');
      if (response.error) throw new Error(response.error.message);
      publish({ type: 'state', workspace: response.result, revision: response.revision });
      return latest;
    })().finally(() => {
      refreshing = undefined;
    }));

  const apply = async (event: any) => {
    let workspace = applyWorkspaceDelta(latest?.workspace, event.delta);
    if (!workspace) {
      await refresh();
      workspace = applyWorkspaceDelta(latest?.workspace, event.delta);
    }
    if (workspace) publish({ ...event, type: 'state', workspace, revision: workspace.revision || event.revision });
    return workspace;
  };

  const api: NativeAPI['api'] = async (method, methodParams = {}, id: string = crypto.randomUUID()) => {
    const response = await rpc(method, methodParams, id);
    if (response.delta) {
      const workspace = await apply({
        type: 'delta',
        delta: response.delta,
        revision: response.revision,
        requestId: String(id),
        method,
      });
      return { ...response, workspace };
    }
    return response;
  };

  const call = async (method: string, methodParams: Record<string, any> = {}) => {
    const result = await api(method, methodParams);
    if (result.error) throw new Error(result.error.message);
    return result.result;
  };

  const receive = (rawEvent: any) => {
    const event = translate(rawEvent, true);
    if (event?.type === 'state') publish(event);
    else if (event?.type === 'delta') void apply(event).catch(() => {});
    else if (event?.type === 'ui') listeners.ui.forEach((fn) => fn(event));
    else if (event?.type === 'agent') listeners.agent.forEach((fn) => fn(event));
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== 'aexus-mission-host') return;
    if (data.type === 'rpc-reply' && typeof data.id === 'string') {
      const pending = pendingRpc.get(data.id);
      if (!pending) return;
      pendingRpc.delete(data.id);
      if (data.error) {
        pending.resolve({
          jsonrpc: '2.0',
          id: data.id,
          error: { code: data.code || 'OPERATION_FAILED', message: String(data.error) },
        });
      } else {
        const envelope = data.response || {};
        pending.resolve(
          translate(
            {
              jsonrpc: '2.0',
              id: data.id,
              result: envelope.result ?? envelope,
              revision: envelope.revision,
              ...(envelope.delta ? { delta: envelope.delta } : {}),
              ...(envelope.workspace ? { workspace: envelope.workspace } : {}),
            },
            true,
          ),
        );
      }
      return;
    }
    if (data.type === 'host-reply' && typeof data.id === 'string') {
      const pending = pendingHost.get(data.id);
      if (!pending) return;
      pendingHost.delete(data.id);
      if (data.error) pending.reject(new Error(String(data.error)));
      else pending.resolve(data.result);
      return;
    }
    if (data.type === 'event') {
      receive(data.payload);
      return;
    }
    if (data.type === 'host-event' && typeof data.channel === 'string') {
      listeners.hostEvent.forEach((fn) => fn({ channel: data.channel, payload: data.payload }));
      return;
    }
    if (data.type === 'host-theme' && typeof data.theme === 'string') {
      const palette = typeof data.hostTheme === 'string' ? data.hostTheme : '';
      listeners.command.forEach((fn) => fn(`host-theme:${data.theme}:${palette}`));
      return;
    }
    if (data.type === 'navigate-page' && typeof data.pageId === 'string') {
      listeners.command.forEach((fn) => fn(`open-page:${data.pageId}`));
      return;
    }
    if (data.type === 'flush') {
      let error = '';
      try {
        await Promise.all([...listeners.flush].map((flush) => flush()));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      window.parent.postMessage({ source: 'aexus-mission-notebook', type: 'flushed', id: data.id, error }, '*');
    }
  });

  const on = (kind: keyof typeof listeners, fn: any) => {
    (listeners[kind] as Set<any>).add(fn);
    if (kind === 'state' && latest) queueMicrotask(() => fn(latest));
    return () => {
      (listeners[kind] as Set<any>).delete(fn);
    };
  };

  const workspaceURL = (relative: string) =>
    workspaceBaseUrl + relative.split('/').map(encodeURIComponent).join('/');

  const download = (href: string, name: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  };

  let printSnapshotPromise: Promise<{ workspace: any; dataPath: string; version: string }> | undefined;
  const loadPrintSnapshot = () =>
    (printSnapshotPromise ||= (async () => {
      const res = await fetch(`agents-media://notebook-print/${encodeURIComponent(printJobId!)}/snapshot`);
      if (!res.ok) throw new Error(`打印快照读取失败 (${res.status})`);
      const raw = await res.json();
      return {
        workspace: translate(raw.workspace, true),
        dataPath: raw.dataPath,
        version: raw.version || packageInfo.version,
      };
    })());

  window.native = {
    ...(printMode ? { printMode: true } : {}),
    rendererReady: async () => {
      if (printMode) return;
      await call('ui.register').catch(() => {});
      window.parent.postMessage({ source: 'aexus-mission-notebook', type: 'ready' }, '*');
    },
    hostCall: printMode ? async () => ({ plans: [] }) : hostCall,
    onHostEvent: (fn) => on('hostEvent', fn),
    folderMode: true,
    hostAssistant: !printMode,
    workspaceURL,
    api: printMode
      ? async (method, _params, id: string = crypto.randomUUID()) => {
          const snap = await loadPrintSnapshot();
          const emptyList = ['assistant.list', 'history.list', 'history.operations', 'conflict.list', 'agent.history'].includes(method);
          return {
            jsonrpc: '2.0',
            id,
            result: emptyList ? [] : {},
            workspace: snap.workspace,
            revision: snap.workspace?.revision || 0,
          };
        }
      : api,
    onState: (fn) => on('state', fn),
    onUI: (fn) => on('ui', fn),
    onAgent: (fn) => on('agent', fn),
    onFlush: (fn) => on('flush', fn),
    onCommand: (fn) => on('command', fn),
    load: printMode
      ? loadPrintSnapshot
      : async () => {
          const [state, info] = await Promise.all([refresh(), call('fs.info')]);
          return { workspace: state.workspace, dataPath: info.root, version: packageInfo.version };
        },
    save: printMode
      ? async () => Date.now()
      : async () => {
          throw new Error('Mission 笔记本通过 workspace.patch 增量保存');
        },
    saveAsset: async (name, bytes) => {
      let binary = '';
      for (const part of new Uint8Array(bytes)) binary += String.fromCharCode(part);
      return call('fs.asset-upload', { name, contentBase64: btoa(binary) });
    },
    uploadToSpace: async () => {
      throw new Error('请使用工作区文件或命令行上传附件');
    },
    revealSpace: async () => false,
    chooseEngine: async () => null,
    exportPage: async (pageId, type) => {
      const output = `Exports/${pageId}.${type}`;
      await call('file.export', { pageId, type, output });
      download(workspaceURL(output), `${pageId}.${type}`);
      return true;
    },
    exportFile: async (name, content) => {
      const output = `Exports/${name.replace(/[\\/]/g, '-')}`;
      await call('fs.write', { path: output, content });
      download(workspaceURL(output), name);
      return true;
    },
    exportAsset: async (url, name) => {
      download(url, name);
      return true;
    },
    chooseImports: async () => [],
    importFiles: async () => [],
    exportBackup: async () => {
      throw new Error('请直接备份 ~/AgentsCompany/mission-notebook 目录');
    },
    importBackup: async () => {
      throw new Error('请直接恢复 ~/AgentsCompany/mission-notebook 目录');
    },
    revealData: async () => {},
    versions: (pageId) => call('history.list', { pageId }),
    snapshot: async () => {},
    printPDF: async () => false,
    setTheme: (theme) => {
      document.documentElement.dataset.theme = theme;
      if (!printMode) {
        window.parent.postMessage({ source: 'aexus-mission-notebook', type: 'appearance', theme }, '*');
      }
    },
    openExternal: async (url) => {
      if (url.startsWith('mission://page/')) {
        listeners.command.forEach((fn) => fn(`open-page:${url.slice('mission://page/'.length)}`));
      } else if (url.startsWith('mininotion://page/')) {
        listeners.command.forEach((fn) => fn(`open-page:${url.slice('mininotion://page/'.length)}`));
      } else if (!printMode) {
        window.parent.postMessage({ source: 'aexus-mission-notebook', type: 'external', url }, '*');
      }
    },
    loadDraft: printMode ? async () => [] : () => call('fs.draft-read'),
    saveDraft: printMode ? async () => {} : (draft) => call('fs.draft-write', { draft }),
  };
}
