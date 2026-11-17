import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ASSET_KINDS, assetTitle } from '../../../shared/asset-presentation';
import type {
  AssetFacets,
  AssetFilters,
  AssetLocation,
  AssetNode,
  AssetTree,
  AssetView,
} from '../../../shared/asset-schema';
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

export function canOpenNodeInReader(node?: AssetNode): boolean {
  if (!node || node.directory) return false;
  return READER_EXT_RE.test(node.name || '');
}

export function LibraryFilesExplorer({
  initialViewScope = '',
  controlledRootId,
  hideInternalTree = false,
  onOpenInReader,
  onOpenHost,
}: {
  initialViewScope?: AssetView | '';
  controlledRootId?: string;
  hideInternalTree?: boolean;
  onOpenInReader: (opts: { path?: string; assetId?: string; inPlace?: boolean }) => void;
  onOpenHost?: (hostId: string) => void;
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
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'workbench'>('gallery');
  const [galleryRoot, setGalleryRoot] = useState(controlledRootId || 'root');
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
  const alive = useRef(true);
  const generation = useRef(0);
  const branchRequests = useRef(new Map<string, number>());

  useEffect(() => {
    setFilters((prev) => ({ ...prev, view: initialViewScope || undefined }));
  }, [initialViewScope]);

  useEffect(() => {
    if (!controlledRootId) return;
    setGalleryRoot(controlledRootId);
    setViewMode('gallery');
    setOpenWorkspace(null);
    setFilters((prev) => (prev.view ? { ...prev, view: undefined } : prev));
  }, [controlledRootId]);

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
    if (!tree) return;
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
  }, [tree, expanded, branches, loadBranch]);

  const rows = useMemo<TreeRow[]>(() => {
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
  }, [tree, branches, expanded, filters.view]);

  const toggleNode = (node: AssetNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const locateAndOpen = async (node: AssetNode) => {
    setError('');
    try {
      await flushPlugins();
      if (node.id.startsWith('host:') && !node.id.includes('|') && onOpenHost) {
        setGalleryRoot(node.id);
      }
      const loc = await api.call<AssetLocation>('assets.locate', { id: node.id });
      if (!alive.current) return;
      if (loc.parent.location?.asset) {
        setOpenWorkspace(loc);
        setViewMode('workbench');
      } else {
        setGalleryRoot(loc.node.directory ? loc.node.id : loc.parent.id);
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

  const handleUploadToShared = async (files: File[]) => {
    if (!files.length) return;
    setError('');
    try {
      const target =
        selected?.directory && !selected.readOnly && selected.location
          ? selected.location
          : { shared: true, path: '.' };
      await uploadFiles(files, target);
      refresh();
      setNotice(uiText('Uploaded {0} files', [files.length]));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className={`library-files-page${hideInternalTree ? ' is-unified' : ''}`}>
      <header className="library-files-toolbar">
        {!hideInternalTree && (
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
        )}

        <div className="library-files-filters">
          <div className="library-search-inline">
            <Icon name="search" />
            <input
              type="search"
              aria-label={uiText('Search assets')}
              placeholder={uiText('Search files or people…')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (openWorkspace) setOpenWorkspace(null);
              }}
            />
          </div>

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

          <AppSelect
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

          <input
            ref={uploadInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void handleUploadToShared([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn" onClick={() => uploadInputRef.current?.click()}>
            <Icon name="cloud-upload" />
            <span>{uiText('Upload files')}</span>
          </button>

          <button type="button" className="btn" onClick={refresh} aria-label={uiText('Refresh')}>
            <Icon name="refresh" />
          </button>
        </div>
      </header>

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
          {selected && (
            <div className="library-selected-toolbar">
              <div className="library-selected-info">
                <AssetGlyph node={selected} />
                <strong>{assetTitle(selected)}</strong>
                <AssetHostBadge node={selected} />
              </div>
              <div className="library-selected-actions">
                {canOpenNodeInReader(selected) && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void openInReaderNode(selected)}
                  >
                    <Icon name="book" />
                    <span>{uiText('Open in Study Reader')}</span>
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setInformation(selected)}>
                  <Icon name="info" />
                  <span>{uiText('Get Info')}</span>
                </button>
                {selected.location && api.mode !== 'web' && selected.storage !== 'remote' && (
                  <button
                    type="button"
                    className="btn"
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
                    className="btn"
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
          )}

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
              key={galleryRoot + ':' + (filters.view ?? '')}
              initialRoot={galleryRoot}
              onFolder={(node) => setGalleryRoot(node.id)}
              filters={filters}
              query={query}
              revision={revision}
              hidden={hidden}
              selected={selected?.id}
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

      {menu && (
        <MessageMenu
          motion="file-menu"
          className="asset-context-menu"
          label={uiText('File actions')}
          anchor={menu}
          onClose={() => setMenu(undefined)}
        >
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
