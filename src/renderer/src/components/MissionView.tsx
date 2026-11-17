import { useEffect, useRef } from 'react';
import type { Store } from '../../../shared/types';
import type { ViewState } from '../../../shared/view';
import { api } from '../api';
import { onPluginFlush } from '../plugins';

const ALLOWED_HOST_COMMANDS = new Set([
  'notebook.resources',
  'notebook.access',
  'notebook.status',
  'session.list',
  'session.status',
  'engine.models',
  'system.info',
  'settings.get',
  'view.open',
  'view.select',
  'schedule.list',
  'schedule.get',
  'schedule.create',
  'schedule.update',
  'schedule.pause',
  'schedule.resume',
  'schedule.run',
  'schedule.cancel',
  'schedule.trigger',
  'schedule.delete',
  'schedule.history',
  'schedule.preview',
  'mission.list',
  'mission.get',
  'mission.create',
  'mission.update',
  'mission.complete',
  'mission.fail',
  'mission.reopen',
  'mission.remind',
  'mission.archive',
  'mission.delete',
  'mission.summary',
  'plan.query',
  'channel.list',
  'chat.list',
  'monitor.list',
]);

const DARK_THEMES = new Set(['black', 'space', 'midnight', 'sage']);
const FORWARDED_HOST_EVENTS = new Set([
  'schedule:changed',
  'schedule:run',
  'mission:changed',
  'store:changed',
  'access:changed',
  'channel:changed',
  'chat:changed',
  'monitor:changed',
  'client:connected',
]);

export function MissionView({
  store,
  view: _view,
  act: _act,
}: {
  store: Store;
  view: ViewState;
  act: (command: string, args?: Record<string, unknown>) => Promise<any>;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const flushWaiters = useRef(new Map<string, (err?: string) => void>());

  const planAppearance = store.preferences?.viewAppearance?.plan;
  const planThemeName = planAppearance?.theme ?? 'white';
  const isDark = DARK_THEMES.has(planThemeName);

  const syncHostTheme = (themeName: string) => {
    const target = frameRef.current?.contentWindow;
    if (!target || !readyRef.current) return;
    target.postMessage(
      {
        source: 'aexus-mission-host',
        type: 'host-theme',
        theme: DARK_THEMES.has(themeName) ? 'dark' : 'light',
        hostTheme: themeName,
      },
      '*',
    );
  };

  useEffect(() => {
    syncHostTheme(planThemeName);
  }, [planThemeName, isDark]);

  useEffect(() => {
    const postToFrame = (message: unknown) => {
      const target = frameRef.current?.contentWindow;
      if (target) target.postMessage(message, '*');
    };

    const onMessage = async (event: MessageEvent) => {
      const frameWin = frameRef.current?.contentWindow;
      if (!frameWin || event.source !== frameWin) return;
      const data = event.data;
      if (!data || data.source !== 'aexus-mission-notebook') return;

      if (data.type === 'ready') {
        readyRef.current = true;
        postToFrame({
          source: 'aexus-mission-host',
          type: 'host-theme',
          theme: DARK_THEMES.has(planThemeName) ? 'dark' : 'light',
          hostTheme: planThemeName,
        });
        try {
          const pendingPageId = sessionStorage.getItem('aexus.missionTargetPageId');
          if (pendingPageId) {
            sessionStorage.removeItem('aexus.missionTargetPageId');
            postToFrame({ source: 'aexus-mission-host', type: 'navigate-page', pageId: pendingPageId });
          }
        } catch {
          /* Ignore storage errors. */
        }
        return;
      }
      if (data.type === 'external' && typeof data.url === 'string') {
        void api.call('external.open', { url: data.url }).catch(() => {});
        return;
      }
      if (data.type === 'flushed' && typeof data.id === 'string') {
        const done = flushWaiters.current.get(data.id);
        if (done) {
          flushWaiters.current.delete(data.id);
          done(data.error ? String(data.error) : undefined);
        }
        return;
      }
      if (data.type === 'rpc' && typeof data.id === 'string' && typeof data.method === 'string') {
        try {
          const response = await api.call('notebook.call', {
            method: data.method,
            params: data.params ?? {},
            stateMode: data.stateMode ?? 'delta',
            includeEnvelope: true,
          });
          postToFrame({ source: 'aexus-mission-host', type: 'rpc-reply', id: data.id, response });
        } catch (error) {
          postToFrame({
            source: 'aexus-mission-host',
            type: 'rpc-reply',
            id: data.id,
            code: (error as { code?: string })?.code,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (data.type === 'host' && typeof data.id === 'string' && typeof data.command === 'string') {
        if (!ALLOWED_HOST_COMMANDS.has(data.command)) {
          postToFrame({
            source: 'aexus-mission-host',
            type: 'host-reply',
            id: data.id,
            error: `Blocked host command: ${data.command}`,
          });
          return;
        }
        try {
          const result = await api.call(data.command, data.args ?? {});
          postToFrame({ source: 'aexus-mission-host', type: 'host-reply', id: data.id, result });
        } catch (error) {
          postToFrame({
            source: 'aexus-mission-host',
            type: 'host-reply',
            id: data.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    window.addEventListener('message', onMessage);
    const offEvents = api.onEvent((event) => {
      if (!readyRef.current) return;
      if (event.channel === 'notebook:changed') {
        postToFrame({ source: 'aexus-mission-host', type: 'event', payload: event.payload });
      } else if (FORWARDED_HOST_EVENTS.has(event.channel)) {
        postToFrame({
          source: 'aexus-mission-host',
          type: 'host-event',
          channel: event.channel,
          payload: event.payload,
        });
      }
    });
    const offFlush = onPluginFlush(async () => {
      if (!readyRef.current || !frameRef.current?.contentWindow) return;
      const id = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          flushWaiters.current.delete(id);
          resolve();
        }, 4000);
        flushWaiters.current.set(id, (error) => {
          window.clearTimeout(timer);
          if (error) reject(new Error(error));
          else resolve();
        });
        postToFrame({ source: 'aexus-mission-host', type: 'flush', id });
      });
    });

    return () => {
      const wasReady = readyRef.current;
      window.removeEventListener('message', onMessage);
      offEvents();
      offFlush();
      for (const resolve of flushWaiters.current.values()) resolve();
      flushWaiters.current.clear();
      readyRef.current = false;
      if (wasReady) {
        void api
          .call('notebook.call', {
            method: 'ui.register',
            params: { ready: false },
            includeEnvelope: true,
          })
          .catch(() => {});
      }
    };
  }, [planThemeName]);

  const src = `./mission-notebook.html?mode=${api.mode === 'web' ? 'web' : 'desktop'}`;
  return (
    <section className="mission-workspace mission-notebook-mode" aria-label="Mission Notebook">
      <div className="mission-notebook-host">
        <iframe ref={frameRef} className="mission-notebook-frame" title="Mission Notebook" src={src} />
      </div>
    </section>
  );
}
