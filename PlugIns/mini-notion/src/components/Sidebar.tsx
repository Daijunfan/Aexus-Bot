import { Bell, Bot, Clock } from 'lucide-react';
import {internalPageIds} from '../model';
import { useState, useEffect, useMemo, type DragEvent } from 'react';
import {
  Search,
  House,
  Settings,
  Trash2,
  Plus,
  ChevronRight,
  ChevronsLeft,
  ChevronsUpDown,
  MoreHorizontal,
  SquarePen,
  LayoutTemplate,
  Download,
  HardDrive,
  CircleHelp,
} from 'lucide-react';
import { useWorkspace } from '../store';
import { EmojiPicker } from './LazyPickers';
import { IconButton, PageIcon } from '../ui';
import type { Page } from '../types';
import { activeView, getViews, selectView } from '../database/model';
import { viewTypes } from '../database/viewTypes';
import { SidebarList } from './SidebarList';

export function Sidebar() {
  const {
    workspace: ws,
    navigate,
    toggleExpanded,
    create,
    move,
    trash,
    setModal,
    setPageMenu,
    setting,
    patch,
  } = useWorkspace();
  const [width, setWidth] = useState(ws!.settings.sidebarWidth);
  const [iconPicker, setIconPicker] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ id: string; mode: string } | null>(null);
  const [privateOpen, setPrivateOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  useEffect(() => setWidth(ws!.settings.sidebarWidth), [ws!.settings.sidebarWidth]);
  const visible = useMemo(() => {
    const internal = internalPageIds(ws!.pages);
    return ws!.pages.filter(page => !page.trashedAt && !internal.has(page.id) &&
      (!page.sourceFile || page.sourceFile.kind === 'directory'));
  }, [ws!.pages]);
  const expandedIds = useMemo(() => new Set(ws!.expanded), [ws!.expanded]);
  const childrenByParent = useMemo(() => {
    const index = new Map<string | null, Page[]>();
    for (const page of visible) {
      const siblings = index.get(page.parentId) || [];
      siblings.push(page); index.set(page.parentId, siblings);
    }
    return index;
  }, [visible]);
  const favorites = visible.filter((p) => p.favorite);
  const treeRows = useMemo(() => {
    type Row = { page: Page; depth: number; view?: ReturnType<typeof getViews>[number] };
    const rows: Row[] = [];
    const pending: Row[] = [...(childrenByParent.get(null) || [])].reverse().map(page => ({ page, depth: 0 }));
    while (pending.length) {
      const entry = pending.pop()!;
      rows.push(entry);
      if (!expandedIds.has(entry.page.id)) continue;
      if (entry.page.database) {
        rows.push(...getViews(entry.page.database).map(view => ({ ...entry, depth: entry.depth + 1, view })));
      } else {
        const children = childrenByParent.get(entry.page.id) || [];
        for (let i = children.length - 1; i >= 0; i--) pending.push({ page: children[i], depth: entry.depth + 1 });
      }
    }
    return rows;
  }, [childrenByParent, expandedIds]);
  const treePositions = useMemo(() => new Map(treeRows.flatMap((entry, index) => entry.view ? [] : [[entry.page.id, index] as const])), [treeRows]);

  const onDragOver = (event: DragEvent, page: Page) => {
    if (!event.dataTransfer.types.includes('application/x-mini-page')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    setDrop({
      id: page.id,
      mode: y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'inside',
    });
  };

  const row = (page: Page, depth = 0, favorite = false): React.ReactNode => {
    const children = childrenByParent.get(page.id) || [];
    const expanded = expandedIds.has(page.id);
    return (
        <div
          className={`sidebar-page ${ws!.activePageId === page.id ? 'selected' : ''} ${drop?.id === page.id && !favorite ? `drop-${drop.mode}` : ''}`}
          style={{ paddingLeft: `calc(8px + ${Math.min(depth, 5)} * var(--tree-step))` }}
          draggable
          role="treeitem"
          tabIndex={0}
          aria-label={page.title || '无标题'}
          title={page.title || '无标题'}
          aria-level={depth + 1}
          aria-selected={ws!.activePageId === page.id}
          aria-expanded={!favorite && (children.length || page.database) ? expanded : undefined}
          data-page-id={page.id}
          data-parent-index={!favorite && page.parentId ? treePositions.get(page.parentId) : undefined}
          onClick={event => navigate(page.id, undefined, event.metaKey || event.ctrlKey ? 'new' : undefined)}
          onAuxClick={event => { if (event.button === 1) { event.preventDefault(); navigate(page.id, undefined, 'new'); } }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (['ArrowRight', 'ArrowLeft', 'Enter'].includes(e.key)) e.preventDefault();
            if (e.key === 'Enter') navigate(page.id);
            if (!favorite && e.key === 'ArrowRight' && !expanded && (children.length || page.database)) toggleExpanded(page.id);
            if (!favorite && e.key === 'ArrowLeft') {
              if (expanded) toggleExpanded(page.id);
              else e.currentTarget.closest('[role="tree"]')?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(page.parentId || '')}"]`)?.focus();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setPageMenu({ id: page.id, x: e.clientX, y: e.clientY });
          }}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-mini-page', page.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => onDragOver(e, page)}
          onDragEnd={() => setDrop(null)}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-mini-page');
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            if (drop?.mode === 'inside') move(id, page.id);
            else if (drop?.mode === 'before') move(id, page.parentId, page.id);
            else {
              const siblings = visible.filter((p) => p.parentId === page.parentId);
              move(id, page.parentId, siblings[siblings.findIndex((p) => p.id === page.id) + 1]?.id);
            }
            setDrop(null);
          }}
        >
          {!favorite && (children.length || page.database ? (
            <button
              className={`tree-toggle ${expanded ? 'expanded' : ''}`}
              title={expanded ? '折叠子页面' : '展开子页面'}
              aria-label={`${expanded ? '折叠' : '展开'} ${page.title || '无标题'}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(page.id);
              }}
            >
              <ChevronRight size={13} />
            </button>
          ) : <span className="tree-toggle-spacer" aria-hidden="true" />)}
          <button className="sidebar-page-icon" aria-label={`更换 ${page.title || '无标题'} 的图标`} disabled={page.locked || !!page.sourceFile && page.sourceFile.kind !== 'directory'}
            onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setIconPicker({ id: page.id, x: rect.left, y: rect.bottom + 4 }); }}>
            <PageIcon icon={page.icon} size={17} />
          </button>
          <span className="sidebar-page-name">{page.title || '无标题'}</span>
          {page.space && !window.native?.folderMode && (
            <span
              className={`space-badge ${ws!.spaces?.[page.id]?.agent.status || 'idle'}`}
              title={`空间 · ${page.folders?.length || 0} 个文件夹 · ${page.files?.length || 0} 个文件`}
            >
              <Bot size={12} />
            </span>
          )}
          <span className="row-actions">
            <IconButton
              label={`${page.title || '无标题'} 的更多操作`}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setPageMenu({ id: page.id, x: r.right, y: r.top });
              }}
            >
              <MoreHorizontal size={16} />
            </IconButton>
            <IconButton
              label={`在 ${page.title || '无标题'} 中添加子页面`}
              onClick={(e) => {
                e.stopPropagation();
                create({ parentId: page.id });
              }}
            >
              <Plus size={15} />
            </IconButton>
          </span>
        </div>
    );
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-titlebar">
        <IconButton label="收起侧边栏 ⌘\\" onClick={() => setting({ sidebarHidden: true })}>
          <ChevronsLeft size={17} />
        </IconButton>
      </div>
      <div className="workspace-switcher">
        <button className="workspace-name" onClick={() => setModal({ type: 'settings' })}>
          <span className="workspace-avatar" aria-hidden="true">M</span>
          <strong title={ws!.name}>{ws!.name}</strong>
          <ChevronsUpDown size={13} />
        </button>
        {window.native?.folderMode && <IconButton label="收起侧边栏 ⌘\\" onClick={() => setting({ sidebarHidden: true })}><ChevronsLeft size={17} /></IconButton>}
        <IconButton label="新建页面 ⌘N" onClick={() => create()}>
          <SquarePen size={19} />
        </IconButton>
      </div>
      <nav className="sidebar-nav">
        <button onClick={() => setModal({ type: 'search' })}>
          <Search size={18} />
          <span>搜索</span>
          <kbd>⌘ K</kbd>
        </button>
        <button className={!ws!.activePageId ? 'selected' : ''} onClick={() => navigate(null)}>
          <House size={18} />
          <span>主页</span>
        </button>
        <button aria-label="收件箱" onClick={() => setModal({ type: 'inbox' })}>
          <Bell size={18} />
          <span>收件箱</span>
          {(ws!.inbox || []).filter((item) => !item.readAt && !item.archivedAt).length > 0 && (
            <small className="inbox-badge">
              {(ws!.inbox || []).filter((item) => !item.readAt && !item.archivedAt).length}
            </small>
          )}
        </button>
        <button onClick={() => setModal({ type: 'scheduler' })}>
          <Clock size={18} />
          <span>计划与提醒</span>
        </button>
        {!window.native?.folderMode && <button onClick={() => setModal({ type: 'space-create' })}>
          {window.native?.folderMode?<Plus size={18}/>:<Bot size={18} />}
          <span>新建空间</span>
        </button>}
      </nav>
      <div className="sidebar-scroll">
        {!!favorites.length && (
          <section>
            <button className="section-heading" onClick={() => setFavoritesOpen(!favoritesOpen)}>
              收藏
              <ChevronRight size={12} className={favoritesOpen ? 'rotated' : ''} />
            </button>
            {favoritesOpen && <SidebarList count={favorites.length} label="收藏" itemKey={index => favorites[index].id}>{index => row(favorites[index], 0, true)}</SidebarList>}
          </section>
        )}
        <section
          className="private-section"
          onDragOver={(e) => {
            if (e.target === e.currentTarget) e.preventDefault();
          }}
          onDrop={(e) => {
            if (e.target === e.currentTarget) {
              move(e.dataTransfer.getData('application/x-mini-page'), null);
              setDrop(null);
            }
          }}
        >
          <div className="section-heading-wrap">
            <button className="section-heading" onClick={() => setPrivateOpen(!privateOpen)}>
              {window.native?.folderMode ? '工作区页面' : '个人页面'}
              <ChevronRight size={12} className={privateOpen ? 'rotated' : ''} />
            </button>
            <IconButton label="添加页面" onClick={() => create()}>
              <Plus size={14} />
            </IconButton>
          </div>
          {privateOpen && (
            <SidebarList count={treeRows.length} label="页面" itemKey={index => `${treeRows[index].page.id}:${treeRows[index].view?.id || ''}`}>{index => {
              const { page, depth, view } = treeRows[index];
              if (!view) return row(page, depth);
              const Icon = viewTypes.find(item => item.type === view.type)!.icon;
              return <button aria-label={`切换到 ${page.title} 的 ${view.name} 视图`}
                data-parent-index={treePositions.get(page.id)}
                className={`sidebar-database-view ${ws!.activePageId === page.id && activeView(page.database!).id === view.id ? 'selected' : ''}`}
                style={{ paddingLeft: 39 + (depth - 1) * 15, height: 'var(--sidebar-row-height, 31px)' }}
                onClick={() => { patch(page.id, { database: selectView(page.database!, view.id) }); navigate(page.id); }}>
                <Icon size={13} /><span>{view.name}</span>
              </button>;
            }}</SidebarList>
          )}
          <button className="sidebar-add" onClick={() => create()}>
            <Plus size={17} />
            添加页面
          </button>
        </section>
      </div>
      <nav className="sidebar-bottom">
        <button onClick={() => setModal({ type: 'templates' })}>
          <LayoutTemplate size={17} />
          <span>模板</span>
        </button>
        <button onClick={() => setModal({ type: 'import' })}>
          <Download size={17} />
          <span>导入</span>
        </button>
        <button onClick={() => setModal({ type: 'settings' })}>
          <Settings size={17} />
          <span>设置</span>
        </button>
        <button
          onClick={() => setModal({ type: 'trash' })}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-mini-page');
            if (id) trash(id);
            setDrop(null);
          }}
        >
          <Trash2 size={17} />
          <span>回收站</span>
        </button>
      </nav>
      <div className="sidebar-footer">
        <span>
          <HardDrive size={13} />
          本地工作空间
        </span>
        <IconButton label="帮助与快捷键" onClick={() => setModal({ type: 'help' })}>
          <CircleHelp size={17} />
        </IconButton>
      </div>
      <div
        className="sidebar-resizer"
        onPointerDown={(e) => {
          e.preventDefault();
          const start = e.clientX;
          const initial = width;
          let finalWidth = width;
          const resize = (event: PointerEvent) => {
            finalWidth = Math.max(200, Math.min(400, initial + event.clientX - start));
            setWidth(finalWidth);
          };
          const end = () => {
            document.removeEventListener('pointermove', resize);
            document.removeEventListener('pointerup', end);
            setting({ sidebarWidth: finalWidth });
          };
          document.addEventListener('pointermove', resize);
          document.addEventListener('pointerup', end);
        }}
      />
      {iconPicker && <EmojiPicker x={iconPicker.x} y={iconPicker.y} value={ws!.pages.find(page => page.id === iconPicker.id)?.icon || ''}
        onChange={icon => patch(iconPicker.id, { icon })} onClose={() => setIconPicker(null)} />}
    </aside>
  );
}
