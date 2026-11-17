import { useCallback, useEffect, useRef, useState } from 'react';
import { assetSize, assetTitle } from '../../../shared/asset-presentation';
import type { AssetNode, AssetView } from '../../../shared/asset-schema';
import type { LibraryDomainId, LibraryFileHighlight, LibraryOverview as OverviewData, LibrarySection } from '../../../shared/library-api';
import type { ViewState } from '../../../shared/view';
import { api } from '../api';
import { uploadFiles } from '../file-transfers';
import { translate as uiText, useI18n, interfaceLocale } from '../i18n';
import { AssetCover } from './AssetGallery';
import { Icon } from './Icon';

type Action = (cmd: string, args?: Record<string, unknown>, propagateError?: boolean) => Promise<any>;

const DOMAIN_COLORS: Record<LibraryDomainId, string> = {
  employees: '#4c7ef3',
  privateChats: '#8b5cf6',
  groupsAndChannels: '#0ea5e9',
  reader: '#10b981',
  notebook: '#f59e0b',
  shared: '#ec4899',
  hosts: '#64748b',
};

const DOMAIN_ICONS: Record<LibraryDomainId, string> = {
  employees: 'person',
  privateChats: 'comment-discussion',
  groupsAndChannels: 'organization',
  reader: 'book',
  notebook: 'checklist',
  shared: 'folder-opened',
  hosts: 'server-environment',
};

const DOMAIN_EXPLORER_SCOPE: Partial<Record<LibraryDomainId, AssetView>> = {
  employees: 'Agents',
  privateChats: 'Messages',
  groupsAndChannels: 'Messages',
  reader: 'Reader',
  notebook: 'Plan',
  hosts: 'Hosts',
};

const KIND_LABELS: Record<string, string> = {
  document: 'Documents',
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  code: 'Code',
  archive: 'Archives',
  other: 'Other files',
};

function asAssetNode(file: LibraryFileHighlight): AssetNode {
  return {
    id: file.id,
    name: file.name,
    directory: false,
    locked: false,
    kind: file.kind,
    storage: file.storage,
    bytes: file.bytes,
    modifiedAt: file.modifiedAt,
  };
}

export function LibraryOverview({
  act,
  onNavigate,
  onOpenFilesScope,
  onSearchWith,
  onOpenInReader,
  onInspectFile,
}: {
  act: Action;
  onNavigate: (section: LibrarySection, extra?: Partial<ViewState>) => void;
  onOpenFilesScope: (viewScope: AssetView | '', rootId?: string) => void;
  onSearchWith: (query?: string, kind?: string) => void;
  onOpenInReader: (opts: { path?: string; assetId?: string }) => void;
  onInspectFile: (file: LibraryFileHighlight) => void;
}) {
  useI18n();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else if (!data) setLoading(true);
    setError('');
    try {
      const res = await api.call<OverviewData>('library.overview', forceRefresh ? { refresh: true } : {});
      setData(res);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.onEvent((event) => {
      if (
        ['store:changed', 'chat:changed', 'channel:changed', 'hosts:changed', 'access:changed'].includes(
          event.channel,
        )
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => void load(false), 250);
      }
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [load]);

  const handleUpload = async (fileList: FileList | null) => {
    const files = [...(fileList ?? [])];
    if (!files.length) return;
    setError('');
    setUploadNotice('');
    try {
      await uploadFiles(files, { shared: true, path: '.' });
      setUploadNotice(uiText('Uploaded {0} files to Shared Workspace', [files.length]));
      await load(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const formatTime = (ms?: number) => {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString(interfaceLocale(), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const storageTotal = Math.max(1, data?.totalBytes ?? 0);
  const maxLargest = Math.max(1, ...(data?.largestFiles.map((f) => f.bytes) ?? [1]));

  const openDomain = (domainId: LibraryDomainId) => {
    if (domainId === 'reader') {
      onNavigate('reader');
      return;
    }
    if (domainId === 'hosts') {
      onNavigate('hosts');
      return;
    }
    onOpenFilesScope(DOMAIN_EXPLORER_SCOPE[domainId] ?? '');
  };

  return (
    <div className="library-scroll-page library-overview">
      <header className="library-page-header">
        <div>
          <span className="library-eyebrow">{uiText('Unified Visual Storage Hub')}</span>
          <h1>{uiText('Storage Overview')}</h1>
          <p>
            {uiText(
              'Every file, chat attachment, notebook, study card and cloud host in one workspace',
            )}
          </p>
        </div>
        <div className="library-header-actions">
          <input
            ref={uploadRef}
            type="file"
            multiple
            hidden
            aria-label={uiText('Upload files')}
            onChange={(event) => {
              void handleUpload(event.target.files);
              event.target.value = '';
            }}
          />
          <button type="button" className="btn" onClick={() => onSearchWith('')}>
            <Icon name="search" />
            <span>{uiText('Super Search')}</span>
            <kbd>⌘K</kbd>
          </button>
          <button type="button" className="btn" onClick={() => uploadRef.current?.click()}>
            <Icon name="cloud-upload" />
            <span>{uiText('Upload files')}</span>
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            <Icon name={refreshing ? 'loading' : 'refresh'} />
            <span>{uiText('Refresh')}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="library-error-banner" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
          <button type="button" onClick={() => void load(true)}>
            {uiText('Retry')}
          </button>
        </div>
      )}

      {uploadNotice && (
        <div className="library-status-banner" role="status">
          <Icon name="check" />
          <span>{uploadNotice}</span>
          <button type="button" onClick={() => setUploadNotice('')} aria-label={uiText('Close')}>
            <Icon name="close" />
          </button>
        </div>
      )}

      <section className="library-kpi-grid" aria-label={uiText('Storage Overview')}>
        <article className="library-kpi-card">
          <span className="library-kpi-icon">
            <Icon name="pie-chart" />
          </span>
          <div>
            <small>{uiText('Total local storage')}</small>
            <strong>{loading ? '…' : assetSize(data?.totalBytes ?? 0) || '0 B'}</strong>
            <span>{loading ? '' : uiText('{0} files', [data?.totalFiles ?? 0])}</span>
          </div>
        </article>

        <article
          className="library-kpi-card is-clickable"
          onClick={() => onNavigate('reader')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onNavigate('reader')}
        >
          <span className="library-kpi-icon is-reader">
            <Icon name="book" />
          </span>
          <div>
            <small>{uiText('Study Reader')}</small>
            <strong>{loading ? '…' : data?.reader.documentCount ?? 0}</strong>
            <span>
              {loading
                ? ''
                : uiText('{0} study sets · {1} due', [
                    data?.reader.studySetCount ?? 0,
                    data?.reader.reviewDueCount ?? 0,
                  ])}
            </span>
          </div>
        </article>

        <article
          className="library-kpi-card is-clickable"
          onClick={() => onNavigate('hosts')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onNavigate('hosts')}
        >
          <span className="library-kpi-icon is-hosts">
            <Icon name="server-environment" />
          </span>
          <div>
            <small>{uiText('Cloud Hosts')}</small>
            <strong>
              {loading ? '…' : `${data?.hosts.connected ?? 0} / ${data?.hosts.total ?? 0}`}
            </strong>
            <span>
              {data && Object.keys(data.hosts.osBreakdown).length
                ? Object.entries(data.hosts.osBreakdown)
                    .map(([os, count]) => `${os}: ${count}`)
                    .join(' · ')
                : uiText('No registered cloud hosts yet')}
            </span>
          </div>
        </article>

        <article
          className="library-kpi-card is-clickable"
          onClick={() => void act('view.select', { id: 'plan' })}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && void act('view.select', { id: 'plan' })}
        >
          <span className="library-kpi-icon is-notebook">
            <Icon name="checklist" />
          </span>
          <div>
            <small>{uiText('Mission Notebook & Exports')}</small>
            <strong>{loading ? '…' : data?.notebook.pageCount ?? 0}</strong>
            <span>{uiText('Pages & workflows')}</span>
          </div>
        </article>
      </section>

      {data && (
        <>
          <section className="library-card library-distribution-card" aria-label={uiText('Storage distribution')}>
            <div className="library-section-title">
              <h2>{uiText('Storage distribution')}</h2>
              <span>
                {assetSize(data.totalBytes) || '0 B'} · {uiText('{0} files', [data.totalFiles])}
              </span>
            </div>
            <div className="library-stacked-bar" role="img" aria-label={uiText('Storage distribution')}>
              {data.domains.map((domain) => {
                const pct = data.totalBytes > 0 ? (domain.bytes / storageTotal) * 100 : 0;
                if (pct <= 0.2) return null;
                return (
                  <div
                    key={domain.id}
                    className="library-stacked-segment"
                    style={{
                      width: `${Math.max(2, pct)}%`,
                      background: DOMAIN_COLORS[domain.id],
                    }}
                    title={`${uiText(domain.name)}: ${assetSize(domain.bytes) || '0 B'} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="library-stacked-legend">
              {data.domains.map((domain) => {
                const pct = data.totalBytes > 0 ? ((domain.bytes / storageTotal) * 100).toFixed(1) : '0.0';
                return (
                  <button
                    key={domain.id}
                    type="button"
                    className="library-legend-pill"
                    onClick={() => openDomain(domain.id)}
                  >
                    <i style={{ background: DOMAIN_COLORS[domain.id] }} />
                    <span>{uiText(domain.name)}</span>
                    <strong>{domain.id === 'hosts' ? `${domain.itemCount}` : assetSize(domain.bytes) || '0 B'}</strong>
                    {domain.id !== 'hosts' && <small>{pct}%</small>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="library-domains-grid" aria-label={uiText('Storage domains')}>
            {data.domains.map((domain) => (
              <article key={domain.id} className="library-domain-card" data-domain={domain.id}>
                <header>
                  <span
                    className="library-domain-badge"
                    style={{ background: `${DOMAIN_COLORS[domain.id]}18`, color: DOMAIN_COLORS[domain.id] }}
                  >
                    <Icon name={DOMAIN_ICONS[domain.id]} />
                  </span>
                  <div className="library-domain-title">
                    <h3>{uiText(domain.name)}</h3>
                    {domain.decoupled && <em className="library-decoupled-pill">{uiText('Decoupled')}</em>}
                  </div>
                  <button
                    type="button"
                    className="library-icon-btn"
                    aria-label={`${uiText(domain.name)}`}
                    onClick={() => openDomain(domain.id)}
                  >
                    <Icon name="arrow-up-right" />
                  </button>
                </header>
                <p className="library-domain-desc">{uiText(domain.description)}</p>
                {domain.path && <code className="library-domain-path" title={domain.path}>{domain.path}</code>}
                <footer>
                  <span>
                    {domain.id === 'hosts'
                      ? `${domain.itemCount} ${uiText('Cloud Hosts')}`
                      : `${assetSize(domain.bytes) || '0 B'} · ${uiText('{0} files', [domain.fileCount])}`}
                  </span>
                  {domain.id === 'notebook' ? (
                    <div className="library-domain-links">
                      <button type="button" onClick={() => onOpenFilesScope('Plan')}>
                        {uiText('All Files')}
                      </button>
                      <button type="button" onClick={() => void act('view.select', { id: 'plan' })}>
                        Mission
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => openDomain(domain.id)}>
                      {uiText(
                        domain.id === 'reader'
                          ? 'Study Reader'
                          : domain.id === 'hosts'
                            ? 'Cloud Hosts'
                            : 'Open folder',
                      )}
                    </button>
                  )}
                </footer>
              </article>
            ))}
          </section>

          {!!data.byKind.length && (
            <section className="library-card" aria-label={uiText('File types')}>
              <div className="library-section-title">
                <h2>{uiText('File types')}</h2>
              </div>
              <div className="library-kind-pills">
                {data.byKind.map((entry) => (
                  <button
                    key={entry.kind}
                    type="button"
                    className="library-kind-chip"
                    onClick={() => onSearchWith('', entry.kind)}
                  >
                    <strong>{uiText(KIND_LABELS[entry.kind] ?? entry.kind)}</strong>
                    <span>{entry.count}</span>
                    <small>{assetSize(entry.bytes) || '0 B'}</small>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="library-showcase-columns">
            <section className="library-card" aria-label={uiText('Recent files')}>
              <div className="library-section-title">
                <h2>{uiText('Recent files')}</h2>
                <button type="button" className="library-link-btn" onClick={() => onOpenFilesScope('')}>
                  {uiText('All Files')}
                </button>
              </div>
              {!data.recentFiles.length ? (
                <p className="library-empty-note">{uiText('This folder is empty.')}</p>
              ) : (
                <div className="library-recent-grid">
                  {data.recentFiles.slice(0, 8).map((file) => {
                    const pseudo = asAssetNode(file);
                    return (
                      <article key={file.id} className="library-recent-tile">
                        <button
                          type="button"
                          className="library-recent-cover"
                          onClick={() => onInspectFile(file)}
                          title={file.path}
                        >
                          <AssetCover node={pseudo} revision={file.modifiedAt} />
                        </button>
                        <div className="library-recent-meta">
                          <strong title={assetTitle(pseudo)}>{file.name}</strong>
                          <small>
                            {file.ownerLabel} · {assetSize(file.bytes)}
                          </small>
                          <small>{formatTime(file.modifiedAt)}</small>
                          <div className="library-recent-actions">
                            <button type="button" onClick={() => onInspectFile(file)}>
                              {uiText('Preview')}
                            </button>
                            {file.canOpenInReader && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenInReader({
                                    assetId: file.id,
                                    path: file.assetId === 'reader:library' ? file.path : undefined,
                                  })
                                }
                              >
                                {uiText('Open in Study Reader')}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="library-card" aria-label={uiText('Largest files')}>
              <div className="library-section-title">
                <h2>{uiText('Largest files')}</h2>
                <button
                  type="button"
                  className="library-link-btn"
                  onClick={() => onSearchWith('', 'all')}
                >
                  {uiText('Super Search')}
                </button>
              </div>
              {!data.largestFiles.length ? (
                <p className="library-empty-note">{uiText('This folder is empty.')}</p>
              ) : (
                <div className="library-largest-list">
                  {data.largestFiles.slice(0, 8).map((file) => {
                    const widthPct = Math.max(4, Math.round((file.bytes / maxLargest) * 100));
                    return (
                      <div key={file.id} className="library-largest-row">
                        <div className="library-largest-head">
                          <button type="button" onClick={() => onInspectFile(file)} title={file.path}>
                            <strong>{file.name}</strong>
                            <small>
                              {uiText(file.domainLabel)} · {file.ownerLabel}
                            </small>
                          </button>
                          <span className="library-largest-size">{assetSize(file.bytes)}</span>
                          {file.canOpenInReader && (
                            <button
                              type="button"
                              className="library-icon-btn"
                              title={uiText('Open in Study Reader')}
                              aria-label={uiText('Open in Study Reader')}
                              onClick={() =>
                                onOpenInReader({
                                  assetId: file.id,
                                  path: file.assetId === 'reader:library' ? file.path : undefined,
                                })
                              }
                            >
                              <Icon name="book" />
                            </button>
                          )}
                        </div>
                        <div className="library-largest-track">
                          <span
                            style={{
                              width: `${widthPct}%`,
                              background: DOMAIN_COLORS[file.domain],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
