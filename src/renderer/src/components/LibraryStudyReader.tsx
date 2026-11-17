import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReaderSessionView } from '../../../shared/library-api';
import type { Store } from '../../../shared/types';
import type { ViewState } from '../../../shared/view';
import { api } from '../api';
import { revealFile } from '../file-actions';
import { translate as uiText, useI18n } from '../i18n';
import { onPluginFlush } from '../plugins';
import { BackButton } from './BackButton';
import { Icon } from './Icon';
import { LibraryAccessDialog } from './LibraryAccessDialog';

type Action = (cmd: string, args?: Record<string, unknown>, propagateError?: boolean) => Promise<any>;

type ReaderStatus = {
  root: string;
  documentCount: number;
  studySetCount: number;
  cardCount: number;
  reviewDueCount: number;
  revision: number;
};

export type ReaderFrameState = {
  folder: string;
  document: { id: string; path: string; title: string } | null;
  studySetId: string | null;
  homeSection: string;
};

export type ReaderCommand = {
  seq: number;
  command: string;
  payload?: Record<string, unknown>;
};

const DARK_THEMES = new Set(['black', 'space', 'midnight', 'sage']);

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  }
  return btoa(parts.join(''));
}

export function LibraryStudyReader({
  store,
  view,
  act,
  embedded = false,
  readerCommand = null,
  onReaderState,
  onContentChanged,
  onBackFromExternal,
  onOpenExternalAccess,
}: {
  store?: Store;
  view: ViewState;
  act: Action;
  embedded?: boolean;
  readerCommand?: ReaderCommand | null;
  onReaderState?: (state: ReaderFrameState) => void;
  onContentChanged?: () => void;
  onBackFromExternal?: () => void;
  onOpenExternalAccess?: () => void;
}) {
  useI18n();
  const [session, setSession] = useState<ReaderSessionView | null>(null);
  const [status, setStatus] = useState<ReaderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [currentDoc, setCurrentDoc] = useState<{ id: string; path: string; title: string } | null>(null);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const readyRef = useRef(false);
  const queuedCmdRef = useRef<ReaderCommand | null>(null);
  const lastFrameSigRef = useRef('');
  const flushWaiters = useRef(new Map<string, (err?: string) => void>());

  const libThemeName = store?.preferences?.viewAppearance?.library?.theme ?? 'white';

  const postCommandToFrame = useCallback(
    (cmd: string, payload: Record<string, unknown> = {}) => {
      const target = frameRef.current?.contentWindow;
      if (!target || !session || !readyRef.current) return false;
      target.postMessage(
        { type: 'agents-plugin:command', token: session.id, command: cmd, ...payload },
        '*',
      );
      return true;
    },
    [session],
  );

  const syncTheme = useCallback(() => {
    const tone = DARK_THEMES.has(libThemeName) ? 'dark' : 'light';
    const rootStyle = getComputedStyle(document.documentElement);
    const accent = rootStyle.getPropertyValue('--accent').trim();
    const bg = rootStyle.getPropertyValue('--bg').trim();
    const surface = rootStyle.getPropertyValue('--bg-elev').trim();
    postCommandToFrame('set-host-theme', { theme: tone, accent, bg, surface });
  }, [libThemeName, postCommandToFrame]);

  useEffect(() => {
    if (readyRef.current) syncTheme();
  }, [syncTheme]);

  useEffect(() => {
    if (!readerCommand || !readerCommand.seq) return;
    if (!postCommandToFrame(readerCommand.command, readerCommand.payload)) {
      queuedCmdRef.current = readerCommand;
    } else {
      queuedCmdRef.current = null;
    }
  }, [readerCommand, postCommandToFrame]);

  const refreshStatus = useCallback(async (workspace?: string) => {
    try {
      const next = await api.call<ReaderStatus>(
        'reader.status',
        workspace ? { workspace } : {},
      );
      setStatus(next);
    } catch {
      /* Status counters stay optional if workspace is empty or initializing. */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    readyRef.current = false;
    setLoading(true);
    setError('');
    const openSession = async () => {
      try {
        const opened = await api.call<ReaderSessionView>('reader.open', {
          ...(view.readerWorkspace ? { workspace: view.readerWorkspace } : {}),
          ...(view.readerDocumentId ? { documentId: view.readerDocumentId } : {}),
        });
        if (!alive) return;
        setSession(opened);
        void refreshStatus(opened.workspace);
      } catch (cause) {
        if (alive) setError((cause as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void openSession();
    return () => {
      alive = false;
    };
  }, [view.readerWorkspace, view.readerDocumentId, reloadNonce, refreshStatus]);

  useEffect(() => {
    if (!session) return;

    const onMessage = async (event: MessageEvent) => {
      const frameWin = frameRef.current?.contentWindow;
      const data = event.data;
      if (!frameWin || event.source !== frameWin || data?.token !== session.id) return;

      if (data.type === 'agents-plugin:ready') {
        readyRef.current = true;
        syncTheme();
        if (queuedCmdRef.current) {
          const pending = queuedCmdRef.current;
          queuedCmdRef.current = null;
          postCommandToFrame(pending.command, pending.payload);
        }
        return;
      }

      if (data.type === 'agents-plugin:state') {
        setCurrentDoc(data.document ?? null);
        onReaderState?.({
          folder: typeof data.folder === 'string' ? data.folder : '.',
          document: data.document ?? null,
          studySetId: typeof data.studySetId === 'string' ? data.studySetId : null,
          homeSection: typeof data.homeSection === 'string' ? data.homeSection : 'library',
        });
        const sig = `${data.studySetId ?? ''}|${data.document?.id ?? ''}|${data.studyCount ?? ''}|${data.folder ?? ''}`;
        if (sig !== lastFrameSigRef.current) {
          lastFrameSigRef.current = sig;
          void refreshStatus(session.workspace);
          onContentChanged?.();
        }
        return;
      }

      if (data.type === 'agents-plugin:changed') {
        void refreshStatus(session.workspace);
        onContentChanged?.();
        return;
      }

      if (data.type === 'agents-plugin:external' && typeof data.url === 'string') {
        void api.openExternal(data.url).catch(() => {});
        return;
      }

      if (data.type === 'agents-plugin:flushed' && typeof data.id === 'string') {
        const waiter = flushWaiters.current.get(data.id);
        if (waiter) {
          flushWaiters.current.delete(data.id);
          waiter(data.error ? String(data.error) : undefined);
        }
        return;
      }

      if (data.type === 'agents-plugin:rpc') {
        const port = event.ports?.[0];
        const req = data.request;
        if (!port || req?.jsonrpc !== '2.0' || typeof req.method !== 'string') return;
        try {
          const reply = await api.call('reader.call', {
            workspace: session.workspace,
            method: req.method,
            params: req.params ?? {},
            ...(typeof req.origin === 'string' ? { origin: req.origin } : {}),
            includeEnvelope: true,
            viewId: session.id,
          });
          port.postMessage({ ...reply, id: req.id });
          if (req.method.startsWith('document.') || req.method.startsWith('study.') || req.method.startsWith('import.') || req.method.startsWith('fs.')) {
            void refreshStatus(session.workspace);
            onContentChanged?.();
          }
        } catch (cause) {
          port.postMessage({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32000, message: (cause as Error).message },
          });
        } finally {
          port.close();
        }
      }
    };

    window.addEventListener('message', onMessage);
    const offFlush = onPluginFlush(async () => {
      if (!readyRef.current || !frameRef.current?.contentWindow) return;
      const id = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          flushWaiters.current.delete(id);
          resolve();
        }, 5000);
        flushWaiters.current.set(id, (err) => {
          window.clearTimeout(timer);
          if (err) reject(new Error(err));
          else resolve();
        });
        frameRef.current?.contentWindow?.postMessage(
          { type: 'agents-plugin:flush', token: session.id, id },
          '*',
        );
      });
    });

    return () => {
      window.removeEventListener('message', onMessage);
      offFlush();
      for (const resolve of flushWaiters.current.values()) resolve();
      flushWaiters.current.clear();
      readyRef.current = false;
      lastFrameSigRef.current = '';
    };
  }, [session, refreshStatus]);

  const importFiles = async (files: File[]) => {
    if (!files.length || !session || importing) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      for (const file of files) {
        const task = await api.call<{ uploadId: string; chunkSize: number }>('reader.call', {
          workspace: session.workspace,
          method: 'import.begin',
          params: { path: file.name, totalBytes: file.size },
        });
        let committed = false;
        try {
          const step = Math.max(64 * 1024, Math.min(512 * 1024, Number(task.chunkSize) || 512 * 1024));
          for (let offset = 0; offset < file.size; offset += step) {
            const bytes = new Uint8Array(await file.slice(offset, offset + step).arrayBuffer());
            await api.call('reader.call', {
              workspace: session.workspace,
              method: 'import.chunk',
              params: {
                uploadId: task.uploadId,
                offset,
                contentBase64: bytesToBase64(bytes),
              },
            });
          }
          await api.call('reader.call', {
            workspace: session.workspace,
            method: 'import.finish',
            params: { uploadId: task.uploadId, activate: true },
          });
          committed = true;
        } finally {
          if (!committed) {
            await api
              .call('reader.call', {
                workspace: session.workspace,
                method: 'import.abort',
                params: { uploadId: task.uploadId },
              })
              .catch(() => {});
          }
        }
      }
      setNotice(uiText('Uploaded {0} files', [files.length]));
      void refreshStatus(session.workspace);
      frameRef.current?.contentWindow?.location.reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const iframeSrc = useMemo(() => {
    if (!session?.url) return '';
    if (!embedded) return session.url;
    try {
      const u = new URL(session.url, window.location.href);
      u.searchParams.set('embedded', '1');
      return u.href;
    } catch {
      return session.url + (session.url.includes('?') ? '&embedded=1' : '?embedded=1');
    }
  }, [session?.url, embedded]);

  const showBar = !embedded || Boolean(view.readerWorkspace);
  const backLabel =
    view.returnTo?.kind === 'plan'
      ? 'Back to Mission'
      : view.returnTo?.kind === 'messages'
        ? 'Back to conversation'
        : 'Back to Library';

  const importExternalDocToLibrary = async () => {
    if (!session || !view.readerWorkspace || !currentDoc?.path) return;
    setError('');
    setNotice('');
    try {
      const normalized = currentDoc.path.replace(/^\/+/, '');
      const fullPath = session.workspace.replace(/[\\/]+$/, '') + '/' + normalized;
      const opened = await api.call<ReaderSessionView>('reader.open', {
        path: fullPath,
        importToLibrary: true,
      });
      setNotice(uiText('Added to Study Reader Library'));
      onContentChanged?.();
      await act('view.open', {
        kind: 'library',
        librarySection: 'reader',
        ...(opened?.document?.id ? { readerDocumentId: opened.document.id } : {}),
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className={`library-reader-page${embedded ? ' is-embedded' : ''}`}>
      {showBar && (
      <header className="library-reader-bar">
        <div className="library-reader-bar-left">
          {!embedded && view.returnTo && (
            <BackButton
              label={backLabel}
              ariaLabel={backLabel}
              onClick={() => void act('view.close')}
            />
          )}
          {!view.returnTo && view.readerWorkspace && onBackFromExternal && (
            <BackButton
              label={uiText('Back to files')}
              ariaLabel={uiText('Back to files')}
              onClick={onBackFromExternal}
            />
          )}
          <div className="library-reader-title">
            <Icon name="book" />
            <div>
              <strong>
                {view.readerWorkspace
                  ? uiText('Reading external file')
                  : uiText('Study Reader Library')}
              </strong>
              <small>
                {status
                  ? uiText('{0} docs · {1} study sets · {2} due cards', [
                      status.documentCount,
                      status.studySetCount,
                      status.reviewDueCount,
                    ])
                  : session?.workspace ?? ''}
              </small>
            </div>
          </div>
          {view.readerWorkspace && (
            <button
              type="button"
              className="btn"
              onClick={() => void act('view.open', { kind: 'library', librarySection: 'reader' })}
            >
              {uiText('Back to Reader Library')}
            </button>
          )}
        </div>

        <div className="library-reader-bar-actions">
          {view.readerWorkspace && currentDoc?.path && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void importExternalDocToLibrary()}
            >
              <Icon name="add" />
              <span>{uiText('Import Document')}</span>
            </button>
          )}
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.epub,.mobi,.azw3,.docx,.doc,.md,.markdown,.txt,.html,.htm,.png,.jpg,.jpeg,.webp,.mp3,.mp4,.m4a,.wav"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              void importFiles(files);
            }}
          />
          {!view.readerWorkspace && (
          <button
            type="button"
            className="btn primary"
            disabled={!session || importing}
            onClick={() => uploadInputRef.current?.click()}
          >
            <Icon name={importing ? 'loading' : 'cloud-upload'} />
            <span>{uiText(importing ? 'Importing…' : 'Import Document')}</span>
          </button>
          )}

          <button
            type="button"
            className="btn"
            disabled={!session}
            onClick={() => (onOpenExternalAccess ? onOpenExternalAccess() : setAccessOpen(true))}
          >
            <Icon name="person" />
            <span>{uiText('Authorized people')}</span>
          </button>

          {api.mode !== 'web' && (session?.workspace || status?.root) && (
            <button
              type="button"
              className="btn"
              title={uiText('Open Study Folder')}
              onClick={() =>
                void revealFile({
                  local: true,
                  path: session?.workspace ?? status!.root,
                }).catch((e) => setError((e as Error).message))
              }
            >
              <Icon name="folder-opened" />
              <span>{uiText('Open Study Folder')}</span>
            </button>
          )}

          <button
            type="button"
            className="btn"
            title={uiText('Reload Reader')}
            aria-label={uiText('Reload Reader')}
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </header>
      )}

      {error && (
        <div className="library-error-banner" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
          <button type="button" onClick={() => setReloadNonce((n) => n + 1)}>
            {uiText('Retry')}
          </button>
        </div>
      )}

      {notice && (
        <div className="library-status-banner" role="status">
          <Icon name="check" />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>
            <Icon name="close" />
          </button>
        </div>
      )}

      <div className="library-reader-stage">
        {loading && !session && (
          <div className="library-empty-state">
            <Icon name="loading" />
            <p>{uiText('Loading…')}</p>
          </div>
        )}
        {session && (
          <iframe
            ref={frameRef}
            key={session.id + ':' + session.url}
            className="library-reader-frame"
            title={uiText('Study Reader')}
            sandbox="allow-scripts allow-forms allow-downloads allow-same-origin"
            allowFullScreen
            src={iframeSrc}
          />
        )}
      </div>

      {accessOpen && session && (
        <LibraryAccessDialog
          target="reader"
          workspace={session.workspace}
          onClose={() => setAccessOpen(false)}
          onSaved={() => void refreshStatus(session.workspace)}
        />
      )}
    </div>
  );
}
