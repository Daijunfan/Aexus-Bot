import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { CloudHost } from '../../../shared/remote';
import type { ViewState } from '../../../shared/view';
import { api } from '../api';
import { interfaceLocale, translate as uiText, useI18n } from '../i18n';
import { onPluginFlush } from '../plugins';
import { AppSelect } from './AppSelect';
import { FileWorkspace } from './FileWorkspace';
import { Icon } from './Icon';
import { LibraryAccessDialog } from './LibraryAccessDialog';

type HostTab = 'config' | 'files' | 'terminal' | 'access';
type HostDraft = {
  name: string;
  host: string;
  port: string;
  os: 'linux' | 'macos' | 'windows';
  distribution: string;
  defaultDirectory: string;
  password: string;
  identityFile: string;
  sshConfig: string;
  knownHosts: string;
  jump: string;
  tags: string;
  notes: string;
};

type FingerprintItem = { algorithm: string; fingerprint: string };
type PtyTab = { id: string; cwd: string; host?: string; running: boolean; exitCode?: number };

function emptyDraft(): HostDraft {
  return {
    name: '',
    host: '',
    port: '',
    os: 'linux',
    distribution: '',
    defaultDirectory: '/home',
    password: '',
    identityFile: '',
    sshConfig: '',
    knownHosts: '',
    jump: '',
    tags: '',
    notes: '',
  };
}

function hostToDraft(host: CloudHost): HostDraft {
  return {
    name: host.name,
    host: host.host,
    port: host.port ? String(host.port) : '',
    os: host.os,
    distribution: host.distribution ?? '',
    defaultDirectory: host.defaultDirectory,
    password: '',
    identityFile: host.identityFile ?? '',
    sshConfig: host.sshConfig ?? '',
    knownHosts: host.knownHosts ?? '',
    jump: host.jump ?? '',
    tags: (host.tags ?? []).join(', '),
    notes: host.notes ?? '',
  };
}

function HostTerminalPanel({ host }: { host: CloudHost }) {
  useI18n();
  const [tabs, setTabs] = useState<PtyTab[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [execCmd, setExecCmd] = useState('');
  const [execBusy, setExecBusy] = useState(false);
  const [execOutput, setExecOutput] = useState<{
    exit_code?: number;
    stdout?: string;
    stderr?: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const flushInputRef = useRef<() => Promise<unknown>>(async () => {});

  const loadTabs = useCallback(async () => {
    try {
      const list = await api.call<PtyTab[]>('host.terminal-list', { id: host.id });
      setTabs(list);
      setSelectedId((prev) => (list.some((t) => t.id === prev) ? prev : list[0]?.id ?? ''));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [host.id]);

  useEffect(() => {
    void loadTabs();
  }, [loadTabs]);

  const openNewTerminal = async () => {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const opened = await api.call<PtyTab>('host.terminal-open', {
        id: host.id,
        directory: host.defaultDirectory,
        cols: 100,
        rows: 26,
      });
      setTabs((prev) => [...prev, opened]);
      setSelectedId(opened.id);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!selectedId || !containerRef.current) return;
    let disposed = false;
    let cursor = 0;
    let pending = false;
    let again = false;
    let writing: Promise<unknown> = Promise.resolve();
    let queued = '';

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'Menlo, Monaco, monospace',
      fontSize: 13,
      scrollback: 3000,
      theme: { background: '#10141d', foreground: '#e1e7f0', cursor: '#a9c1ff' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    const read = async () => {
      if (pending) {
        again = true;
        return;
      }
      pending = true;
      try {
        const res = await api.call<PtyTab & { output: string; cursor: number; reset: boolean }>(
          'host.terminal-read',
          { id: host.id, terminal: selectedId, cursor },
        );
        if (disposed) return;
        if (res.reset) term.reset();
        if (res.output) term.write(res.output);
        cursor = res.cursor;
        term.options.disableStdin = !res.running;
        setTabs((prev) =>
          prev.map((t) =>
            t.id === selectedId ? { ...t, running: res.running, exitCode: res.exitCode } : t,
          ),
        );
      } catch (cause) {
        if (!disposed) setError((cause as Error).message);
      } finally {
        pending = false;
        if (again && !disposed) {
          again = false;
          void read();
        }
      }
    };

    const off = api.onEvent((event) => {
      if (event.channel === 'client:connected') void read();
      if (event.channel.startsWith('terminal:') && event.payload?.id === selectedId) {
        void read();
      }
    });

    const inputDisp = term.onData((data) => {
      queued += data;
      writing = writing.then(() => {
        if (disposed || !queued) return;
        const batch = queued;
        queued = '';
        return api.call('host.terminal-input', { id: host.id, terminal: selectedId, data: batch });
      });
      void writing.catch((e) => !disposed && setError((e as Error).message));
    });

    const resizeDisp = term.onResize(({ cols, rows }) => {
      void api
        .call('host.terminal-resize', { id: host.id, terminal: selectedId, cols, rows })
        .catch(() => {});
    });

    const fitViewport = () => {
      if (!disposed && containerRef.current?.clientWidth && containerRef.current.clientHeight) {
        fit.fit();
      }
    };
    const ro = new ResizeObserver(fitViewport);
    ro.observe(containerRef.current);
    fitViewport();
    void read();

    const timer = setInterval(() => void read(), 1500);
    flushInputRef.current = async () => writing;
    const offFlush = onPluginFlush(() => flushInputRef.current().then(() => {}));

    return () => {
      disposed = true;
      clearInterval(timer);
      off();
      offFlush();
      ro.disconnect();
      inputDisp.dispose();
      resizeDisp.dispose();
      term.dispose();
      flushInputRef.current = async () => {};
    };
  }, [host.id, selectedId]);

  const runExec = async () => {
    if (!execCmd.trim() || execBusy) return;
    setExecBusy(true);
    setError('');
    try {
      const res = await api.call<{ exit_code?: number; stdout?: string; stderr?: string }>(
        'host.exec',
        { id: host.id, directory: host.defaultDirectory, command: execCmd.trim() },
      );
      setExecOutput(res);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setExecBusy(false);
    }
  };

  return (
    <div className="library-host-terminal-wrap">
      <div className="library-host-exec-bar">
        <input
          type="text"
          aria-label={uiText('Run remote command')}
          placeholder={uiText('Run remote command')}
          value={execCmd}
          onChange={(e) => setExecCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runExec()}
        />
        <button
          type="button"
          className="btn primary"
          disabled={execBusy || !execCmd.trim()}
          onClick={() => void runExec()}
        >
          <Icon name={execBusy ? 'loading' : 'play'} />
          <span>{uiText('Run command')}</span>
        </button>
      </div>

      {execOutput && (
        <pre className="library-host-exec-output">
          {`[exit ${execOutput.exit_code ?? 0}]\n${execOutput.stdout ?? ''}${execOutput.stderr ? '\n' + execOutput.stderr : ''}`}
        </pre>
      )}

      {error && (
        <div className="library-error-banner" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            <Icon name="close" />
          </button>
        </div>
      )}

      <div className="library-host-pty-tabs">
        <nav>
          {tabs.map((tab, idx) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === selectedId ? 'is-active' : ''}
              onClick={() => setSelectedId(tab.id)}
            >
              SSH {idx + 1}
              {!tab.running ? ' · Stopped' : ''}
            </button>
          ))}
        </nav>
        <div>
          <button type="button" className="btn" disabled={creating} onClick={() => void openNewTerminal()}>
            <Icon name="add" />
            <span>{uiText('New terminal')}</span>
          </button>
          {selectedId && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void api
                  .call('host.terminal-close', { id: host.id, terminal: selectedId })
                  .then(loadTabs)
                  .catch((e) => setError((e as Error).message))
              }
            >
              <Icon name="trash" />
            </button>
          )}
        </div>
      </div>

      {selectedId ? (
        <div className="library-host-xterm-box" ref={containerRef} />
      ) : (
        <div className="library-empty-state">
          <Icon name="terminal" />
          <p>{host.host}</p>
          <button type="button" className="btn primary" disabled={creating} onClick={() => void openNewTerminal()}>
            {uiText('New terminal')}
          </button>
        </div>
      )}
    </div>
  );
}

export function LibraryCloudHosts({
  view,
  embeddedHostMode = false,
  embeddedHostId,
  createSignal = 0,
  onHostsChanged,
  onSelectHost,
  onBackToShelf,
}: {
  view: ViewState;
  embeddedHostMode?: boolean;
  embeddedHostId?: string | null;
  createSignal?: number;
  onHostsChanged?: (hosts: CloudHost[]) => void;
  onSelectHost?: (hostId: string) => void;
  onBackToShelf?: () => void;
}) {
  useI18n();
  const [hosts, setHosts] = useState<CloudHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(
    embeddedHostId !== undefined ? embeddedHostId : view.libraryHostId ?? null,
  );
  const [creatingNew, setCreatingNew] = useState(false);
  const [activeTab, setActiveTab] = useState<HostTab>('config');
  const [search, setSearch] = useState('');
  const [osFilter, setOsFilter] = useState<'all' | 'linux' | 'macos' | 'windows'>('all');
  const [draft, setDraft] = useState<HostDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [remoteDirs, setRemoteDirs] = useState<{ path: string; entries: Array<{ name: string; path: string }> } | null>(null);
  const [fingerprints, setFingerprints] = useState<FingerprintItem[] | null>(null);
  const [scanningFp, setScanningFp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadHosts = useCallback(async () => {
    setError('');
    try {
      const list = await api.call<CloudHost[]>('host.list');
      const items = list ?? [];
      setHosts(items);
      onHostsChanged?.(items);
      setSelectedId((prev) => {
        if (creatingNew) return null;
        if (embeddedHostId && items.some((h) => h.id === embeddedHostId)) return embeddedHostId;
        if (view.libraryHostId && items.some((h) => h.id === view.libraryHostId)) return view.libraryHostId;
        if (prev && items.some((h) => h.id === prev)) return prev;
        return items[0]?.id ?? null;
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [creatingNew, embeddedHostId, view.libraryHostId, onHostsChanged]);

  useEffect(() => {
    void loadHosts();
    const off = api.onEvent((event) => {
      if (['hosts:changed', 'host:health'].includes(event.channel)) {
        void loadHosts();
      }
    });
    return off;
  }, [loadHosts]);

  useEffect(() => {
    if (createSignal > 0) {
      setCreatingNew(true);
      setSelectedId(null);
      setActiveTab('config');
    }
  }, [createSignal]);

  useEffect(() => {
    if (embeddedHostId && hosts.some((h) => h.id === embeddedHostId)) {
      setCreatingNew(false);
      setSelectedId(embeddedHostId);
    }
  }, [embeddedHostId, hosts]);

  useEffect(() => {
    if (view.libraryHostId && hosts.some((h) => h.id === view.libraryHostId)) {
      setCreatingNew(false);
      setSelectedId(view.libraryHostId);
    }
  }, [view.libraryHostId, hosts]);

  const selectedHost = useMemo(
    () => (creatingNew ? null : hosts.find((h) => h.id === selectedId) ?? null),
    [creatingNew, hosts, selectedId],
  );

  useEffect(() => {
    if (creatingNew) {
      setDraft(emptyDraft());
    } else if (selectedHost) {
      setDraft(hostToDraft(selectedHost));
    }
    setRevealedPassword(null);
    setRemoteDirs(null);
    setFingerprints(null);
    setConfirmDelete(false);
  }, [creatingNew, selectedHost?.id, selectedHost?.updatedAt]);

  const filteredHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hosts.filter((h) => {
      if (osFilter !== 'all' && h.os !== osFilter) return false;
      if (!q) return true;
      return `${h.name} ${h.host} ${h.os} ${h.distribution ?? ''} ${(h.tags ?? []).join(' ')}`
        .toLowerCase()
        .includes(q);
    });
  }, [hosts, search, osFilter]);

  const saveHost = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = {
        name: draft.name.trim(),
        host: draft.host.trim(),
        os: draft.os,
        defaultDirectory: draft.defaultDirectory.trim(),
        ...(draft.port.trim() ? { port: Number(draft.port.trim()) } : creatingNew ? {} : { port: undefined }),
        ...(draft.os === 'linux' && draft.distribution.trim()
          ? { distribution: draft.distribution.trim().toLowerCase() }
          : {}),
        ...(draft.identityFile.trim() ? { identityFile: draft.identityFile.trim() } : { identityFile: '' }),
        ...(draft.sshConfig.trim() ? { sshConfig: draft.sshConfig.trim() } : { sshConfig: '' }),
        ...(draft.knownHosts.trim() ? { knownHosts: draft.knownHosts.trim() } : { knownHosts: '' }),
        ...(draft.jump.trim() ? { jump: draft.jump.trim() } : { jump: '' }),
        tags: draft.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: draft.notes.trim(),
      };
      if (draft.password) payload.password = draft.password;

      if (creatingNew) {
        const created = await api.call<CloudHost>('host.create', payload);
        setCreatingNew(false);
        setSelectedId(created.id);
        onSelectHost?.(created.id);
        setNotice(created.name);
      } else if (selectedHost) {
        const updated = await api.call<CloudHost>('host.update', {
          id: selectedHost.id,
          patch: payload,
        });
        setNotice(updated.name);
      }
      await loadHosts();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const revealCreds = async () => {
    if (!selectedHost) return;
    if (revealedPassword !== null) {
      setRevealedPassword(null);
      return;
    }
    setError('');
    try {
      const res = await api.call<{ password: string }>('host.credentials', {
        id: selectedHost.id,
        files: false,
      });
      setRevealedPassword(res.password || '');
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const browseDirectories = async (dir = draft.defaultDirectory || '/') => {
    if (!selectedHost) return;
    setError('');
    try {
      const res = await api.call<{ path: string; entries: Array<{ name: string; path: string }> }>(
        'host.directories',
        { id: selectedHost.id, path: dir },
      );
      setRemoteDirs(res);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const checkOne = async (id: string) => {
    setCheckingId(id);
    setError('');
    try {
      await api.call('host.check', { id });
      await loadHosts();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCheckingId(null);
    }
  };

  const checkAllHosts = async () => {
    if (checkingAll || !hosts.length) return;
    setCheckingAll(true);
    setError('');
    try {
      await Promise.all(hosts.map((h) => api.call('host.check', { id: h.id }).catch(() => {})));
      await loadHosts();
    } finally {
      setCheckingAll(false);
    }
  };

  const scanFingerprints = async () => {
    if (!selectedHost) return;
    setScanningFp(true);
    setError('');
    try {
      const list = await api.call<FingerprintItem[]>('host.fingerprints', { id: selectedHost.id });
      setFingerprints(list);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setScanningFp(false);
    }
  };

  const trustFingerprint = async (fp: string) => {
    if (!selectedHost) return;
    setError('');
    try {
      await api.call('host.trust', { id: selectedHost.id, fingerprint: fp });
      setNotice(uiText('Trusted'));
      await loadHosts();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const removeHost = async () => {
    if (!selectedHost) return;
    setSaving(true);
    setError('');
    try {
      await api.call('host.remove', { id: selectedHost.id });
      setConfirmDelete(false);
      setSelectedId(null);
      await loadHosts();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`library-hosts-page${embeddedHostMode ? ' embedded-host-mode' : ''}`}>
      {!embeddedHostMode && (
      <aside className="library-hosts-sidebar" aria-label={uiText('Cloud Hosts')}>
        <header className="library-hosts-sidebar-head">
          <div>
            <h2>{uiText('Cloud Hosts')}</h2>
            <small>
              {hosts.filter((h) => h.status?.connected).length} / {hosts.length}
            </small>
          </div>
          <div className="library-hosts-sidebar-buttons">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setCreatingNew(true);
                setSelectedId(null);
                setActiveTab('config');
              }}
            >
              <Icon name="add" />
              <span>{uiText('Add Host')}</span>
            </button>
            <button
              type="button"
              className="btn"
              title={uiText('Authorized people')}
              aria-label={uiText('Authorized people')}
              onClick={() => setAccessOpen(true)}
            >
              <Icon name="person" />
            </button>
            <button
              type="button"
              className="btn"
              title={uiText('Check All')}
              aria-label={uiText('Check All')}
              disabled={checkingAll || !hosts.length}
              onClick={() => void checkAllHosts()}
            >
              <Icon name={checkingAll ? 'loading' : 'refresh'} />
            </button>
          </div>
        </header>

        <div className="library-hosts-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label={uiText('Search cloud hosts…')}
            placeholder={uiText('Search cloud hosts…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="library-hosts-os-pills" role="group">
          {(['all', 'linux', 'macos', 'windows'] as const).map((os) => (
            <button
              key={os}
              type="button"
              aria-pressed={osFilter === os}
              onClick={() => setOsFilter(os)}
            >
              {os === 'all' ? uiText('All') : os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux'}
            </button>
          ))}
        </div>

        <div className="library-hosts-list" role="list">
          {filteredHosts.map((host) => {
            const stateClass =
              host.status?.connected === true
                ? 'is-online'
                : host.status?.connected === false
                  ? 'is-failed'
                  : 'is-unknown';
            return (
              <button
                key={host.id}
                type="button"
                role="listitem"
                className={`library-host-card${!creatingNew && selectedHost?.id === host.id ? ' is-selected' : ''}`}
                onClick={() => {
                  setCreatingNew(false);
                  setSelectedId(host.id);
                }}
              >
                <div className="library-host-card-head">
                  <span className={`library-health-lamp ${stateClass}`} />
                  <strong>{host.name}</strong>
                  <small>{host.os}</small>
                </div>
                <span className="library-host-addr">
                  {host.host}
                  {host.port ? `:${host.port}` : ''}
                </span>
                <small className="library-host-dir">{host.defaultDirectory}</small>
              </button>
            );
          })}
          {!filteredHosts.length && !loading && (
            <p className="library-empty-note">{uiText('No registered cloud hosts yet')}</p>
          )}
        </div>
      </aside>
      )}

      <section className="library-hosts-main">
        {!creatingNew && !selectedHost ? (
          <div className="library-empty-state">
            <Icon name="server-environment" />
            <h3>{uiText('Cloud Hosts')}</h3>
            <p>
              {uiText(
                'Select a cloud host or add a new SSH host to manage its configuration, SFTP files and terminal.',
              )}
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setCreatingNew(true);
                setActiveTab('config');
              }}
            >
              <Icon name="add" />
              <span>{uiText('Add Host')}</span>
            </button>
          </div>
        ) : (
          <>
            <header className="library-hosts-workbench-head">
              <div className="library-hosts-head-left">
                {onBackToShelf && (
                  <button
                    type="button"
                    className="library-shelf-pill-btn"
                    onClick={onBackToShelf}
                  >
                    <Icon name="arrow-left" />
                    <span>{uiText('Back to Shelf')}</span>
                  </button>
                )}
                <div>
                  <h2>{creatingNew ? uiText('Create Cloud Host') : selectedHost!.name}</h2>
                  {selectedHost && (
                    <small>
                      {selectedHost.host}
                      {selectedHost.port ? `:${selectedHost.port}` : ''} · {selectedHost.defaultDirectory}
                      {selectedHost.status?.checkedAt
                        ? ` · ${new Date(selectedHost.status.checkedAt).toLocaleTimeString(interfaceLocale())}`
                        : ''}
                    </small>
                  )}
                </div>
              </div>
              {!creatingNew && selectedHost && (
                <div className="library-host-tabs" role="tablist">
                  {(
                    [
                      ['config', 'Configuration', 'settings-gear'],
                      ['files', 'Remote SFTP Files', 'folder-opened'],
                      ['terminal', 'SSH Terminal', 'terminal'],
                      ['access', 'Host Access', 'person'],
                    ] as const
                  ).map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === id}
                      onClick={() => setActiveTab(id)}
                    >
                      <Icon name={icon} />
                      <span>{uiText(label)}</span>
                    </button>
                  ))}
                </div>
              )}
            </header>

            {error && (
              <div className="library-error-banner" role="alert">
                <Icon name="warning" />
                <span>{error}</span>
                <button type="button" onClick={() => setError('')}>
                  <Icon name="close" />
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

            {(creatingNew || activeTab === 'config') && (
              <div className="library-host-config-scroll">
                <form
                  className="library-host-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveHost();
                  }}
                >
                  <div className="library-form-grid">
                    <label>
                      <span>{uiText('Host name')}</span>
                      <input
                        type="text"
                        required
                        aria-label={uiText('Host name')}
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{uiText('SSH target (user@host)')}</span>
                      <input
                        type="text"
                        required
                        placeholder="ubuntu@10.0.0.12"
                        aria-label={uiText('SSH target (user@host)')}
                        value={draft.host}
                        onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{uiText('SSH Port')}</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="22"
                        aria-label={uiText('SSH Port')}
                        value={draft.port}
                        onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{uiText('Operating system')}</span>
                      <AppSelect
                        aria-label={uiText('Operating system')}
                        value={draft.os}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, os: e.target.value as HostDraft['os'] }))
                        }
                      >
                        <option value="linux">Linux</option>
                        <option value="macos">macOS</option>
                        <option value="windows">Windows</option>
                      </AppSelect>
                    </label>
                    {draft.os === 'linux' && (
                      <label>
                        <span>{uiText('Linux distribution')}</span>
                        <input
                          type="text"
                          placeholder="ubuntu"
                          aria-label={uiText('Linux distribution')}
                          value={draft.distribution}
                          onChange={(e) => setDraft((d) => ({ ...d, distribution: e.target.value }))}
                        />
                      </label>
                    )}
                    <label className="is-wide">
                      <span>{uiText('Default directory')}</span>
                      <div className="library-input-with-btn">
                        <input
                          type="text"
                          required
                          aria-label={uiText('Default directory')}
                          value={draft.defaultDirectory}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, defaultDirectory: e.target.value }))
                          }
                        />
                        {!creatingNew && selectedHost && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void browseDirectories()}
                          >
                            {uiText('Browse remote folders')}
                          </button>
                        )}
                      </div>
                    </label>

                    <label className="is-wide">
                      <span>{uiText('SSH Password')}</span>
                      <div className="library-input-with-btn">
                        <input
                          type="password"
                          aria-label={uiText('SSH Password')}
                          placeholder={
                            selectedHost?.hasPassword
                              ? uiText('Leave blank to keep existing password')
                              : ''
                          }
                          value={draft.password}
                          onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                        />
                        {!creatingNew && selectedHost?.hasPassword && (
                          <button type="button" className="btn" onClick={() => void revealCreds()}>
                            <Icon name={revealedPassword !== null ? 'eye-closed' : 'eye'} />
                            <span>
                              {uiText(
                                revealedPassword !== null ? 'Hide password' : 'Reveal password',
                              )}
                            </span>
                          </button>
                        )}
                      </div>
                      {revealedPassword !== null && (
                        <code className="library-revealed-secret" data-revealed-password>
                          {revealedPassword || '(empty)'}
                        </code>
                      )}
                    </label>

                    <label>
                      <span>{uiText('Identity key file')}</span>
                      <input
                        type="text"
                        placeholder="~/.ssh/id_ed25519"
                        value={draft.identityFile}
                        onChange={(e) => setDraft((d) => ({ ...d, identityFile: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{uiText('ProxyJump host')}</span>
                      <input
                        type="text"
                        placeholder="bastion@jump.example.com"
                        value={draft.jump}
                        onChange={(e) => setDraft((d) => ({ ...d, jump: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{uiText('SSH config path')}</span>
                      <input
                        type="text"
                        placeholder="~/.ssh/config"
                        value={draft.sshConfig}
                        onChange={(e) => setDraft((d) => ({ ...d, sshConfig: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{uiText('Known hosts path')}</span>
                      <input
                        type="text"
                        value={draft.knownHosts}
                        onChange={(e) => setDraft((d) => ({ ...d, knownHosts: e.target.value }))}
                      />
                    </label>
                    <label className="is-wide">
                      <span>{uiText('Comma-separated tags')}</span>
                      <input
                        type="text"
                        placeholder="gpu, production"
                        value={draft.tags}
                        onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                      />
                    </label>
                    <label className="is-wide">
                      <span>{uiText('Host notes')}</span>
                      <textarea
                        rows={3}
                        value={draft.notes}
                        onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                      />
                    </label>
                  </div>

                  {remoteDirs && (
                    <div className="library-remote-dir-box">
                      <header>
                        <code>{remoteDirs.path}</code>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setDraft((d) => ({ ...d, defaultDirectory: remoteDirs.path }));
                            setRemoteDirs(null);
                          }}
                        >
                          {uiText('Use this folder')}
                        </button>
                      </header>
                      <div className="library-remote-dir-list">
                        {remoteDirs.entries.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            onClick={() => void browseDirectories(entry.path)}
                          >
                            <Icon name="folder" />
                            <span>{entry.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <footer className="library-host-form-actions">
                    <div className="library-host-form-left">
                      {!creatingNew && selectedHost && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            disabled={checkingId === selectedHost.id}
                            onClick={() => void checkOne(selectedHost.id)}
                          >
                            <Icon name={checkingId === selectedHost.id ? 'loading' : 'sync'} />
                            <span>{uiText('Test Connection')}</span>
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={scanningFp}
                            onClick={() => void scanFingerprints()}
                          >
                            <Icon name={scanningFp ? 'loading' : 'shield'} />
                            <span>{uiText('Scan Fingerprints')}</span>
                          </button>
                          {confirmDelete ? (
                            <span className="library-confirm-delete">
                              <span>{uiText('Delete this cloud host?')}</span>
                              <button
                                type="button"
                                className="btn danger"
                                disabled={saving}
                                onClick={() => void removeHost()}
                              >
                                {uiText('Confirm')}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setConfirmDelete(false)}
                              >
                                {uiText('Cancel')}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn danger"
                              onClick={() => setConfirmDelete(true)}
                            >
                              <Icon name="trash" />
                              <span>{uiText('Delete Host')}</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    <div className="library-host-form-right">
                      {creatingNew && hosts.length > 0 && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setCreatingNew(false);
                            setSelectedId(hosts[0].id);
                          }}
                        >
                          {uiText('Cancel')}
                        </button>
                      )}
                      <button type="submit" className="btn primary" disabled={saving}>
                        {uiText(saving ? 'Saving…' : 'Save changes')}
                      </button>
                    </div>
                  </footer>
                </form>

                {fingerprints && (
                  <section className="library-card library-fingerprints-card">
                    <h3>SSH Fingerprints</h3>
                    {fingerprints.map((fp) => (
                      <div key={fp.fingerprint} className="library-fingerprint-row">
                        <span>{fp.algorithm}</span>
                        <code>{fp.fingerprint}</code>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void trustFingerprint(fp.fingerprint)}
                        >
                          {uiText('Trust Fingerprint')}
                        </button>
                      </div>
                    ))}
                  </section>
                )}

                {selectedHost?.status?.error && (
                  <p className="library-error-banner" role="alert">
                    {selectedHost.status.error}
                  </p>
                )}
              </div>
            )}

            {!creatingNew && selectedHost && activeTab === 'files' && (
              <div className="library-host-files-pane">
                <FileWorkspace
                  key={selectedHost.id}
                  hostId={selectedHost.id}
                  folderName={`${selectedHost.name} · ${selectedHost.defaultDirectory}`}
                  revealAvailable={false}
                />
              </div>
            )}

            {!creatingNew && selectedHost && activeTab === 'terminal' && (
              <HostTerminalPanel host={selectedHost} />
            )}

            {!creatingNew && selectedHost && activeTab === 'access' && (
              <div className="library-host-access-pane">
                <div className="library-card">
                  <div className="library-section-title">
                    <div>
                      <h3>{uiText('Host Access')}</h3>
                      <p className="library-domain-desc">
                        {uiText('Manage per-employee access for Cloud Hosts')}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => setAccessOpen(true)}
                    >
                      <Icon name="person" />
                      <span>{uiText('Authorized people')}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {accessOpen && (
        <LibraryAccessDialog
          target="host"
          initialResourceIds={selectedHost ? [`host:${selectedHost.id}`] : undefined}
          onClose={() => setAccessOpen(false)}
        />
      )}
    </div>
  );
}
