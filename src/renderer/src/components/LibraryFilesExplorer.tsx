import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { ASSET_KINDS, assetTitle } from '../../../shared/asset-presentation';
import type {
  AssetFacets,
  AssetFilters,
  AssetLocation,
  AssetNode,
  AssetTree,
  AssetView,
} from '../../../shared/asset-schema';
import type { CloudHost } from '../../../shared/remote';
import { api } from '../api';
import { revealFile, downloadFile } from '../file-actions';
import { copyFile, dragFile, dropFiles, hasFileDrop, pasteFile, uploadFiles } from '../file-transfers';
import { translate as uiText, useI18n } from '../i18n';
import { flushPlugins } from '../plugins';
import { AssetActionDialog } from './AssetActionDialog';
import { AssetGallery, clearAssetCovers } from './AssetGallery';
import { AssetGlyph, AssetHostBadge, assetError } from './AssetIdentity';
import { AssetInfoDialog } from './AssetInfo';
import { AppSelect } from './AppSelect';
import { FileWorkspace } from './FileWorkspace';
import { Icon } from './Icon';
import { MessageMenu } from './MessageMenu';

type Children = { entries: AssetNode[]; total: number; nextOffset: number | null };
type TreeRow = { node: AssetNode; depth: number; more?: number };

export type ShelfStudySetItem = {
  id: string;
  title: string;
  cardCount: number;
  documentIds?: string[];
};

export type ShelfCategory =
  | 'all'
  | 'study-sets'
  | 'reader'
  | 'agents'
  | 'messages'
  | 'plan-shared'
  | 'hosts';

const READER_EXT_RE = /\.(pdf|epub|mobi|azw3|docx?|md|markdown|txt|html?|png|jpe?g|webp|mp3|mp4|m4a|wav)$/i;
const KIND_LABELS: Record<string, string> = {
  folder: 'Folders',
  all: 'All files',
  document: 'Documents',
  image: 'Images',
  audio: 'Audio',
  video: 'Video',
  code: 'Code',
  archive: 'Archives',
  other: 'Other files',
};

const SCOPE_OPTIONS: Array<{ value: '' | AssetView; label: string }> = [
  { value: '', label: 'All spaces' },
  { value: 'Agents', label: 'Agents' },
  { value: 'Messages', label: 'Messages' },
  { value: 'Plan', label: 'Plan' },
  { value: 'Reader', label: 'Study Reader' },
  { value: 'Hosts', label: 'Cloud Hosts' },
];

const SHELF_CATEGORIES: Array<{ id: ShelfCategory; label: string; icon: string }> = [
  { id: 'all', label: 'All Folders', icon: 'folder-library' },
  { id: 'study-sets', label: 'Study Sets', icon: 'layers' },
  { id: 'reader', label: 'Study Library', icon: 'book' },
  { id: 'agents', label: 'Workspaces', icon: 'person' },
  { id: 'messages', label: 'Chats & Channels', icon: 'comment-discussion' },
  { id: 'plan-shared', label: 'Mission & Shared', icon: 'checklist' },
  { id: 'hosts', label: 'Cloud Hosts', icon: 'server-environment' },
];

export function canOpenNodeInReader(node?: AssetNode): boolean {
  if (!node || node.directory) return false;
  return READER_EXT_RE.test(node.name || '');
}

function collectDirectChatNodes(tree?: AssetTree): AssetNode[] {
  if (!tree?.children) return [];
  const messages = tree.children.find((n) => n.id === 'messages');
  const direct = messages?.children?.find((n) => n.id === 'direct');
  return (direct?.children ?? []).map((node) => ({
    ...node,
    kind: 'direct',
  }));
}

export function LibraryFilesExplorer({
  initialViewScope = '',
  controlledRootId,
  hideInternalTree = false,
  studySets = [],
  cloudHosts = [],
  onRootChange,
  onOpenInReader,
  onOpenStudySet,
  onOpenStudyLibrary,
  onOpenHost,
  onCreateStudySet,
  onCreateHost,
}: {
  initialViewScope?: AssetView | '';
  controlledRootId?: string;
  hideInternalTree?: boolean;
  studySets?: ShelfStudySetItem[];
  cloudHosts?: CloudHost[];
  onRootChange?: (rootId: string) => void;
  onOpenInReader: (opts: { path?: string; assetId?: string; inPlace?: boolean }) => void;
  onOpenStudySet?: (setId: string) => void;
  onOpenStudyLibrary?: () => void;
  onOpenHost?: (hostId: string) => void;
  onCreateStudySet?: () => void;
  onCreateHost?: () => void;
}) {
  useI18n();
  const [tree, setTree] = useState<AssetTree>();
  const [facets, setFacets] = useState<AssetFacets>({ employees: [], conversations: [] });
  const [branches, setBranches] = useState<Record<string, Children>>({});
  const [expanded, setExpanded] = useState(
    () => new Set(['root', 'agents', 'messages', 'groups', 'channels', 'reader', 'hosts']),
  );
  const [filters, setFilters] = useState<AssetFilters>(() =>
    initialViewScope ? { view: initialViewScope } : {},
  );
  const [shelfCategory, setShelfCategory] = useState<ShelfCategory>('all');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(false);
  const [filterPopover, setFilterPopover] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<'gallery' | 'workbench'>('gallery');
  const [galleryRoot, setGalleryRoot] = useState(controlledRootId || 'root');
  const [currentFolderNode, setCurrentFolderNode] = useState<AssetNode>();
  const [selected, setSelected] = useState<AssetNode>();
  const [openWorkspace, setOpenWorkspace] = useState<AssetLocation | null>(null);
  const [information, setInformation] = useState<AssetNode>();
  const [action, setAction] = useState<{
    node: AssetNode;
    kind: 'rename' | 'trash' | 'new-file' | 'new-folder';
  }>();
  const [menu, setMenu] = useState<{ node: AssetNode; x: number; y: number }>();
  const [undo, setUndo] = useState<{ asset: string; id: string; name: string }>();
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const branchRequests = useRef(new Map<string, number>());

  useEffect(() => {
    setFilters((prev) => ({ ...prev, view: initialViewScope || undefined }));
    if (initialViewScope === 'Agents') setShelfCategory('agents');
    else if (initialViewScope === 'Messages') setShelfCategory('messages');
    else if (initialViewScope === 'Plan') setShelfCategory('plan-shared');
    else if (initialViewScope === 'Reader') setShelfCategory('reader');
    else if (initialViewScope === 'Hosts') setShelfCategory('hosts');
    else setShelfCategory('all');
  }, [initialViewScope]);

  useEffect(() => {
    if (!controlledRootId) return;
    setGalleryRoot(controlledRootId);
    setViewMode('gallery');
    setOpenWorkspace(null);
    setSelected(undefined);
    if (controlledRootId === 'root') {
      if (!initialViewScope) setShelfCategory('all');
    } else {
      setFilters((prev) => (prev.view ? { ...prev, view: undefined } : prev));
    }
  }, [controlledRootId]);

  useEffect(() => {
    if (!filterPopover) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        filterPopoverRef.current?.contains(target) ||
        target.closest('.app-select-menu') ||
        target.closest('[data-library-filter-trigger="true"]')
      ) {
        return;
      }
      setFilterPopover(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.app-select-menu')) {
        setFilterPopover(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [filterPopover]);

  const scope = useMemo(
    () => ({
      view: filters.view,
      employee: filters.employee,
      conversation: filters.conversation,
      host: filters.host,
    }),
    [filters.view, filters.employee, filters.conversation, filters.host],
  );
  const scopeKey = JSON.stringify(scope);

  const refresh = useCallback(() => {
    setError('');
    clearAssetCovers();
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadBranch = useCallback(
    async (nodeId: string, offset = 0, limit = 150) => {
      const token = generation.current;
      if (branchRequests.current.has(nodeId)) return;
      branchRequests.current.set(nodeId, token);
      setLoading((prev) => new Set(prev).add(nodeId));
      try {
        const next = await api.call<Children>('assets.children', {
          id: nodeId,
          ...scope,
          hidden,
          offset,
          limit,
        });
        if (!alive.current || token !== generation.current) return;
        setBranches((prev) => ({
          ...prev,
          [nodeId]: {
            ...next,
            entries: offset
              ? [
                  ...new Map(
                    [...(prev[nodeId]?.entries ?? []), ...next.entries].map((e) => [e.id, e]),
                  ).values(),
                ]
              : next.entries,
          },
        }));
      } catch (cause) {
        if (alive.current && token === generation.current) {
          setError((cause as Error).message);
        }
      } finally {
        if (branchRequests.current.get(nodeId) === token) {
          branchRequests.current.delete(nodeId);
          if (alive.current) {
            setLoading((prev) => {
              const next = new Set(prev);
              next.delete(nodeId);
              return next;
            });
          }
        }
      }
    },
    [scopeKey, hidden],
  );

  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    branchRequests.current.clear();
    setBranches({});
    const run = async () => {
      try {
        const next = await api.call<AssetTree>('assets.tree', scope);
        if (!active || token !== generation.current) return;
        setTree(next);
        setFacets(next.facets);
        if (next.errors?.length) setError(next.errors.join('\n'));
      } catch (cause) {
        if (active) setError((cause as Error).message);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [scopeKey, revision]);

  useEffect(() => {
    if (hideInternalTree || !tree) return;
    const visit = (node: AssetNode) => {
      if (!expanded.has(node.id)) return;
      if (node.location && !branches[node.id] && !loading.has(node.id)) {
        void loadBranch(node.id);
      }
      for (const child of node.location ? branches[node.id]?.entries ?? [] : node.children ?? []) {
        visit(child);
      }
    };
    visit(tree);
  }, [hideInternalTree, tree, expanded, branches, loadBranch]);

  const rows = useMemo<TreeRow[]>(() => {
    if (hideInternalTree) return [];
    const out: TreeRow[] = [];
    const visit = (node: AssetNode, depth: number) => {
      out.push({ node, depth });
      if (!expanded.has(node.id)) return;
      for (const child of node.location ? branches[node.id]?.entries ?? [] : node.children ?? []) {
        visit(child, depth + 1);
      }
      const more = branches[node.id]?.nextOffset;
      if (more !== undefined && more !== null) out.push({ node, depth: depth + 1, more });
    };
    for (const child of tree?.children ?? []) {
      if (!filters.view || child.name === filters.view) visit(child, 0);
    }
    return out;
  }, [hideInternalTree, tree, branches, expanded, filters.view]);

  // Project Study Sets, Private Chat local folders, and Cloud Hosts into unified Folder varieties at root
  const extraRootEntries = useMemo<AssetNode[]>(() => {
    const studyNodes: AssetNode[] = studySets.map((set) => ({
      id: `study-set:${set.id}`,
      name: set.title,
      label: set.title,
      directory: true,
      locked: true,
      kind: 'study-set',
      storage: 'local',
      fileCount: set.cardCount ?? 0,
      host: { id: 'local', name: uiText('Local'), os: 'macos', kind: 'local' },
      owner: { view: 'Reader', label: uiText('Study Sets') },
    }));

    const directNodes = collectDirectChatNodes(tree);

    const hostNodes: AssetNode[] = cloudHosts.map((host) => ({
      id: `host:${host.id}`,
      name: host.name,
      label: host.name,
      directory: true,
      locked: true,
      kind: 'cloud-host',
      storage: 'remote',
      location: { asset: `host:${host.id}`, path: '.' },
      host: {
        id: host.id,
        name: host.host,
        os: host.os,
        distribution: host.distribution,
        kind: 'remote',
      },
      owner: {
        view: 'Hosts',
        label: host.defaultDirectory || host.host,
      },
    }));

    return [...studyNodes, ...directNodes, ...hostNodes];
  }, [studySets, tree, cloudHosts]);

  const entryFilter = useCallback(
    (node: AssetNode, currentRoot: string) => {
      if (currentRoot !== 'root' || query.trim() || shelfCategory === 'all') return true;
      switch (shelfCategory) {
        case 'study-sets':
          return node.kind === 'study-set';
        case 'reader':
          return node.kind === 'reader' || (node.owner?.view === 'Reader' && node.kind !== 'study-set');
        case 'agents':
          return node.kind === 'employee' || node.kind === 'member';
        case 'messages':
          return node.owner?.view === 'Messages' || node.kind === 'direct';
        case 'plan-shared':
          return node.owner?.view === 'Plan' || node.kind === 'shared';
        case 'hosts':
          return node.kind === 'cloud-host' || node.owner?.view === 'Hosts';
        default:
          return true;
      }
    },
    [shelfCategory, query],
  );

  const toggleNode = (node: AssetNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const locateAndOpen = async (node: AssetNode) => {
    if (node.id.startsWith('study-set:')) {
      onOpenStudySet?.(node.id.slice('study-set:'.length));
      return;
    }
    if (node.id === 'reader:library' && onOpenStudyLibrary) {
      onOpenStudyLibrary();
      return;
    }
    setError('');
    try {
      await flushPlugins();
      if (node.id.startsWith('host:') && !node.id.includes('|') && onOpenHost) {
        onOpenHost(node.id.slice('host:'.length));
        return;
      }
      const loc = await api.call<AssetLocation>('assets.locate', { id: node.id });
      if (!alive.current) return;
      if (loc.parent.location?.asset) {
        setOpenWorkspace(loc);
        setViewMode('workbench');
      } else {
        const nextId = loc.node.directory ? loc.node.id : loc.parent.id;
        setGalleryRoot(nextId);
        onRootChange?.(nextId);
        setViewMode('gallery');
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const openInReaderNode = async (node: AssetNode) => {
    setError('');
    try {
      const info = await api.call<{ physicalPath?: string }>('assets.info', { id: node.id });
      if (info.physicalPath) {
        onOpenInReader({ path: info.physicalPath, assetId: node.id, inPlace: true });
      } else {
        onOpenInReader({ assetId: node.id, inPlace: true });
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const handleDrop = async (event: DragEvent, node: AssetNode) => {
    if (node.readOnly || !node.directory || !node.location || !hasFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    try {
      await dropFiles(event.dataTransfer, node.location);
      refresh();
      setNotice(uiText('Files copied. Originals were kept.'));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const handleUploadToTarget = async (files: File[]) => {
    if (!files.length) return;
    setError('');
    try {
      const target =
        selected?.directory && !selected.readOnly && selected.location && !selected.id.startsWith('host:')
          ? selected.location
          : currentFolderNode?.directory &&
              !currentFolderNode.readOnly &&
              currentFolderNode.location &&
              !currentFolderNode.id.startsWith('host:')
            ? currentFolderNode.location
            : { shared: true, path: '.' };
      await uploadFiles(files, target);
      refresh();
      setNotice(uiText('Uploaded {0} files', [files.length]));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const activeFilterCount =
    (filters.kind && filters.kind !== 'all' ? 1 : 0) +
    (filters.employee ? 1 : 0) +
    (filters.host ? 1 : 0) +
    (hidden ? 1 : 0);

  const isVirtualStudySet = Boolean(selected?.id.startsWith('study-set:'));
  const isHostFolder = Boolean(selected?.id.startsWith('host:') && !selected?.id.includes('|'));

  return (
    <div className={`library-files-page${hideInternalTree ? ' is-unified' : ''}`}>
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void handleUploadToTarget([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      {!hideInternalTree && (
        <header className="library-files-toolbar">
          <div className="library-scope-pills" role="group" aria-label={uiText('Workspace view')}>
            {SCOPE_OPTIONS.map((opt) => (
              <button
                key={opt.value || 'all'}
                type="button"
                aria-pressed={(filters.view ?? '') === opt.value}
                onClick={() => {
                  setFilters((prev) => ({ ...prev, view: opt.value || undefined }));
                  setOpenWorkspace(null);
                  setViewMode('gallery');
                  setGalleryRoot('root');
                }}
              >
                {uiText(opt.label)}
              </button>
            ))}
          </div>
        </header>
      )}

      {(error || notice || undo) && (
        <div className="library-files-banners">
          {error && (
            <div className="library-error-banner" role="alert">
              <Icon name="warning" />
              <span>{assetError(error)}</span>
              <button type="button" onClick={refresh}>
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
          {undo && (
            <div className="library-status-banner" role="status">
              <span>{uiText('Moved {0} to Trash', [undo.name])}</span>
              <button
                type="button"
                onClick={() =>
                  void api
                    .call('assets.file', { id: undo.asset, operation: 'restore', trashId: undo.id })
                    .then(() => {
                      setUndo(undefined);
                      refresh();
                    })
                    .catch((c) => setError((c as Error).message))
                }
              >
                {uiText('Undo')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className={`library-files-split${hideInternalTree ? ' no-internal-tree' : ''}`}>
        {!hideInternalTree && (
          <aside className="library-files-tree" aria-label={uiText('Agents file tree')}>
            <div className="library-tree-scroll" role="tree">
              {rows.map((row) => {
                const node = row.node;
                const title = assetTitle(node);
                if (row.more !== undefined) {
                  return (
                    <button
                      key={node.id + ':more'}
                      type="button"
                      className="library-tree-more"
                      style={{ paddingLeft: row.depth * 14 + 12 }}
                      disabled={loading.has(node.id)}
                      onClick={() => void loadBranch(node.id, row.more)}
                    >
                      {uiText('Load more')}
                    </button>
                  );
                }
                return (
                  <div
                    key={node.id}
                    className={`library-tree-row${selected?.id === node.id ? ' is-selected' : ''}`}
                    style={{ paddingLeft: row.depth * 14 + 8 }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelected(node);
                      setMenu({ node, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <button
                      type="button"
                      className="library-tree-item"
                      role="treeitem"
                      aria-expanded={node.directory ? expanded.has(node.id) : undefined}
                      onClick={() => {
                        setSelected(node);
                        if (node.directory) {
                          toggleNode(node);
                          setGalleryRoot(node.id);
                          setViewMode('gallery');
                          setOpenWorkspace(null);
                        } else {
                          void locateAndOpen(node);
                        }
                      }}
                      draggable={!!node.location && (!node.locked || !node.directory)}
                      onDragStart={(e) => node.location && dragFile(e.dataTransfer, node.location)}
                      onDragOver={(e) => {
                        if (!node.readOnly && node.directory && node.location && hasFileDrop(e.dataTransfer)) {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                        }
                      }}
                      onDrop={(e) => void handleDrop(e, node)}
                    >
                      <span className="library-tree-disclosure">
                        {node.directory && (
                          <Icon
                            name={
                              loading.has(node.id)
                                ? 'loading'
                                : expanded.has(node.id)
                                  ? 'chevron-down'
                                  : 'chevron-right'
                            }
                          />
                        )}
                      </span>
                      <AssetGlyph node={node} />
                      <span className="library-tree-label">{node.owner ? title : uiText(title)}</span>
                      {node.directory && node.fileCount !== undefined && (
                        <small className="library-tree-count">{node.fileCount}</small>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <section className="library-files-main">
          {viewMode === 'workbench' && openWorkspace?.parent.location?.asset ? (
            <div className="library-inline-workbench">
              <header className="library-workbench-bar">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setOpenWorkspace(null);
                    setViewMode('gallery');
                    refresh();
                  }}
                >
                  <Icon name="arrow-left" />
                  <span>{uiText('Back to files')}</span>
                </button>
                <strong>{assetTitle(openWorkspace.workspace)}</strong>
                {canOpenNodeInReader(openWorkspace.node) && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void openInReaderNode(openWorkspace.node)}
                  >
                    <Icon name="book" />
                    <span>{uiText('Open in Study Reader')}</span>
                  </button>
                )}
              </header>
              <FileWorkspace
                key={`${openWorkspace.parent.location.asset}/${openWorkspace.parent.location.path}/${openWorkspace.node.id}`}
                folderName={assetTitle(openWorkspace.workspace)}
                flat={openWorkspace.workspace.id.startsWith('published:channel:')}
                initialFileName={openWorkspace.node.name}
                revealAvailable={
                  api.mode !== 'web' &&
                  openWorkspace.workspace.storage !== 'remote' &&
                  !openWorkspace.workspace.id.startsWith('published:channel:')
                }
                readOnly={openWorkspace.workspace.readOnly}
                assetRoot={openWorkspace.parent.location.asset}
                initialFolder={
                  openWorkspace.parent.location.path === '.' ? '' : openWorkspace.parent.location.path
                }
                initialFile={
                  openWorkspace.node.directory || openWorkspace.node.document
                    ? ''
                    : openWorkspace.node.location?.path ?? ''
                }
              />
            </div>
          ) : (
            <AssetGallery
              key={filters.view ?? 'all'}
              initialRoot={galleryRoot}
              onFolder={(node) => {
                setGalleryRoot(node.id);
                setCurrentFolderNode(node);
                onRootChange?.(node.id);
              }}
              filters={filters}
              query={query}
              revision={revision}
              hidden={hidden}
              selected={selected?.id}
              compactChrome
              extraRootEntries={extraRootEntries}
              entryFilter={entryFilter}
              onNavigateDirectory={(node) => {
                if (node.id.startsWith('study-set:')) {
                  onOpenStudySet?.(node.id.slice('study-set:'.length));
                  return true;
                }
                if (node.id === 'reader:library' && onOpenStudyLibrary) {
                  onOpenStudyLibrary();
                  return true;
                }
                if (node.id.startsWith('host:') && !node.id.includes('|') && onOpenHost) {
                  onOpenHost(node.id.slice('host:'.length));
                  return true;
                }
                return false;
              }}
              toolbarRight={({ size, setSize }) => (
                <>
                  <label className="library-shelf-search-pill">
                    <Icon name="search" />
                    <input
                      type="search"
                      aria-label={uiText('Search assets')}
                      placeholder={uiText('Filter in shelf…')}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        if (openWorkspace) setOpenWorkspace(null);
                      }}
                    />
                    {query && (
                      <button
                        type="button"
                        className="library-shelf-clear"
                        aria-label={uiText('Clear search')}
                        onClick={() => setQuery('')}
                      >
                        <Icon name="close" />
                      </button>
                    )}
                  </label>

                  <button
                    type="button"
                    data-library-filter-trigger="true"
                    className={`library-shelf-pill-btn${activeFilterCount > 0 || filterPopover ? ' is-active' : ''}`}
                    aria-label={uiText('Filter workspaces')}
                    aria-expanded={Boolean(filterPopover)}
                    onClick={(e) => {
                      if (filterPopover) {
                        setFilterPopover(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setFilterPopover({
                          x: Math.max(12, Math.min(rect.right - 296, window.innerWidth - 308)),
                          y: rect.bottom + 6,
                        });
                      }
                    }}
                  >
                    <Icon name="filter" />
                    <span>{uiText('Filters')}</span>
                    {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
                  </button>

                  <AppSelect
                    className="library-compact-select"
                    aria-label={uiText('Sort files')}
                    value={filters.sort ?? 'name'}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, sort: e.target.value as AssetFilters['sort'] }))
                    }
                  >
                    <option value="name">{uiText('Name')}</option>
                    <option value="modified">{uiText('Recently modified')}</option>
                    <option value="size">{uiText('Largest first')}</option>
                  </AppSelect>

                  <label className="library-shelf-zoom" title={uiText('Icon size')}>
                    <Icon name="zoom-in" />
                    <input
                      aria-label={uiText('Icon size')}
                      type="range"
                      min={130}
                      max={230}
                      step={10}
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    />
                  </label>

                  <button
                    type="button"
                    className="library-shelf-pill-btn is-primary"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    <Icon name="cloud-upload" />
                    <span>{uiText('Upload files')}</span>
                  </button>

                  <button
                    type="button"
                    className="library-shelf-icon-btn"
                    onClick={refresh}
                    title={uiText('Refresh')}
                    aria-label={uiText('Refresh')}
                  >
                    <Icon name="refresh" />
                  </button>
                </>
              )}
              subToolbar={({ currentRoot }) =>
                currentRoot === 'root' && !query.trim() ? (
                  <div className="library-shelf-categories" role="tablist" aria-label={uiText('Folder varieties')}>
                    <div className="library-shelf-category-pills">
                      {SHELF_CATEGORIES.map((cat) => {
                        const active = shelfCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            role="tab"
                            data-shelf-category={cat.id}
                            aria-selected={active}
                            className={`library-shelf-cat-pill${active ? ' is-active' : ''}`}
                            onClick={() => setShelfCategory(cat.id)}
                          >
                            <Icon name={cat.icon} />
                            <span>{uiText(cat.label)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="library-shelf-quick-create">
                      {onCreateStudySet && (
                        <button
                          type="button"
                          className="library-shelf-quick-btn"
                          onClick={onCreateStudySet}
                        >
                          <Icon name="add" />
                          <span>{uiText('New Study Set')}</span>
                        </button>
                      )}
                      {onCreateHost && (
                        <button
                          type="button"
                          className="library-shelf-quick-btn"
                          onClick={onCreateHost}
                        >
                          <Icon name="server-environment" />
                          <span>{uiText('Add Host')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : null
              }
              footerLeading={
                selected ? (
                  <div className="library-footer-selection">
                    <span className="library-footer-sel-title">
                      <strong>{assetTitle(selected)}</strong>
                      <AssetHostBadge node={selected} />
                    </span>
                    <div className="library-footer-sel-actions">
                      {isVirtualStudySet && onOpenStudySet && (
                        <button
                          type="button"
                          className="is-accent"
                          onClick={() => onOpenStudySet(selected.id.slice('study-set:'.length))}
                        >
                          <Icon name="layers" />
                          <span>{uiText('Open Study Set')}</span>
                        </button>
                      )}
                      {selected.id === 'reader:library' && onOpenStudyLibrary && (
                        <button
                          type="button"
                          className="is-accent"
                          onClick={onOpenStudyLibrary}
                        >
                          <Icon name="book" />
                          <span>{uiText('Open Study Library')}</span>
                        </button>
                      )}
                      {isHostFolder && onOpenHost && (
                        <button
                          type="button"
                          className="is-accent"
                          onClick={() => onOpenHost(selected.id.slice('host:'.length))}
                        >
                          <Icon name="server-environment" />
                          <span>{uiText('Manage Host')}</span>
                        </button>
                      )}
                      {canOpenNodeInReader(selected) && (
                        <button
                          type="button"
                          className="is-accent"
                          onClick={() => void openInReaderNode(selected)}
                        >
                          <Icon name="book" />
                          <span>{uiText('Open in Study Reader')}</span>
                        </button>
                      )}
                      {!isVirtualStudySet && (
                        <button type="button" onClick={() => setInformation(selected)}>
                          <Icon name="info" />
                          <span>{uiText('Get Info')}</span>
                        </button>
                      )}
                      {selected.location && api.mode !== 'web' && selected.storage !== 'remote' && (
                        <button
                          type="button"
                          onClick={() =>
                            void revealFile(selected.location).catch((e) => setError((e as Error).message))
                          }
                        >
                          <Icon name="folder-opened" />
                          <span>{uiText('Open in Finder')}</span>
                        </button>
                      )}
                      {!selected.directory && !selected.symlink && selected.location && (
                        <button
                          type="button"
                          onClick={() =>
                            void downloadFile(selected.location!).catch((e) => setError((e as Error).message))
                          }
                        >
                          <Icon name="cloud-download" />
                          <span>{uiText('Download file')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : undefined
              }
              onSelect={(node) => {
                setSelected(node);
                setNotice('');
              }}
              onOpen={(node) => {
                if (/\.(pdf|epub|mobi|azw3|docx?)$/i.test(node.name || '')) {
                  void openInReaderNode(node);
                } else {
                  void locateAndOpen(node);
                }
              }}
              onLocate={(node) => void locateAndOpen(node)}
              onContext={(node, point) => {
                setSelected(node);
                setMenu({ node, ...point });
              }}
              onDrop={handleDrop}
              onInfo={setInformation}
              onClearSearch={() => setQuery('')}
            />
          )}
        </section>
      </div>

      {filterPopover &&
        createPortal(
          <div
            ref={filterPopoverRef}
            className="library-filter-popover"
            role="dialog"
            aria-label={uiText('Filters')}
            style={{ left: filterPopover.x, top: filterPopover.y }}
          >
            <div className="library-filter-popover-head">
              <strong>{uiText('Filters')}</strong>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilters((prev) => ({ sort: prev.sort, view: prev.view }));
                    setHidden(false);
                    refresh();
                  }}
                >
                  {uiText('Clear filters')}
                </button>
              )}
            </div>

            <label className="library-filter-field">
              <span>{uiText('File type')}</span>
              <AppSelect
                aria-label={uiText('File type')}
                value={filters.kind ?? 'all'}
                onChange={(e) => setFilters((prev) => ({ ...prev, kind: e.target.value }))}
              >
                {ASSET_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {uiText(KIND_LABELS[kind] ?? kind)}
                  </option>
                ))}
              </AppSelect>
            </label>

            <label className="library-filter-field">
              <span>{uiText('Employee')}</span>
              <AppSelect
                aria-label={uiText('Filter by employee')}
                value={filters.employee ?? ''}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, employee: e.target.value || undefined }))
                }
              >
                <option value="">{uiText('All employees')}</option>
                {facets.employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </AppSelect>
            </label>

            {!!facets.hosts?.length && (
              <label className="library-filter-field">
                <span>{uiText('Storage host')}</span>
                <AppSelect
                  aria-label={uiText('Filter by host')}
                  value={filters.host ?? ''}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, host: e.target.value || undefined }))
                  }
                >
                  <option value="">{uiText('All hosts')}</option>
                  {facets.hosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.kind === 'local' ? uiText('Core host') : host.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
            )}

            <label className="library-checkbox-inline">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => {
                  setHidden(e.target.checked);
                  refresh();
                }}
              />
              <span>{uiText('Show hidden files')}</span>
            </label>
          </div>,
          document.body,
        )}

      {menu && (
        <MessageMenu
          motion="file-menu"
          className="asset-context-menu"
          label={uiText('File actions')}
          anchor={menu}
          onClose={() => setMenu(undefined)}
        >
          {menu.node.id.startsWith('study-set:') ? (
            <button
              role="menuitem"
              onClick={() => {
                const setId = menu.node.id.slice('study-set:'.length);
                setMenu(undefined);
                onOpenStudySet?.(setId);
              }}
            >
              <Icon name="layers" />
              {uiText('Open Study Set')}
            </button>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  const node = menu.node;
                  setMenu(undefined);
                  setInformation(node);
                }}
              >
                <Icon name="info" />
                {uiText('Get Info')}
              </button>
              {menu.node.id === 'reader:library' && onOpenStudyLibrary ? (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(undefined);
                      onOpenStudyLibrary();
                    }}
                  >
                    <Icon name="book" />
                    {uiText('Open Study Library')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(undefined);
                      setGalleryRoot('reader:library');
                      onRootChange?.('reader:library');
                      setViewMode('gallery');
                    }}
                  >
                    <Icon name="folder-opened" />
                    {uiText('Browse raw files')}
                  </button>
                </>
              ) : menu.node.id.startsWith('host:') && !menu.node.id.includes('|') && onOpenHost ? (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const hostId = menu.node.id.slice('host:'.length);
                      setMenu(undefined);
                      onOpenHost(hostId);
                    }}
                  >
                    <Icon name="server-environment" />
                    {uiText('Manage Host')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const nodeId = menu.node.id;
                      setMenu(undefined);
                      setGalleryRoot(nodeId);
                      onRootChange?.(nodeId);
                      setViewMode('gallery');
                    }}
                  >
                    <Icon name="folder-opened" />
                    {uiText('Remote SFTP Files')}
                  </button>
                </>
              ) : (
                <button
                  role="menuitem"
                  onClick={() => {
                    const node = menu.node;
                    setMenu(undefined);
                    void locateAndOpen(node);
                  }}
                >
                  <Icon name="folder-opened" />
                  {uiText(menu.node.directory ? 'Open folder' : 'Show in folder')}
                </button>
              )}
              {canOpenNodeInReader(menu.node) && (
                <button
                  role="menuitem"
                  onClick={() => {
                    const node = menu.node;
                    setMenu(undefined);
                    void openInReaderNode(node);
                  }}
                >
                  <Icon name="book" />
                  {uiText('Open in Study Reader')}
                </button>
              )}
              {!menu.node.directory && !menu.node.symlink && menu.node.location && (
                <button
                  role="menuitem"
                  onClick={() => {
                    const loc = menu.node.location!;
                    setMenu(undefined);
                    void downloadFile(loc).catch((e) => setError((e as Error).message));
                  }}
                >
                  <Icon name="cloud-download" />
                  {uiText('Download file')}
                </button>
              )}
              {menu.node.location && (!menu.node.directory || !menu.node.locked) && (
                <button
                  role="menuitem"
                  onClick={() => {
                    copyFile(menu.node.location!);
                    setNotice(uiText('File copied. Choose a folder and paste.'));
                    setMenu(undefined);
                  }}
                >
                  <Icon name="copy" />
                  {uiText('Copy file')}
                </button>
              )}
              {menu.node.location && !menu.node.readOnly && (
                <>
                  {menu.node.directory && (
                    <>
                      <button
                        role="menuitem"
                        onClick={() => {
                          const node = menu.node;
                          setMenu(undefined);
                          setAction({ node, kind: 'new-folder' });
                        }}
                      >
                        <Icon name="new-folder" />
                        {uiText('New folder')}
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          const node = menu.node;
                          setMenu(undefined);
                          setAction({ node, kind: 'new-file' });
                        }}
                      >
                        <Icon name="new-file" />
                        {uiText('New file')}
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          const loc = menu.node.location!;
                          setMenu(undefined);
                          void pasteFile(loc).then(refresh).catch((c) => setError((c as Error).message));
                        }}
                      >
                        <Icon name="clippy" />
                        {uiText('Paste')}
                      </button>
                    </>
                  )}
                  {!menu.node.locked && (
                    <>
                      <hr />
                      <button
                        role="menuitem"
                        onClick={() => {
                          const node = menu.node;
                          setMenu(undefined);
                          setAction({ node, kind: 'rename' });
                        }}
                      >
                        <Icon name="edit" />
                        {uiText('Rename')}
                      </button>
                      <button
                        role="menuitem"
                        className="danger"
                        onClick={() => {
                          const node = menu.node;
                          setMenu(undefined);
                          setAction({ node, kind: 'trash' });
                        }}
                      >
                        <Icon name="trash" />
                        {uiText('Move to Trash')}
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </MessageMenu>
      )}

      {information && (
        <AssetInfoDialog key={information.id} node={information} onClose={() => setInformation(undefined)} />
      )}
      {action && (
        <AssetActionDialog
          {...action}
          onClose={() => setAction(undefined)}
          onDone={(result) => {
            if (action.kind === 'trash') {
              setUndo({
                asset: action.node.location!.asset!,
                id: result.id,
                name: assetTitle(action.node),
              });
            }
            setAction(undefined);
            setSelected(undefined);
            refresh();
          }}
        />
      )}
    </div>
  );
}
