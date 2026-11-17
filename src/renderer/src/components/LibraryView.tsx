import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetSize, assetTitle } from '../../../shared/asset-presentation';
import type { AssetNode, AssetTree, AssetView } from '../../../shared/asset-schema';
import type {
  LibraryDomainId,
  LibraryOverview as OverviewData,
  LibrarySection,
} from '../../../shared/library-api';
import type { CloudHost } from '../../../shared/remote';
import type { Store } from '../../../shared/types';
import type { ViewState } from '../../../shared/view';
import { api } from '../api';
import { revealFile } from '../file-actions';
import { translate as uiText, useI18n } from '../i18n';
import { AssetGlyph } from './AssetIdentity';
import { BackButton } from './BackButton';
import { FileWorkspace } from './FileWorkspace';
import { Icon } from './Icon';
import { LibraryAccessDialog } from './LibraryAccessDialog';
import { LibraryCloudHosts } from './LibraryCloudHosts';
import { LibraryFilesExplorer, canOpenNodeInReader } from './LibraryFilesExplorer';
import { LibraryOverview } from './LibraryOverview';
import {
  LibraryStudyReader,
  type ReaderCommand,
  type ReaderFrameState,
} from './LibraryStudyReader';
import { LibrarySuperSearch } from './LibrarySuperSearch';

type Action = (cmd: string, args?: Record<string, unknown>, propagateError?: boolean) => Promise<any>;

type InspectTarget = {
  title: string;
  assetRoot: string;
  initialFolder: string;
  initialFile: string;
  initialFileName: string;
  readOnly?: boolean;
};

type StudySetSummary = {
  id: string;
  title: string;
  documentCount: number;
  cardCount: number;
  deletedAt?: string | null;
};

type ReaderTreeNode = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children?: ReaderTreeNode[];
};

const DOMAIN_COLORS: Record<LibraryDomainId, string> = {
  employees: '#4c7ef3',
  privateChats: '#8b5cf6',
  groupsAndChannels: '#0ea5e9',
  reader: '#10b981',
  notebook: '#f59e0b',
  shared: '#ec4899',
  hosts: '#64748b',
};

const DOMAIN_ROOT_MAP: Partial<Record<LibraryDomainId, string>> = {
  employees: 'agents',
  privateChats: 'messages',
  groupsAndChannels: 'messages',
  notebook: 'plan',
  shared: 'shared',
};

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  }
  return btoa(parts.join(''));
}

function readSavedSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem('aexus.librarySidebarWidth'));
    if (Number.isFinite(raw) && raw >= 210 && raw <= 380) return raw;
  } catch {
    /* Ignore localStorage failures in restricted frames. */
  }
  return 258;
}

export function LibraryView({
  store,
  view,
  act,
}: {
  store: Store;
  view: ViewState;
  act: Action;
}) {
  useI18n();
  const activeSection: LibrarySection =
    view.librarySection ??
    (view.readerDocumentId || view.readerWorkspace ? 'reader' : 'files');

  // Keep MarginReader warmed up so switching between the unified shelf and any book/study set is instantaneous.
  const [readerMounted, setReaderMounted] = useState(activeSection === 'reader');
  useEffect(() => {
    if (activeSection === 'reader') {
      setReaderMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setReaderMounted(true), 120);
    return () => window.clearTimeout(timer);
  }, [activeSection]);

  const [sidebarWidth, setSidebarWidth] = useState(readSavedSidebarWidth);
  const [sectionOpen, setSectionOpen] = useState({
    studies: true,
    reader: true,
    spaces: true,
    hosts: true,
  });

  // Quick search & overview bar state
  const [quickQuery, setQuickQuery] = useState(view.libraryQuery ?? '');
  const [searchSeed, setSearchSeed] = useState<{ query: string; kind: string; seq: number }>({
    query: view.libraryQuery ?? '',
    kind: 'all',
    seq: 0,
  });
  const quickSearchRef = useRef<HTMLInputElement>(null);
  const beforeSearchSection = useRef<LibrarySection>('files');

  // Overview summary strip data
  const [overview, setOverview] = useState<OverviewData | null>(null);

  // MarginReader state & command bridge
  const [studySets, setStudySets] = useState<StudySetSummary[]>([]);
  const [readerTree, setReaderTree] = useState<ReaderTreeNode[]>([]);
  const [readerExpanded, setReaderExpanded] = useState<Set<string>>(() => new Set());
  const [readerState, setReaderState] = useState<ReaderFrameState>({
    folder: '.',
    document: null,
    studySetId: null,
    homeSection: 'library',
  });
  const [readerCommand, setReaderCommand] = useState<ReaderCommand | null>(null);
  const [importingToReader, setImportingToReader] = useState(false);
  const readerImportInputRef = useRef<HTMLInputElement>(null);

  // Software spaces tree state
  const [assetsTree, setAssetsTree] = useState<AssetTree | null>(null);
  const [assetBranches, setAssetBranches] = useState<Record<string, AssetNode[]>>({});
  const [spaceExpanded, setSpaceExpanded] = useState<Set<string>>(() => new Set(['agents']));
  const [activeSpaceNodeId, setActiveSpaceNodeId] = useState<string>('root');
  const [filesScope, setFilesScope] = useState<AssetView | ''>('');

  // Cloud hosts tree state
  const [hosts, setHosts] = useState<CloudHost[]>([]);
  const [hostCreateSignal, setHostCreateSignal] = useState(0);
  const [checkingAllHosts, setCheckingAllHosts] = useState(false);

  // Access modals, file preview, banners
  const [accessModal, setAccessModal] = useState<'reader' | 'host' | null>(null);
  const [inspectFile, setInspectFile] = useState<InspectTarget | null>(null);
  const [readerError, setReaderError] = useState('');

  const navigate = useCallback(
    (section: LibrarySection, extra: Partial<ViewState> = {}) => {
      setReaderError('');
      void act('view.open', { kind: 'library', librarySection: section, ...extra });
    },
    [act],
  );

  const sendReaderCommand = useCallback(
    (command: string, payload?: Record<string, unknown>) => {
      setReaderMounted(true);
      setReaderCommand({ seq: Date.now() + Math.random(), command, payload });
      if (activeSection !== 'reader' || view.readerWorkspace) {
        void act('view.open', { kind: 'library', librarySection: 'reader' });
      }
    },
    [act, activeSection, view.readerWorkspace],
  );

  const refreshOverview = useCallback(async () => {
    try {
      const next = await api.call<OverviewData>('library.overview');
      setOverview(next);
    } catch {
      /* Overview badge stays optional if indexing is in progress. */
    }
  }, []);

  const refreshReaderSidebar = useCallback(async () => {
    try {
      const [studiesRes, treeRes] = await Promise.all([
        api.call<{ sets?: StudySetSummary[] }>('reader.call', { method: 'study.list', params: {} }),
        api.call<{ entries?: ReaderTreeNode[] }>('reader.call', {
          method: 'fs.tree',
          params: { depth: 5 },
        }),
      ]);
      const activeSets = (studiesRes?.sets ?? []).filter((s) => !s.deletedAt);
      setStudySets(activeSets);
      setReaderTree(Array.isArray(treeRes?.entries) ? treeRes.entries : []);
    } catch {
      /* Study sidebar will populate once reader runtime initializes. */
    }
  }, []);

  const refreshSpacesSidebar = useCallback(async () => {
    try {
      const next = await api.call<AssetTree>('assets.tree', {});
      setAssetsTree(next);
    } catch {
      /* Spaces tree retries on explicit refresh or event updates. */
    }
  }, []);

  const refreshHostsSidebar = useCallback(async () => {
    try {
      const list = await api.call<CloudHost[]>('host.list');
      setHosts(list ?? []);
    } catch {
      /* Host list stays passive without probing SSH. */
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      refreshOverview(),
      refreshReaderSidebar(),
      refreshSpacesSidebar(),
      refreshHostsSidebar(),
    ]);
  }, [refreshOverview, refreshReaderSidebar, refreshSpacesSidebar, refreshHostsSidebar]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.onEvent((event) => {
      if (
        ['store:changed', 'chat:changed', 'channel:changed', 'hosts:changed', 'host:health', 'access:changed', 'reader:changed'].includes(
          event.channel,
        )
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void refreshOverview();
          if (['hosts:changed', 'host:health'].includes(event.channel)) {
            void refreshHostsSidebar();
          }
          if (['store:changed', 'chat:changed', 'channel:changed'].includes(event.channel)) {
            void refreshSpacesSidebar();
          }
          if (event.channel === 'reader:changed') {
            void refreshReaderSidebar();
          }
        }, 250);
      }
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [refreshOverview, refreshHostsSidebar, refreshSpacesSidebar]);

  const loadSpaceBranch = useCallback(async (nodeId: string) => {
    try {
      const res = await api.call<{ entries: AssetNode[] }>('assets.children', {
        id: nodeId,
        hidden: false,
        offset: 0,
        limit: 120,
      });
      setAssetBranches((prev) => ({ ...prev, [nodeId]: res.entries ?? [] }));
    } catch {
      /* Branch errors are handled when opening in stage. */
    }
  }, []);

  useEffect(() => {
    if (!assetsTree) return;
    const visit = (node: AssetNode) => {
      if (!spaceExpanded.has(node.id)) return;
      if (node.location && !assetBranches[node.id]) {
        void loadSpaceBranch(node.id);
      }
      for (const child of node.location ? assetBranches[node.id] ?? [] : node.children ?? []) {
        if (child.directory) visit(child);
      }
    };
    visit(assetsTree);
  }, [assetsTree, spaceExpanded, assetBranches, loadSpaceBranch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (activeSection !== 'search') {
          beforeSearchSection.current = activeSection;
        }
        setSearchSeed((prev) => ({ query: quickQuery, kind: prev.kind, seq: prev.seq + 1 }));
        navigate('search');
        requestAnimationFrame(() => quickSearchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSection, navigate, quickQuery]);

  const openInReader = useCallback(
    async (opts: {
      path?: string;
      documentId?: string;
      studySetId?: string;
      assetId?: string;
      inPlace?: boolean;
    }) => {
      setReaderError('');
      try {
        let physicalPath = opts.path;
        if (!physicalPath && !opts.studySetId && !opts.documentId && opts.assetId) {
          const info = await api.call<{ physicalPath?: string }>('assets.info', { id: opts.assetId });
          physicalPath = info.physicalPath;
        }
        const isInsideReaderRoot = Boolean(opts.assetId?.startsWith('reader:library'));
        const shouldImport = Boolean(physicalPath && !opts.inPlace && !isInsideReaderRoot);
        const opened = await api.call<{ workspace?: string; document?: { id: string; path: string } }>(
          'reader.open',
          {
            ...(physicalPath ? { path: physicalPath, ...(shouldImport ? { importToLibrary: true } : {}) } : {}),
            ...(opts.documentId ? { documentId: opts.documentId } : {}),
            ...(opts.studySetId ? { studySetId: opts.studySetId } : {}),
          },
        );
        const isDefaultWorkspace = !opts.inPlace || !physicalPath || isInsideReaderRoot;
        setReaderMounted(true);
        await act('view.open', {
          kind: 'library',
          librarySection: 'reader',
          ...(!isDefaultWorkspace && opened?.workspace ? { readerWorkspace: opened.workspace } : {}),
          ...(opened?.document?.id ? { readerDocumentId: opened.document.id } : {}),
        });
        if (isDefaultWorkspace) {
          if (opts.studySetId) {
            setReaderCommand({ seq: Date.now(), command: 'open-study', payload: { setId: opts.studySetId } });
          } else if (opened?.document?.path) {
            setReaderCommand({
              seq: Date.now(),
              command: 'open-document',
              payload: { path: opened.document.path },
            });
          }
        }
        void refreshReaderSidebar();
      } catch (cause) {
        setReaderError((cause as Error).message);
      }
    },
    [act, refreshReaderSidebar],
  );

  const importFilesToStudyLibrary = async (files: File[]) => {
    if (!files.length || importingToReader) return;
    setImportingToReader(true);
    setReaderError('');
    try {
      const status = await api.call<{ root: string }>('reader.status');
      for (const file of files) {
        const task = await api.call<{ uploadId: string; chunkSize: number }>('reader.call', {
          workspace: status.root,
          method: 'import.begin',
          params: { path: file.name, totalBytes: file.size },
        });
        let committed = false;
        try {
          const step = Math.max(64 * 1024, Math.min(512 * 1024, Number(task.chunkSize) || 512 * 1024));
          for (let offset = 0; offset < file.size; offset += step) {
            const bytes = new Uint8Array(await file.slice(offset, offset + step).arrayBuffer());
            await api.call('reader.call', {
              workspace: status.root,
              method: 'import.chunk',
              params: { uploadId: task.uploadId, offset, contentBase64: bytesToBase64(bytes) },
            });
          }
          await api.call('reader.call', {
            workspace: status.root,
            method: 'import.finish',
            params: { uploadId: task.uploadId, activate: true },
          });
          committed = true;
        } finally {
          if (!committed) {
            await api
              .call('reader.call', {
                workspace: status.root,
                method: 'import.abort',
                params: { uploadId: task.uploadId },
              })
              .catch(() => {});
          }
        }
      }
      await refreshReaderSidebar();
      await refreshOverview();
      sendReaderCommand('open-folder', { folder: '.' });
    } catch (cause) {
      setReaderError((cause as Error).message);
    } finally {
      setImportingToReader(false);
    }
  };

  const spaceNodes = useMemo(
    () => (assetsTree?.children ?? []).filter((n) => n.id !== 'reader' && n.id !== 'hosts'),
    [assetsTree],
  );

  const renderSpaceTree = (nodes: AssetNode[], depth: number): React.ReactNode =>
    nodes
      .filter((n) => n.directory)
      .map((node) => {
        const isExpanded = spaceExpanded.has(node.id);
        const childNodes = node.location ? assetBranches[node.id] ?? [] : node.children ?? [];
        const hasChildren = Boolean(node.location || (node.children && node.children.some((c) => c.directory)));
        const selected = activeSection === 'files' && activeSpaceNodeId === node.id;
        return (
          <div key={node.id} className="library-tree-group">
            <div
              className={`library-nav-row${selected ? ' is-active' : ''}`}
              style={{ paddingLeft: 10 + depth * 12 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="library-nav-disclosure"
                  aria-expanded={isExpanded}
                  aria-label={assetTitle(node)}
                  onClick={() =>
                    setSpaceExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                >
                  <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} />
                </button>
              ) : (
                <span className="library-nav-spacer" />
              )}
              <button
                type="button"
                className="library-nav-btn"
                onClick={() => {
                  setActiveSpaceNodeId(node.id);
                  setFilesScope('');
                  navigate('files');
                }}
              >
                <AssetGlyph node={node} />
                <span className="library-nav-label">
                  {node.owner ? assetTitle(node) : uiText(assetTitle(node))}
                </span>
                {node.fileCount !== undefined && (
                  <small className="library-nav-count">{node.fileCount}</small>
                )}
              </button>
            </div>
            {isExpanded && childNodes.some((c) => c.directory) && renderSpaceTree(childNodes, depth + 1)}
          </div>
        );
      });

  const readerDirs = useMemo(
    () => readerTree.filter((e) => e.kind === 'directory' && !e.name.startsWith('.')),
    [readerTree],
  );

  const renderReaderDirs = (dirs: ReaderTreeNode[], depth: number): React.ReactNode =>
    dirs
      .filter((d) => d.kind === 'directory' && !d.name.startsWith('.'))
      .map((dir) => {
        const subDirs = (dir.children ?? []).filter((c) => c.kind === 'directory' && !c.name.startsWith('.'));
        const isExpanded = readerExpanded.has(dir.path);
        const active =
          activeSection === 'reader' &&
          !view.readerWorkspace &&
          !readerState.studySetId &&
          readerState.homeSection === 'library' &&
          readerState.folder === dir.path;
        return (
          <div key={dir.path} className="library-tree-group">
            <div
              className={`library-nav-row${active ? ' is-active' : ''}`}
              style={{ paddingLeft: 10 + depth * 12 }}
            >
              {subDirs.length > 0 ? (
                <button
                  type="button"
                  className="library-nav-disclosure"
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setReaderExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(dir.path)) next.delete(dir.path);
                      else next.add(dir.path);
                      return next;
                    })
                  }
                >
                  <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} />
                </button>
              ) : (
                <span className="library-nav-spacer" />
              )}
              <button
                type="button"
                className="library-nav-btn"
                onClick={() => sendReaderCommand('open-folder', { folder: dir.path })}
              >
                <Icon name="folder" />
                <span className="library-nav-label">{dir.name}</span>
              </button>
            </div>
            {isExpanded && subDirs.length > 0 && renderReaderDirs(subDirs, depth + 1)}
          </div>
        );
      });

  const backLabel =
    view.returnTo?.kind === 'plan'
      ? 'Back to Mission'
      : view.returnTo?.kind === 'messages'
        ? 'Back to conversation'
        : 'Back to Library';

  const totalOverviewBytes = Math.max(1, overview?.totalBytes ?? 0);

  return (
    <section
      className="library-view library-unified"
      aria-label={uiText('Library')}
      style={{ '--library-sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <aside className="library-explorer-sidebar" aria-label={uiText('Library')}>
        <div className="library-sidebar-head">
          {view.returnTo && (
            <div className="library-sidebar-back">
              <BackButton
                label={backLabel}
                ariaLabel={backLabel}
                onClick={() => void act('view.close')}
              />
            </div>
          )}

          <label className="library-sidebar-search">
            <Icon name="search" />
            <input
              ref={quickSearchRef}
              type="search"
              data-library-quick-search="true"
              aria-label={uiText('Search library (⌘K)')}
              placeholder={uiText('Search files, chats, notes…')}
              value={quickQuery}
              onChange={(e) => {
                const next = e.target.value;
                setQuickQuery(next);
                setSearchSeed((prev) => ({ ...prev, query: next, seq: prev.seq + 1 }));
                if (next.trim()) {
                  if (activeSection !== 'search') {
                    beforeSearchSection.current = activeSection;
                    navigate('search');
                  }
                } else if (activeSection === 'search') {
                  navigate(beforeSearchSection.current || 'files');
                }
              }}
            />
            <kbd>⌘K</kbd>
          </label>

          <button
            type="button"
            className={`library-overview-pill${activeSection === 'overview' ? ' is-active' : ''}`}
            data-library-overview-trigger="true"
            onClick={() => navigate('overview')}
          >
            <div className="library-overview-pill-top">
              <span>
                <Icon name="pie-chart" />
                <strong>{overview ? assetSize(overview.totalBytes) : '—'}</strong>
              </span>
              <small>
                {overview
                  ? overview.totalFiles === 1
                    ? uiText('1 item · 7 domains')
                    : uiText('{0} items · 7 domains', [overview.totalFiles])
                  : uiText('Storage Overview')}
              </small>
            </div>
            <div className="library-overview-mini-bar" aria-hidden="true">
              {(overview?.domains ?? []).map((d) =>
                d.bytes > 0 ? (
                  <span
                    key={d.id}
                    style={{
                      width: `${Math.max(3, (d.bytes / totalOverviewBytes) * 100)}%`,
                      background: DOMAIN_COLORS[d.id],
                    }}
                  />
                ) : null,
              )}
            </div>
          </button>
        </div>

        <div className="library-explorer-tree">
          <div className="library-tree-section library-shelf-home-section">
            <button
              type="button"
              data-library-shelf-home="true"
              className={`library-nav-row library-nav-leaf library-shelf-home-btn${
                activeSection === 'files' && activeSpaceNodeId === 'root' && !filesScope
                  ? ' is-active'
                  : ''
              }`}
              onClick={() => {
                setActiveSpaceNodeId('root');
                setFilesScope('');
                navigate('files');
              }}
            >
              <Icon name="folder-library" />
              <span className="library-nav-label">{uiText('All Folders')}</span>
            </button>
          </div>

          {/* Section 1: Study Sets & Infinite Mindmap */}
          <div className="library-tree-section">
            <div className="library-section-heading">
              <button
                type="button"
                className="library-section-toggle"
                onClick={() => setSectionOpen((s) => ({ ...s, studies: !s.studies }))}
              >
                <Icon name={sectionOpen.studies ? 'chevron-down' : 'chevron-right'} />
                <span>{uiText('Study Sets')}</span>
                <small>{studySets.length}</small>
              </button>
              <div className="library-section-actions">
                <button
                  type="button"
                  data-library-create-study="true"
                  title={uiText('New Study Set')}
                  aria-label={uiText('New Study Set')}
                  onClick={() => sendReaderCommand('create-study')}
                >
                  <Icon name="add" />
                </button>
                <button
                  type="button"
                  title={uiText('Deleted Study Sets')}
                  aria-label={uiText('Deleted Study Sets')}
                  onClick={() => sendReaderCommand('deleted-studies')}
                >
                  <Icon name="trash" />
                </button>
                <button
                  type="button"
                  data-library-reader-access="true"
                  title={uiText('Authorized people')}
                  aria-label={`${uiText('Study Sets')} · ${uiText('Authorized people')}`}
                  onClick={() => setAccessModal('reader')}
                >
                  <Icon name="person" />
                </button>
              </div>
            </div>

            {sectionOpen.studies && (
              <div className="library-section-items">
                <button
                  type="button"
                  className={`library-nav-row library-nav-leaf${
                    activeSection === 'reader' &&
                    !view.readerWorkspace &&
                    !readerState.studySetId &&
                    readerState.homeSection === 'studies'
                      ? ' is-active'
                      : ''
                  }`}
                  onClick={() => sendReaderCommand('open-study-collection')}
                >
                  <Icon name="layers" />
                  <span className="library-nav-label">{uiText('All Study Sets')}</span>
                </button>
                {studySets.map((set) => {
                  const active =
                    activeSection === 'reader' &&
                    !view.readerWorkspace &&
                    readerState.studySetId === set.id;
                  return (
                    <button
                      key={set.id}
                      type="button"
                      data-study-set-nav={set.id}
                      className={`library-nav-row library-nav-leaf${active ? ' is-active' : ''}`}
                      onClick={() => sendReaderCommand('open-study', { setId: set.id })}
                    >
                      <Icon name="symbol-interface" />
                      <span className="library-nav-label">{set.title}</span>
                      <small className="library-nav-count">{set.cardCount}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Study Library Bookshelf */}
          <div className="library-tree-section">
            <div className="library-section-heading">
              <button
                type="button"
                className="library-section-toggle"
                onClick={() => setSectionOpen((s) => ({ ...s, reader: !s.reader }))}
              >
                <Icon name={sectionOpen.reader ? 'chevron-down' : 'chevron-right'} />
                <span>{uiText('Study Library')}</span>
              </button>
              <div className="library-section-actions">
                <button
                  type="button"
                  title={uiText('Save webpage')}
                  aria-label={uiText('Save webpage')}
                  onClick={() => sendReaderCommand('import-url')}
                >
                  <Icon name="globe" />
                </button>
                <input
                  ref={readerImportInputRef}
                  type="file"
                  multiple
                  hidden
                  accept=".pdf,.epub,.mobi,.azw3,.docx,.doc,.md,.markdown,.txt,.html,.htm,.png,.jpg,.jpeg,.webp,.mp3,.mp4,.m4a,.wav"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    void importFilesToStudyLibrary(files);
                  }}
                />
                <button
                  type="button"
                  data-library-import-doc="true"
                  disabled={importingToReader}
                  title={uiText('Import Document')}
                  aria-label={uiText('Import Document')}
                  onClick={() => readerImportInputRef.current?.click()}
                >
                  <Icon name={importingToReader ? 'loading' : 'cloud-upload'} />
                </button>
                {api.mode !== 'web' && (
                  <button
                    type="button"
                    title={uiText('Open Study Folder')}
                    aria-label={uiText('Open Study Folder')}
                    onClick={() =>
                      void api
                        .call<{ root: string }>('reader.status')
                        .then((st) => revealFile({ local: true, path: st.root }))
                        .catch((e) => setReaderError((e as Error).message))
                    }
                  >
                    <Icon name="folder-opened" />
                  </button>
                )}
              </div>
            </div>

            {sectionOpen.reader && (
              <div className="library-section-items">
                <button
                  type="button"
                  data-study-library-root="true"
                  className={`library-nav-row library-nav-leaf${
                    activeSection === 'reader' &&
                    !view.readerWorkspace &&
                    !readerState.studySetId &&
                    readerState.homeSection !== 'studies' &&
                    readerState.folder === '.'
                      ? ' is-active'
                      : ''
                  }`}
                  onClick={() => sendReaderCommand('open-folder', { folder: '.' })}
                >
                  <Icon name="book" />
                  <span className="library-nav-label">{uiText('My Study Library')}</span>
                </button>
                {renderReaderDirs(readerDirs, 1)}
                <button
                  type="button"
                  className="library-nav-row library-nav-leaf"
                  onClick={() => sendReaderCommand('open-trash')}
                >
                  <Icon name="trash" />
                  <span className="library-nav-label">{uiText('Reader Trash')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Section 3: Software Spaces (Agent Workspaces, Private Mac Storage, Groups, Channels, Mission, Shared) */}
          <div className="library-tree-section">
            <div className="library-section-heading">
              <button
                type="button"
                className="library-section-toggle"
                onClick={() => setSectionOpen((s) => ({ ...s, spaces: !s.spaces }))}
              >
                <Icon name={sectionOpen.spaces ? 'chevron-down' : 'chevron-right'} />
                <span>{uiText('Software Spaces')}</span>
              </button>
              <div className="library-section-actions">
                <button
                  type="button"
                  title={uiText('Refresh spaces')}
                  aria-label={uiText('Refresh spaces')}
                  onClick={() => void refreshSpacesSidebar()}
                >
                  <Icon name="refresh" />
                </button>
              </div>
            </div>

            {sectionOpen.spaces && (
              <div className="library-section-items" role="tree" aria-label={uiText('Software Spaces')}>
                {renderSpaceTree(spaceNodes, 0)}
              </div>
            )}
          </div>

          {/* Section 4: Cloud Hosts (Direct in-sidebar host nodes) */}
          <div className="library-tree-section">
            <div className="library-section-heading">
              <button
                type="button"
                className="library-section-toggle"
                onClick={() => setSectionOpen((s) => ({ ...s, hosts: !s.hosts }))}
              >
                <Icon name={sectionOpen.hosts ? 'chevron-down' : 'chevron-right'} />
                <span>{uiText('Cloud Hosts')}</span>
                <small>{hosts.length}</small>
              </button>
              <div className="library-section-actions">
                <button
                  type="button"
                  data-library-add-host="true"
                  title={uiText('Add Host')}
                  aria-label={uiText('Add Host')}
                  onClick={() => {
                    setHostCreateSignal((s) => s + 1);
                    navigate('hosts');
                  }}
                >
                  <Icon name="add" />
                </button>
                <button
                  type="button"
                  title={uiText('Check All')}
                  aria-label={uiText('Check All')}
                  disabled={checkingAllHosts || !hosts.length}
                  onClick={() => {
                    if (checkingAllHosts || !hosts.length) return;
                    setCheckingAllHosts(true);
                    void Promise.all(
                      hosts.map((h) => api.call('host.check', { id: h.id }).catch(() => {})),
                    )
                      .then(() => refreshHostsSidebar())
                      .finally(() => setCheckingAllHosts(false));
                  }}
                >
                  <Icon name={checkingAllHosts ? 'loading' : 'refresh'} />
                </button>
                <button
                  type="button"
                  data-library-host-access="true"
                  title={uiText('Authorized people')}
                  aria-label={`${uiText('Cloud Hosts')} · ${uiText('Authorized people')}`}
                  onClick={() => setAccessModal('host')}
                >
                  <Icon name="person" />
                </button>
              </div>
            </div>

            {sectionOpen.hosts && (
              <div className="library-section-items">
                {hosts.map((host) => {
                  const active = activeSection === 'hosts' && view.libraryHostId === host.id;
                  const lampClass =
                    host.status?.connected === true
                      ? 'is-online'
                      : host.status?.connected === false
                        ? 'is-failed'
                        : 'is-unknown';
                  return (
                    <button
                      key={host.id}
                      type="button"
                      data-library-host-nav={host.id}
                      className={`library-nav-row library-nav-leaf${active ? ' is-active' : ''}`}
                      onClick={() => {
                        setHostCreateSignal(0);
                        navigate('hosts', { libraryHostId: host.id });
                      }}
                    >
                      <span className={`library-health-lamp ${lampClass}`} />
                      <span className="library-nav-label">{host.name}</span>
                      <small className="library-nav-badge">{host.os}</small>
                    </button>
                  );
                })}
                {hosts.length === 0 && (
                  <button
                    type="button"
                    className="library-nav-row library-nav-leaf library-nav-empty"
                    onClick={() => {
                      setHostCreateSignal((s) => s + 1);
                      navigate('hosts');
                    }}
                  >
                    <Icon name="server-environment" />
                    <span className="library-nav-label">{uiText('Add Host')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className="library-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = sidebarWidth;
            let finalW = startW;
            const onMove = (ev: PointerEvent) => {
              finalW = Math.max(210, Math.min(380, startW + ev.clientX - startX));
              setSidebarWidth(finalW);
            };
            const onUp = () => {
              document.removeEventListener('pointermove', onMove);
              document.removeEventListener('pointerup', onUp);
              try {
                localStorage.setItem('aexus.librarySidebarWidth', String(finalW));
              } catch {
                /* Ignore storage error. */
              }
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
          }}
        />
      </aside>

      <div className="library-content">
        {readerError && (
          <div className="library-error-banner" role="alert">
            <Icon name="warning" />
            <span>{readerError}</span>
            <button type="button" onClick={() => setReaderError('')}>
              <Icon name="close" />
            </button>
          </div>
        )}

        {activeSection === 'overview' && (
          <LibraryOverview
            act={act}
            onNavigate={navigate}
            onOpenFilesScope={(scope, rootId) => {
              const targetRoot =
                rootId || (scope === 'Agents' ? 'agents' : scope === 'Messages' ? 'messages' : scope === 'Plan' ? 'plan' : 'root');
              setFilesScope(scope);
              setActiveSpaceNodeId(targetRoot);
              navigate('files');
            }}
            onSearchWith={(query = '', kind = 'all') => {
              setQuickQuery(query);
              setSearchSeed((prev) => ({ query, kind, seq: prev.seq + 1 }));
              navigate('search');
            }}
            onOpenInReader={(opts) => void openInReader(opts)}
            onInspectFile={(file) => {
              const domainRoot = DOMAIN_ROOT_MAP[file.domain];
              if (domainRoot) setActiveSpaceNodeId(domainRoot);
              setInspectFile({
                title: file.name,
                assetRoot: file.assetId,
                initialFolder: file.path.split('/').slice(0, -1).join('/'),
                initialFile: file.path,
                initialFileName: file.name,
                readOnly: file.assetId.startsWith('published:'),
              });
            }}
          />
        )}

        {activeSection === 'files' && (
          <LibraryFilesExplorer
            initialViewScope={filesScope}
            controlledRootId={activeSpaceNodeId}
            hideInternalTree
            studySets={studySets}
            cloudHosts={hosts}
            onRootChange={(nextRoot) => setActiveSpaceNodeId(nextRoot)}
            onOpenInReader={(opts) => void openInReader(opts)}
            onOpenStudySet={(setId) => sendReaderCommand('open-study', { setId })}
            onOpenStudyLibrary={() => sendReaderCommand('open-folder', { folder: '.' })}
            onOpenHost={(hostId) => {
              setHostCreateSignal(0);
              navigate('hosts', { libraryHostId: hostId });
            }}
            onCreateStudySet={() => sendReaderCommand('create-study')}
            onCreateHost={() => {
              setHostCreateSignal((s) => s + 1);
              navigate('hosts');
            }}
          />
        )}

        {activeSection === 'search' && (
          <LibrarySuperSearch
            store={store}
            initialQuery={searchSeed.query}
            initialKind={searchSeed.kind}
            focusSignal={searchSeed.seq}
            act={act}
            onNavigate={navigate}
            onOpenInReader={(opts) => void openInReader(opts)}
            onInspectSearchItem={(item) => {
              if (!item.assetId || !item.assetPath) return;
              setInspectFile({
                title: item.title,
                assetRoot: item.assetId,
                initialFolder: item.assetPath.split('/').slice(0, -1).join('/'),
                initialFile: item.assetPath,
                initialFileName: item.title,
                readOnly: item.assetId.startsWith('published:'),
              });
            }}
            onClearToLibrary={() => {
              setQuickQuery('');
              navigate(beforeSearchSection.current || 'files');
            }}
          />
        )}

        {readerMounted && (
          <div className="library-stage-pane" hidden={activeSection !== 'reader'}>
            <LibraryStudyReader
              store={store}
              view={view}
              act={act}
              embedded
              readerCommand={readerCommand}
              onReaderState={setReaderState}
              onContentChanged={() => {
                void refreshReaderSidebar();
                void refreshOverview();
              }}
              onBackToShelf={() => {
                setActiveSpaceNodeId(activeSpaceNodeId || 'root');
                navigate('files');
              }}
              onBackFromExternal={() => {
                setActiveSpaceNodeId(activeSpaceNodeId || 'root');
                navigate('files');
              }}
              onOpenExternalAccess={() => setAccessModal('reader')}
            />
          </div>
        )}

        {activeSection === 'hosts' && (
          <LibraryCloudHosts
            view={view}
            embeddedHostMode
            embeddedHostId={view.libraryHostId ?? null}
            createSignal={hostCreateSignal}
            onHostsChanged={setHosts}
            onSelectHost={(hostId) => navigate('hosts', { libraryHostId: hostId })}
            onBackToShelf={() => {
              setActiveSpaceNodeId('root');
              navigate('files');
            }}
          />
        )}
      </div>

      {accessModal && (
        <LibraryAccessDialog
          target={accessModal}
          onClose={() => setAccessModal(null)}
          onSaved={() => {
            void refreshReaderSidebar();
            void refreshOverview();
          }}
        />
      )}

      {inspectFile &&
        createPortal(
          <div
            className="asset-workspace-overlay"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented) {
                e.preventDefault();
                e.stopPropagation();
                setInspectFile(null);
              }
            }}
          >
            <div className="panel-backdrop" onClick={() => setInspectFile(null)} />
            <section
              className="team-workspace"
              role="dialog"
              aria-modal="true"
              aria-label={uiText('Preview or edit file')}
            >
              <header className="workspace-header">
                <button
                  type="button"
                  aria-label={uiText('Back to files')}
                  onClick={() => setInspectFile(null)}
                >
                  <Icon name="arrow-left" />
                </button>
                <div>
                  <strong>{inspectFile.title}</strong>
                  <small>{inspectFile.assetRoot}</small>
                </div>
                {canOpenNodeInReader({
                  id: inspectFile.assetRoot,
                  name: inspectFile.initialFileName,
                  directory: false,
                  locked: false,
                }) && (
                  <button
                    type="button"
                    className="btn primary"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                      const target = inspectFile;
                      setInspectFile(null);
                      void openInReader({
                        assetId: `${target.assetRoot}|${encodeURIComponent(target.initialFile)}`,
                        inPlace: true,
                      });
                    }}
                  >
                    <Icon name="book" />
                    <span>{uiText('Open in Study Reader')}</span>
                  </button>
                )}
              </header>
              <FileWorkspace
                folderName={inspectFile.assetRoot}
                assetRoot={inspectFile.assetRoot}
                initialFolder={inspectFile.initialFolder}
                initialFile={inspectFile.initialFile}
                initialFileName={inspectFile.initialFileName}
                readOnly={inspectFile.readOnly}
                revealAvailable={api.mode !== 'web'}
              />
            </section>
          </div>,
          document.body,
        )}
    </section>
  );
}
