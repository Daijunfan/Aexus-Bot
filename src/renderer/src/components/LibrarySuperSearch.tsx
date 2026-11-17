import { useEffect, useRef, useState } from 'react';
import { assetSize } from '../../../shared/asset-presentation';
import type {
  LibrarySearchDomain,
  LibrarySearchItem,
  LibrarySearchResponse,
  LibrarySection,
} from '../../../shared/library-api';
import type { CloudHost } from '../../../shared/remote';
import type { Store } from '../../../shared/types';
import type { ViewState } from '../../../shared/view';
import { api } from '../api';
import { interfaceLocale, translate as uiText, useI18n } from '../i18n';
import { AppSelect } from './AppSelect';
import { Icon } from './Icon';

type Action = (cmd: string, args?: Record<string, unknown>, propagateError?: boolean) => Promise<any>;

const DOMAIN_OPTIONS: Array<{ id: LibrarySearchDomain; label: string; icon: string }> = [
  { id: 'files', label: 'All Files', icon: 'files' },
  { id: 'content', label: 'Full-Text Content', icon: 'file-text' },
  { id: 'conversations', label: 'Chat Messages & Files', icon: 'comment-discussion' },
  { id: 'notebook', label: 'Mission Notebook & Exports', icon: 'checklist' },
  { id: 'reader', label: 'Study Reader', icon: 'book' },
  { id: 'hosts', label: 'Cloud Hosts', icon: 'server-environment' },
];

const KIND_OPTIONS = [
  { value: 'all', label: 'All files' },
  { value: 'document', label: 'Documents' },
  { value: 'code', label: 'Code' },
  { value: 'image', label: 'Images' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'archive', label: 'Archives' },
  { value: 'other', label: 'Other files' },
];

const TIME_WINDOWS = [
  { value: '0', label: 'Any time' },
  { value: String(24 * 3600 * 1000), label: 'Last 24h' },
  { value: String(7 * 24 * 3600 * 1000), label: 'Last 7d' },
  { value: String(30 * 24 * 3600 * 1000), label: 'Last 30d' },
];

const SIZE_WINDOWS = [
  { value: '0', label: 'Any size' },
  { value: String(100 * 1024), label: '> 100 KB' },
  { value: String(1024 * 1024), label: '> 1 MB' },
  { value: String(10 * 1024 * 1024), label: '> 10 MB' },
];

function highlightMatch(text: string, query: string) {
  const clean = query.trim();
  if (!clean) return text;
  const idx = text.toLowerCase().indexOf(clean.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="library-search-highlight">{text.slice(idx, idx + clean.length)}</mark>
      {text.slice(idx + clean.length)}
    </>
  );
}

export function LibrarySuperSearch({
  store,
  initialQuery = '',
  initialKind = 'all',
  focusSignal = 0,
  act,
  onNavigate,
  onOpenInReader,
  onInspectSearchItem,
  onClearToLibrary,
}: {
  store: Store;
  initialQuery?: string;
  initialKind?: string;
  focusSignal?: number;
  act: Action;
  onNavigate: (section: LibrarySection, extra?: Partial<ViewState>) => void;
  onOpenInReader: (opts: { path?: string; documentId?: string; studySetId?: string; assetId?: string }) => void;
  onInspectSearchItem: (item: LibrarySearchItem) => void;
  onClearToLibrary?: () => void;
}) {
  useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [selectedDomains, setSelectedDomains] = useState<LibrarySearchDomain[]>([]);
  const [kind, setKind] = useState(initialKind);
  const [employeeId, setEmployeeId] = useState('');
  const [hostId, setHostId] = useState('');
  const [minBytes, setMinBytes] = useState('0');
  const [timeWindow, setTimeWindow] = useState('0');
  const [sort, setSort] = useState<'relevance' | 'recent' | 'largest' | 'name'>('relevance');
  const [hosts, setHosts] = useState<CloudHost[]>([]);
  const [result, setResult] = useState<LibrarySearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (initialKind) setKind(initialKind);
  }, [initialKind]);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [focusSignal]);

  useEffect(() => {
    let alive = true;
    void api
      .call<CloudHost[]>('host.list')
      .then((list) => {
        if (alive) setHosts(list ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const ticket = ++seqRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const min = Number(minBytes);
        const win = Number(timeWindow);
        const res = await api.call<LibrarySearchResponse>('library.search', {
          query,
          ...(selectedDomains.length ? { domains: selectedDomains } : {}),
          ...(kind !== 'all' ? { kind } : {}),
          ...(employeeId ? { employeeId } : {}),
          ...(hostId ? { hostId } : {}),
          ...(min > 0 ? { minBytes: min } : {}),
          ...(win > 0 ? { updatedAfter: Date.now() - win } : {}),
          sort,
          limit: 80,
        });
        if (!active || ticket !== seqRef.current) return;
        setResult(res);
      } catch (cause) {
        if (active && ticket === seqRef.current) setError((cause as Error).message);
      } finally {
        if (active && ticket === seqRef.current) setLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, selectedDomains, kind, employeeId, hostId, minBytes, timeWindow, sort]);

  const toggleDomain = (domain: LibrarySearchDomain) => {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((item) => item !== domain) : [...prev, domain],
    );
  };

  const formatDate = (ms?: number) => {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString(interfaceLocale(), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const openPrimaryAction = async (item: LibrarySearchItem) => {
    if (item.domain === 'hosts' && item.hostId) {
      onNavigate('hosts', { libraryHostId: item.hostId });
      return;
    }
    if (item.domain === 'reader') {
      onOpenInReader({
        studySetId: item.studySetId,
        path: item.assetPath,
        documentId: item.documentId,
      });
      return;
    }
    if (item.domain === 'notebook') {
      if (item.pageId) {
        try {
          sessionStorage.setItem('aexus.missionTargetPageId', item.pageId);
        } catch {
          /* Ignore storage errors. */
        }
        await api
          .call('notebook.call', { method: 'page.open', params: { pageId: item.pageId } })
          .catch(() => {});
      }
      await act('view.select', { id: 'plan' });
      return;
    }
    if (item.domain === 'conversations' && item.conversation) {
      if (item.conversation.startsWith('employee:')) {
        void act('view.open', { kind: 'messages', employee: item.conversation.slice(9) });
      } else if (item.conversation.startsWith('group:')) {
        void act('view.open', { kind: 'messages', chatId: item.conversation.slice(6) });
      }
      return;
    }
    if (item.assetId && item.assetPath) {
      onInspectSearchItem(item);
      return;
    }
    if (item.canOpenInReader && item.assetPath) {
      onOpenInReader({ path: item.assetPath });
    }
  };

  return (
    <div className="library-scroll-page library-search-page">
      <header className="library-search-hero">
        <span className="library-eyebrow">{uiText('Super Search')}</span>
        <h1>{uiText('Super Search')}</h1>
        <div className="library-search-bar">
          <Icon name={loading ? 'loading' : 'search'} />
          <input
            ref={inputRef}
            type="search"
            aria-label={uiText('Super Search')}
            placeholder={uiText(
              'Search everything across filenames, file contents, chats, notebook, study reader and cloud hosts…',
            )}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="library-icon-btn"
              aria-label={uiText('Clear search')}
              onClick={() => setQuery('')}
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <div className="library-domain-filter-pills" role="group" aria-label={uiText('Storage domains')}>
          <button
            type="button"
            aria-pressed={selectedDomains.length === 0}
            onClick={() => setSelectedDomains([])}
          >
            <span>{uiText('All results')}</span>
            {result && <b>{result.total}</b>}
          </button>
          {DOMAIN_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={selectedDomains.includes(opt.id)}
              onClick={() => toggleDomain(opt.id)}
            >
              <Icon name={opt.icon} />
              <span>{uiText(opt.label)}</span>
              {result && <b>{result.countsByDomain[opt.id] ?? 0}</b>}
            </button>
          ))}
        </div>

        <div className="library-search-facets">
          <AppSelect aria-label={uiText('File type')} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {uiText(opt.label)}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            aria-label={uiText('Filter by employee')}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">{uiText('All employees')}</option>
            {store.sessions
              .filter((c) => !c.deleting)
              .map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.title}
                </option>
              ))}
          </AppSelect>

          <AppSelect
            aria-label={uiText('Filter by host')}
            value={hostId}
            onChange={(e) => setHostId(e.target.value)}
          >
            <option value="">{uiText('All hosts')}</option>
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            aria-label={uiText('Any size')}
            value={minBytes}
            onChange={(e) => setMinBytes(e.target.value)}
          >
            {SIZE_WINDOWS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {uiText(opt.label)}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            aria-label={uiText('Any time')}
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value)}
          >
            {TIME_WINDOWS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {uiText(opt.label)}
              </option>
            ))}
          </AppSelect>

          <AppSelect
            aria-label={uiText('Sort files')}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="relevance">{uiText('Relevance')}</option>
            <option value="recent">{uiText('Newest')}</option>
            <option value="largest">{uiText('Largest first')}</option>
            <option value="name">{uiText('Name')}</option>
          </AppSelect>
        </div>
      </header>

      {error && (
        <div className="library-error-banner" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
        </div>
      )}

      <section className="library-search-results" aria-label={uiText('Search results')}>
        {result && !result.items.length && !loading ? (
          <div className="library-empty-state">
            <Icon name="search" />
            <h3>{uiText('No results found')}</h3>
            <p>{uiText('Try another keyword, broaden the domain scope, or clear filters.')}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery('');
                setSelectedDomains([]);
                setKind('all');
                setEmployeeId('');
                setHostId('');
                setMinBytes('0');
                setTimeWindow('0');
              }}
            >
              {uiText('Clear filters')}
            </button>
          </div>
        ) : (
          <div className="library-search-list">
            {(result?.items ?? []).map((item) => {
              const domainInfo = DOMAIN_OPTIONS.find((d) => d.id === item.domain);
              return (
                <article key={item.id} className="library-search-item" data-domain={item.domain}>
                  <div className="library-search-item-icon">
                    <Icon name={domainInfo?.icon ?? 'file'} />
                  </div>
                  <div className="library-search-item-body">
                    <div className="library-search-item-top">
                      <button
                        type="button"
                        className="library-search-item-title"
                        onClick={() => void openPrimaryAction(item)}
                      >
                        {highlightMatch(item.title, query)}
                      </button>
                      <span className="library-domain-tag">{uiText(domainInfo?.label ?? item.domain)}</span>
                    </div>
                    <p className="library-search-item-sub">{highlightMatch(item.subtitle, query)}</p>
                    {item.snippet && (
                      <blockquote className="library-search-snippet">
                        {item.line ? <code>L{item.line}</code> : null}
                        <span>{highlightMatch(item.snippet, query)}</span>
                      </blockquote>
                    )}
                    <div className="library-search-item-meta">
                      {item.bytes !== undefined && <span>{assetSize(item.bytes)}</span>}
                      {item.modifiedAt ? <span>{formatDate(item.modifiedAt)}</span> : null}
                      {item.storage && <span>{item.storage}</span>}
                    </div>
                  </div>
                  <div className="library-search-item-actions">
                    {item.canOpenInReader && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          onOpenInReader({
                            assetId:
                              item.assetId && item.assetPath
                                ? `${item.assetId}|${encodeURIComponent(item.assetPath)}`
                                : undefined,
                            path: item.assetId === 'reader:library' ? item.assetPath : undefined,
                            documentId: item.documentId,
                            studySetId: item.studySetId,
                          })
                        }
                      >
                        <Icon name="book" />
                        <span>{uiText('Study Reader')}</span>
                      </button>
                    )}
                    {item.domain === 'hosts' && item.hostId ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => onNavigate('hosts', { libraryHostId: item.hostId })}
                      >
                        {uiText('Cloud Hosts')}
                      </button>
                    ) : item.domain === 'notebook' ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void openPrimaryAction(item)}
                      >
                        Mission
                      </button>
                    ) : item.domain === 'conversations' && item.conversation ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void openPrimaryAction(item)}
                      >
                        Message
                      </button>
                    ) : item.assetId && item.assetPath ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onInspectSearchItem(item)}
                      >
                        {uiText('Preview')}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
