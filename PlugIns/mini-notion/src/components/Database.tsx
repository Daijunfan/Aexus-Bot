import { AppSelect } from './AppSelect';
import { isSelectProperty, isReadOnlyProperty } from '../database/propertySchema';
import { PeoplePicker } from '../database/PeoplePicker';
import { FilesPicker } from '../database/FilesPicker';
import { Zap } from 'lucide-react';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppearanceTheme, viewAppearanceStyle } from '../appearance';
import {
  ArrowDownUp,
  Copy,
  Filter,
  MoreHorizontal,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
  Check,
  ChevronDown,
  Columns3,
} from 'lucide-react';
import type { Database as DatabaseType, DatabaseView, DatabaseViewState, Page, Property } from '../types';
import { useWorkspace } from '../store';
import { IconButton, MenuItem, Modal, Popover } from '../ui';
import { restorePage, trashPage } from '../model';
import {
  activeView,
  emptyFilters,
  getViews,
  queryRows,
  selectView,
  updateView,
  visibleColumns,
} from '../database/model';
import { DateInput } from '../database/DateInput';
import type { DateValue } from '../types';
import { PropertyEditor, PropertyValue } from '../database/Properties';
import { CreateViewDialog, ViewSettings, type SettingsSection } from '../database/ViewSettings';
import { viewTypes } from '../database/viewTypes';
import { TableView } from '../database/views/TableView';
import { BoardView, GalleryView, ListView, FeedView } from '../database/views/Cards';
import { TimelineView } from '../database/views/TimelineView';
import { ChartView } from '../database/views/ChartView';
import { FormView } from '../database/views/FormView';
import { PlanView } from '../database/views/PlanView';
import { CalendarView } from './CalendarView';
import { TemplateMenu } from '../database/TemplateMenu';
import { GroupOptionEditor, groupEditorAnchor, type GroupEditorAnchor } from '../database/GroupControls';
import { defaultTemplateId } from '../database/templatesModel';
import { StructureSettings } from '../database/StructureSettings';
import type { ViewProps } from '../database/views/types';

export function Database({
  page,
  viewState,
  onViewStateChange,
}: {
  page: Page;
  viewState?: DatabaseViewState;
  onViewStateChange?: (state: DatabaseViewState) => void;
}) {
  const { workspace, patch, update, create, navigate, setPeekId, setPeekMode, notify, command, setModal } =
    useWorkspace();
  const db = useMemo(() => ({ ...page.database!, ...viewState }), [page.database, viewState]);
  const theme = useContext(AppearanceTheme);
  const views = useMemo(() => getViews(db), [db]);
  const view = useMemo(() => activeView(db), [db]);
  const [query, setQuery] = useState('');
  const [viewSearch, setViewSearch] = useState('');
  const matchingViews = useMemo(() => views.filter(item => item.name.toLocaleLowerCase().includes(viewSearch.trim().toLocaleLowerCase())), [views, viewSearch]);
  useEffect(() => setQuery(''), [page.id]);
  const [property, setProperty] = useState<Property | null>(null);
  const [creatingView, setCreatingView] = useState(false);
  const [renamingView, setRenamingView] = useState<{ id: string; name: string } | null>(null);
  const [groupEditor, setGroupEditor] = useState<{ viewId: string; columnId: string; value?: string; anchor: GroupEditorAnchor } | null>(null);
  const [groupHelp, setGroupHelp] = useState(false);
  const [pendingGroupColumn, setPendingGroupColumn] = useState<{ viewId: string; columnId: string } | null>(null);
  const [pendingCategories, setPendingCategories] = useState<{ viewId: string; columnId: string; name: string }[]>([]);
  const [structure, setStructure] = useState(false);
  const [templateMenu, setTemplateMenu] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{
    type: 'view' | 'settings' | 'view-list';
    id?: string;
    section?: SettingsSection;
    x: number;
    y: number;
  } | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [bulkProperty, setBulkProperty] = useState('');
  const [bulkValue, setBulkValue] = useState<Page['values'][string]>('');
  const [bulkUploading, setBulkUploading] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const openGroupEditor = (columnId: string, value?: string, trigger?: Element | null) => {
    const origin = trigger || tabsRef.current?.closest('.database')?.querySelector('.database-new') || null;
    setGroupEditor({ viewId: view.id, columnId, value, anchor: groupEditorAnchor(origin) });
  };
  useEffect(() => {
    const showSettings = (event: Event) => {
      const { databaseId, viewId, section = 'main', visible } = (event as CustomEvent).detail;
      if (visible === false) {
        setMenu(null);
        return;
      }
      if (databaseId !== page.id || (viewId && viewId !== view.id)) return;
      if (
        !['main', 'layout', 'properties', 'edit-properties', 'filter', 'sort', 'group', 'appearance', 'conditional'].includes(
          section,
        )
      )
        return;
      const rect = tabsRef.current?.parentElement?.getBoundingClientRect();
      if (rect)
        setMenu({
          type: 'settings',
          section,
          x: rect.right - (['filter', 'conditional'].includes(section) ? 580 : 380),
          y: rect.bottom + 5,
        });
    };
    window.addEventListener('mini:view-settings', showSettings);
    return () => window.removeEventListener('mini:view-settings', showSettings);
  }, [page.id, view.id]);
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const button = Array.from(tabs?.querySelectorAll<HTMLButtonElement>('[data-view-id]') || []).find(
      (button) => button.dataset.viewId === view.id,
    );
    if (!tabs || !button) return;
    const left = button.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
    const right = left + button.offsetWidth;
    const actionsWidth = tabs.querySelector('.view-tab-actions')?.getBoundingClientRect().width || 0;
    if (left < tabs.scrollLeft) tabs.scrollLeft = left;
    else if (right > tabs.scrollLeft + tabs.clientWidth - actionsWidth)
      tabs.scrollLeft = right - tabs.clientWidth + actionsWidth;
  }, [view.id, view.name, views.length]);
  useEffect(() => setSelected(new Set()), [view.id, view.type, page.id]);
  const saveDatabase = (database: DatabaseType) => {
    if (onViewStateChange) {
      if (database.columns !== page.database!.columns)
        patch(page.id, { database: { ...page.database!, columns: database.columns } });
      onViewStateChange({
        views: getViews(database),
        activeViewId: activeView(database).id,
        view: activeView(database).type,
      });
    } else patch(page.id, { database });
  };
  const prepareBoard = (database: DatabaseType, viewId: string): DatabaseType => {
    const nextView = getViews(database).find((item) => item.id === viewId);
    if (
      page.locked ||
      nextView?.type !== 'board' ||
      database.columns.some(
        (column) =>
          column.id === nextView.groupBy && !['url', 'rollup', 'files', 'button'].includes(column.type),
      )
    )
      return database;
    let column = ['status', 'select', 'person', 'multiSelect', 'relation']
      .map((type) => database.columns.find((property) => property.type === type))
      .find(Boolean);
    if (!column) {
      let name = '状态',
        suffix = 2;
      while (database.columns.some((property) => property.name === name)) name = `状态 ${suffix++}`;
      column = command('property.add', { databaseId: page.id, name, type: 'status' }) as Property;
      database = { ...database, columns: [...database.columns, column] };
    }
    return updateView(database, viewId, { groupBy: column.id });
  };
  const changeView = (changes: Partial<DatabaseView>) => {
    if (page.locked && changes.type && changes.type !== view.type) return;
    // A group's identity belongs to its property. Old collapsed/hidden names
    // must not leak into a different grouping when users switch properties.
    const nextChanges: Partial<DatabaseView> = 'groupBy' in changes && changes.groupBy !== view.groupBy
      ? { hiddenGroups: [], collapsedGroups: [], groupOrder: [], revealedGroups: [], ...changes }
      : changes;
    const next = updateView(db, view.id, nextChanges);
    saveDatabase(changes.type === 'board' ? prepareBoard(next, view.id) : next);
  };
  // Reveal the new empty category in its originating view, even if the user
  // changes tabs before the property edit settles. One pending slot loses edits.
  const queueCategory = (viewId: string, columnId: string, name: string) =>
    setPendingCategories(previous => [...previous, { viewId, columnId, name }]);
  useEffect(() => {
    if (!pendingCategories.length) return;
    const ready = pendingCategories.filter(pending =>
      page.database!.columns.some(column =>
        column.id === pending.columnId && column.options?.includes(pending.name)));
    if (!ready.length) return;
    let next = db;
    for (const pending of ready) {
      const target = getViews(next).find(item => item.id === pending.viewId);
      if (!target || target.groupBy !== pending.columnId ||
          target.revealedGroups?.includes(pending.name)) continue;
      next = updateView(next, pending.viewId, {
        revealedGroups: [...(target.revealedGroups || []), pending.name],
      });
    }
    if (next !== db) saveDatabase(next);
    setPendingCategories(previous => previous.filter(pending => !ready.includes(pending)));
  }, [pendingCategories, page.database, viewState]);

  // Asynchronously created properties belong to the requesting view, not
  // whichever tab happens to be selected when the new property appears.
  useEffect(() => {
    if (!pendingGroupColumn || !page.database?.columns.some(column => column.id === pendingGroupColumn.columnId)) return;
    const target = views.find(item => item.id === pendingGroupColumn.viewId);
    if (target && target.groupBy !== pendingGroupColumn.columnId)
      saveDatabase(updateView(db, target.id, { groupBy: pendingGroupColumn.columnId,
        hiddenGroups: [], collapsedGroups: [], groupOrder: [], revealedGroups: [] }));
    if (view.id === pendingGroupColumn.viewId) openGroupEditor(pendingGroupColumn.columnId);
    setPendingGroupColumn(null);
  }, [pendingGroupColumn, page.database, view.id]);
  const chooseView = (id: string) => {
    saveDatabase(prepareBoard(selectView(db, id), id));
    setQuery('');
  };
  // A board can display a legacy default grouping even before that view is saved.
  const groupingColumn = db.columns.find((column) => column.id === view.groupBy) ||
    (view.type === 'board' ? db.columns.find((column) => isSelectProperty(column)) : undefined);
  const canEditCategories = !!groupingColumn && ['select', 'multiSelect', 'status'].includes(groupingColumn.type);
  const rows = useMemo(() => queryRows(page, view, workspace!.pages, query), [page.id, page.database, view, workspace!.pages, query]);
  const columns = useMemo(() => visibleColumns(db, view), [db, view]);
  const openRow = (id: string) => {
    if (view.openPagesIn === 'full') navigate(id);
    else {
      setPeekMode(view.openPagesIn === 'center' ? 'center' : 'side');
      setPeekId(id);
    }
  };
  const addRow = (values: Page['values'] = {}, templateId = defaultTemplateId(db, view)) => {
    const row = create({ parentId: page.id, values }, false, templateId);
    openRow(row.id);
  };
  const options = (column: Property, options: string[]) =>
    saveDatabase({ ...db, columns: db.columns.map((c) => (c.id === column.id ? { ...c, options } : c)) });
  const selectRow = (id: string | string[], checked: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of typeof id === 'string' ? [id] : id) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const openSettings = (event: React.MouseEvent<HTMLButtonElement>, section: SettingsSection) => {
    const r = event.currentTarget.getBoundingClientRect();
    setMenu({
      type: 'settings',
      section,
      x: r.right - (['filter', 'conditional'].includes(section) ? 570 : 370),
      y: r.bottom + 5,
    });
  };
  const addView = (next: DatabaseView) => {
    if (page.locked) return;
    next.calendarBy ??= db.columns.find((c) => c.type === 'date')?.id;
    next.chartGroup ??= db.columns.find((c) => isSelectProperty(c))?.id;
    saveDatabase(
      prepareBoard({ ...db, views: [...views, next], activeViewId: next.id, view: next.type }, next.id),
    );
    setCreatingView(false);
    setMenu(null);
  };
  const deleteSelected = () => {
    const ids = [...selected];
    update((state) => ids.reduce((state, id) => trashPage(state, id), state));
    notify(`已将 ${ids.length} 个页面移到回收站`, () =>
      update((state) => ids.reduce((state, id) => restorePage(state, id), state)),
    );
    setSelected(new Set());
  };
  const applyBulk = () => {
    if (page.locked) return;
    const column = db.columns.find((c) => c.id === bulkProperty);
    if (!column) return;
    const value =
      column.type === 'number'
        ? bulkValue === ''
          ? ''
          : Number(bulkValue)
        : column.type === 'checkbox'
          ? bulkValue === 'true'
          : column.type === 'multiSelect'
            ? String(bulkValue)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            : bulkValue;
    update((state) => ({
      ...state,
      pages: state.pages.map((row) =>
        selected.has(row.id) && !row.locked
          ? { ...row, values: { ...row.values, [column.id]: value }, updatedAt: Date.now() }
          : row,
      ),
    }));
    notify(`已更新 ${selected.size} 条记录`);
    setBulkProperty('');
  };
  const props: ViewProps = {
    page,
    view,
    rows,
    columns,
    updateView: changeView,
    editProperty: setProperty,
    updateOptions: options,
    onCategoryCreated: queueCategory,
    openRow,
    addRow,
    selected,
    selectRow,
  };
  const filterCount = (group = view.filters): number =>
    group?.rules.reduce((count, rule) => count + ('rules' in rule ? filterCount(rule) : 1), 0) || 0;
  const menuView = views.find((v) => v.id === menu?.id) || view;

  return (
    <div
      className={`database saved-view-database ${Object.values(view.appearance || {}).some((value) => value && value !== 'default') ? 'styled-database' : ''}`}
      data-database-id={page.id}
      style={viewAppearanceStyle(view.appearance, theme, workspace!.settings.appearance)}
    >
      <div className="database-toolbar">
        <div className="view-tabs" ref={tabsRef}>
          {views.map((item) => {
            const Icon = viewTypes.find((type) => type.type === item.type)!.icon;
            return (
              <button
                key={item.id}
                draggable={!page.locked}
                className={item.id === view.id ? 'active' : ''}
                data-view-id={item.id}
                title={item.name}
                aria-haspopup="menu"
                aria-pressed={item.id === view.id}
                aria-expanded={menu?.type === 'view' && menu.id === item.id}
                onClick={(e) => {
                  if (item.id === view.id) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ type: 'view', id: item.id, x: r.left, y: r.bottom + 5 });
                  } else {
                    chooseView(item.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ type: 'view', id: item.id, x: e.clientX, y: e.clientY });
                }}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const index = views.findIndex(candidate => candidate.id === item.id);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
                    chooseView(views[next].id);
                    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[data-view-id]')[next]?.focus();
                  }
                  if (event.key === 'ArrowDown' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ type: 'view', id: item.id, x: rect.left, y: rect.bottom + 5 });
                  }
                  if (event.key === 'F2' && !page.locked) {
                    event.preventDefault();
                    setRenamingView({ id: item.id, name: item.name });
                  }
                }}
                onDragStart={(e) => e.dataTransfer.setData('application/x-mini-view', item.id)}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('application/x-mini-view')) e.preventDefault();
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('application/x-mini-view');
                  const moved = views.find((v) => v.id === id);
                  if (!moved || id === item.id || page.locked) return;
                  e.preventDefault();
                  const next = views.filter((v) => v.id !== id);
                  next.splice(
                    next.findIndex((v) => v.id === item.id),
                    0,
                    moved,
                  );
                  saveDatabase({ ...db, views: next, activeViewId: view.id });
                }}
              >
                <Icon size={16} />
                <span>{item.name || '无标题视图'}</span>
                {item.id === view.id && <ChevronDown size={12} aria-hidden="true" />}
              </button>
            );
          })}
          <div className="view-tab-actions">
            <IconButton
              label="全部视图"
              onClick={(e) => {
                setViewSearch('');
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ type: 'view-list', x: r.right - 260, y: r.bottom + 5 });
              }}
            >
              <ChevronDown size={14} />
            </IconButton>
            <button
              type="button"
              className="text-button"
              aria-label="添加视图"
              disabled={page.locked}
              onClick={() => setCreatingView(true)}
            >
              <Plus size={17} />
              添加视图
            </button>
          </div>
        </div>
        <div className="database-tools">
          {view.type !== 'form' && (
            <div className="database-search">
              <Search size={14} />
              <input
                aria-label="搜索数据库"
                placeholder="搜索…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
                }}
              />
              {query && <IconButton label="清除数据库搜索" onClick={() => setQuery('')}><X size={13} /></IconButton>}
            </div>
          )}
          {view.type !== 'form' && (
            <IconButton label="筛选" active={!!filterCount()} onClick={(e) => openSettings(e, 'filter')}>
              <Filter size={17} />
            </IconButton>
          )}
          {!['form', 'chart'].includes(view.type) && (
            <IconButton label="排序" active={!!view.sorts?.length} onClick={(e) => openSettings(e, 'sort')}>
              <ArrowDownUp size={17} />
            </IconButton>
          )}
          {['board', 'table', 'list', 'gallery', 'timeline', 'feed'].includes(view.type) && (
            <button type="button" className="database-group-control"
              aria-label="设置分组与分类" title="选择用于分组的属性"
              onClick={(event) => openSettings(event, 'group')}>
              <Columns3 size={15} />
              <span>分组</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          )}
          <IconButton label="自动化" onClick={() => setModal({ type: 'automations', pageId: page.id })}>
            <Zap size={17} />
          </IconButton>
          <IconButton label="数据库设置" onClick={(e) => openSettings(e, 'main')}>
            <Settings2 size={18} />
          </IconButton>
          <div className="database-new-split">
            <button className="primary-button database-new" disabled={page.locked}
              aria-label={view.type === 'board' ? '新增分类' : '新建记录'}
              onClick={event => view.type === 'board'
                ? (canEditCategories && groupingColumn
                  ? openGroupEditor(groupingColumn.id, undefined, event.currentTarget)
                  : setGroupHelp(true))
                : addRow()}>
              {view.type === 'board' ? '新增分类' : '新建'}
            </button>
            <button
              className="database-new-options"
              aria-label={view.type === 'board' ? '新建记录与模板' : '新建模板与选项'}
              disabled={page.locked}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setTemplateMenu({ x: rect.right - 330, y: rect.bottom + 5 });
              }}
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      </div>
      {view.type !== 'form' && (!!filterCount() || (!!view.sorts?.length && view.type !== 'chart')) && (
        <div className="database-active-filters">
          {!!filterCount() && (
            <button onClick={(e) => openSettings(e, 'filter')}>
              <Filter size={12} />
              {filterCount()} 个筛选条件
            </button>
          )}
          {view.type !== 'chart' && !!view.sorts?.length && (
            <button onClick={(e) => openSettings(e, 'sort')}>
              <ArrowDownUp size={12} />
              {view.sorts.length} 个排序
            </button>
          )}
          <button onClick={() => changeView({ filters: emptyFilters(), sorts: [] })}>
            <X size={12} />
            清除
          </button>
        </div>
      )}
      {query.trim() && <div className="database-search-results" role="status">
        {rows.length ? `找到 ${rows.length} 条记录` : '没有匹配的记录'}
        <button onClick={() => setQuery('')}>清除搜索</button>
      </div>}
      {!!selected.size && (
        <div className="database-selection-toolbar">
          <span>已选择 {selected.size} 条记录</span>
          <AppSelect
            aria-label="批量编辑属性"
            value={bulkProperty}
            onChange={(e) => {
              setBulkProperty(e.target.value);
              setBulkValue('');
            }}
          >
            <option value="">编辑属性…</option>
            {db.columns
              .filter((c) => !isReadOnlyProperty(c) && c.type !== 'relation')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </AppSelect>
          {bulkProperty && (
            <>
              {db.columns.find((c) => c.id === bulkProperty)?.type === 'person' ? (
                <PeoplePicker label="批量设置的人员" value={bulkValue} onChange={setBulkValue} />
              ) : db.columns.find((c) => c.id === bulkProperty)?.type === 'files' ? (
                <FilesPicker
                  label="批量设置的文件"
                  value={bulkValue}
                  onChange={setBulkValue}
                  onBusyChange={setBulkUploading}
                />
              ) : db.columns.find((c) => c.id === bulkProperty)?.options ? (
                <AppSelect
                  aria-label="批量设置的值"
                  value={String(bulkValue)}
                  onChange={(e) => setBulkValue(e.target.value)}
                >
                  <option value="">清空</option>
                  {db.columns
                    .find((c) => c.id === bulkProperty)
                    ?.options?.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                </AppSelect>
              ) : db.columns.find((c) => c.id === bulkProperty)?.type === 'checkbox' ? (
                <AppSelect
                  aria-label="批量设置的值"
                  value={String(bulkValue)}
                  onChange={(e) => setBulkValue(e.target.value)}
                >
                  <option value="false">未勾选</option>
                  <option value="true">已勾选</option>
                </AppSelect>
              ) : db.columns.find((c) => c.id === bulkProperty)?.type === 'date' ? (
                <DateInput label="批量设置的日期" value={bulkValue} onChange={setBulkValue} />
              ) : (
                <input
                  type={db.columns.find((c) => c.id === bulkProperty)?.type === 'number' ? 'number' : 'text'}
                  aria-label="批量设置的值"
                  value={String(bulkValue)}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder="输入新值"
                />
              )}
              <button className="text-button" disabled={page.locked || bulkUploading} onClick={applyBulk}>
                <Check size={14} />
                应用
              </button>
            </>
          )}
          <button className="text-button danger" disabled={page.locked} onClick={deleteSelected}>
            <Trash2 size={14} />
            移到回收站
          </button>
          <IconButton label="取消选择" onClick={() => setSelected(new Set())}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {view.type === 'table' && <TableView {...props} />}
      {view.type === 'board' && <BoardView {...props} />}
      {view.type === 'gallery' && <GalleryView {...props} />}
      {view.type === 'list' && <ListView {...props} />}
      {view.type === 'calendar' && (
        <CalendarView page={page} rows={rows} view={view} onViewChange={changeView} openRow={openRow} />
      )}
      {view.type === 'timeline' && <TimelineView {...props} />}
      {view.type === 'plan' && <PlanView {...props} />}
      {view.type === 'chart' && <ChartView {...props} />}
      {view.type === 'feed' && <FeedView {...props} />}
      {view.type === 'form' && <FormView {...props} />}
      {structure && (
        <StructureSettings
          page={page}
          view={view}
          onViewChange={changeView}
          onClose={() => setStructure(false)}
        />
      )}
      {templateMenu && (
        <TemplateMenu
          page={page}
          view={view}
          {...templateMenu}
          onClose={() => setTemplateMenu(null)}
          onNew={(templateId) => addRow({}, templateId)}
          onViewDefault={(id) => changeView({ defaultTemplateId: id })}
        />
      )}
      {creatingView && <CreateViewDialog onCreate={addView} onClose={() => setCreatingView(false)} />}
      {renamingView && (
        <Modal title="重命名视图" onClose={() => setRenamingView(null)}>
          <form
            className="modal-body"
            onSubmit={(event) => {
              event.preventDefault();
              const name = renamingView.name.trim();
              if (!name || page.locked) return;
              saveDatabase(updateView(db, renamingView.id, { name }));
              setRenamingView(null);
            }}
          >
            <label className="field-label">
              视图名称
              <input
                autoFocus
                aria-label="视图名称"
                value={renamingView.name}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setRenamingView({ ...renamingView, name: event.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setRenamingView(null)}>
                取消
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={page.locked || !renamingView.name.trim()}
              >
                保存
              </button>
            </div>
          </form>
        </Modal>
      )}
      {menu?.type === 'view-list' && (
        <Popover x={menu.x} y={menu.y} width={280} onClose={() => setMenu(null)}>
          <div className="picker-heading">全部视图 · {views.length}</div>
          <div className="view-switcher-search">
            <Search size={15} aria-hidden="true" />
            <input autoFocus aria-label="搜索视图" placeholder="查找视图…" value={viewSearch}
              onChange={event => setViewSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && matchingViews.length) {
                  chooseView(matchingViews[0].id);
                  setMenu(null);
                }
              }} />
          </div>
          <div className="view-switcher-list">
            {matchingViews.map((item) => {
              const Icon = viewTypes.find((type) => type.type === item.type)!.icon;
              return (
                <div key={item.id} className="view-switcher-row">
                  <MenuItem
                    icon={<Icon size={16} />}
                    checked={item.id === view.id}
                    onClick={() => {
                      chooseView(item.id);
                      setMenu(null);
                    }}
                  >
                    {item.name}
                  </MenuItem>
                  <IconButton
                    label={`${item.name} 的视图操作`}
                    onClick={() => setMenu({ ...menu, type: 'view', id: item.id })}
                  >
                    <MoreHorizontal size={15} />
                  </IconButton>
                </div>
              );
            })}
            {!matchingViews.length && <p className="view-switcher-empty">没有匹配的视图</p>}
          </div>
          <div className="menu-divider" />
          <MenuItem
            icon={<Plus size={15} />}
            disabled={page.locked}
            onClick={() => {
              setMenu(null);
              setCreatingView(true);
            }}
          >
            添加视图
          </MenuItem>
        </Popover>
      )}
      {menu?.type === 'settings' && (
        <Popover
          x={menu.x}
          y={menu.y}
          width={['filter', 'conditional'].includes(menu.section || '') ? 580 : 380}
          onClose={() => setMenu(null)}
        >
          <ViewSettings
            key={menu.section}
            view={view}
            database={db}
            section={menu.section}
            onSectionChange={(section) => setMenu({ ...menu, section })}
            onChange={changeView}
            locked={!!page.locked}
            onManageGroup={(column, value, trigger) => {
              setMenu(null);
              openGroupEditor(column.id, value, trigger);
            }}
            onEditProperty={(column) => {
              setMenu(null);
              setProperty(column);
            }}
            onStructure={() => {
              setMenu(null);
              setStructure(true);
            }}
            onAddProperty={() => {
              setMenu(null);
              setProperty({ id: crypto.randomUUID(), name: '', type: 'text' });
            }}
          />
        </Popover>
      )}
      {menu?.type === 'view' && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} width={255}>
          <div className="picker-heading">{menuView.name}</div>
          <MenuItem
            icon={<Pencil size={15} />}
            disabled={page.locked}
            onClick={() => {
              setRenamingView({ id: menuView.id, name: menuView.name });
              setMenu(null);
            }}
          >
            重命名视图
          </MenuItem>
          <MenuItem
            icon={<Settings2 size={15} />}
            onClick={() => {
              chooseView(menuView.id);
              setMenu({ ...menu, type: 'settings', section: 'main' });
            }}
          >
            编辑视图
          </MenuItem>
          <MenuItem
            icon={<LayoutGrid size={15} />}
            disabled={page.locked}
            onClick={() => {
              chooseView(menuView.id);
              setMenu({ ...menu, type: 'settings', section: 'layout' });
            }}
          >
            布局
          </MenuItem>
          <MenuItem
            icon={<Copy size={15} />}
            disabled={page.locked}
            onClick={() =>
              addView({
                ...structuredClone(menuView),
                id: crypto.randomUUID(),
                name: `${menuView.name}（副本）`,
              })
            }
          >
            复制视图
          </MenuItem>
          <MenuItem
            icon={<Trash2 size={15} />}
            danger
            disabled={page.locked || views.length <= 1}
            onClick={() => {
              const next = views.filter((v) => v.id !== menuView.id);
              const selected = next.find((v) => v.id === view.id) || next[0];
              saveDatabase({ ...db, views: next, activeViewId: selected.id, view: selected.type });
              setMenu(null);
            }}
          >
            删除视图
          </MenuItem>
          <div className="menu-divider" />
          <MenuItem
            icon={<Plus size={15} />}
            disabled={page.locked}
            onClick={() => {
              setMenu(null);
              setCreatingView(true);
            }}
          >
            添加视图
          </MenuItem>
        </Popover>
      )}
      {groupHelp && (
        <Modal title="选择分类属性" onClose={() => setGroupHelp(false)} className="group-setup-dialog">
          <div className="modal-body">
            <p className="view-settings-description">
              {groupingColumn
                ? `当前按「${groupingColumn.name}」分组，该属性不能预设空分类。`
                : '当前视图没有可编辑的分类属性。'}
              切换为状态、单选或多选属性后，即可直接创建分类。原来的属性及记录数据都会保留。
            </p>
            {db.columns.filter(column => ['status', 'select', 'multiSelect'].includes(column.type)).map(column => (
              <button key={column.id} className="group-setup-choice" onClick={() => {
                if (view.groupBy !== column.id) changeView({ groupBy: column.id });
                setGroupHelp(false);
                openGroupEditor(column.id);
              }}>
                <span>使用「{column.name}」分类</span>
                <ChevronDown size={14} />
              </button>
            ))}
            <button className="group-setup-choice" disabled={page.locked} onClick={() => {
              try {
                const name = db.columns.some(column => column.name === '分类') ? '新分类' : '分类';
                const column = command('property.add', { databaseId: page.id, name, type: 'select' }) as Property;
                setPendingGroupColumn({ viewId: view.id, columnId: column.id });
                setGroupHelp(false);
              } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
            }}>
              <Plus size={15} /> 创建新的单选分类属性
            </button>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setGroupHelp(false)}>取消</button></div>
          </div>
        </Modal>
      )}
      {groupEditor && db.columns.some((column) => column.id === groupEditor.columnId) && (
        <GroupOptionEditor
          key={`${groupEditor.columnId}:${groupEditor.value ?? 'new'}`}
          page={page}
          column={db.columns.find((column) => column.id === groupEditor.columnId)!}
          value={groupEditor.value}
          anchor={groupEditor.anchor}
          revealViewId={groupEditor.viewId}
          onClose={() => setGroupEditor(null)}
          onCreated={(name) => {
            // Renaming or recoloring an existing category must preserve the
            // view's hide-empty preference. Only a new empty option is revealed.
            if (groupEditor.value === undefined)
              queueCategory(groupEditor.viewId, groupEditor.columnId, name);
          }}
        />
      )}
      {property && (
        <PropertyEditor
          page={page}
          column={property}
          onClose={() => setProperty(null)}
          onSave={(column, optionRenames) => {
            try {
              if (db.columns.some((value) => value.id === column.id))
                command('property.update', {
                  databaseId: page.id,
                  propertyId: column.id,
                  changes: column,
                  optionRenames,
                });
              else command('property.add', { databaseId: page.id, definition: column });
              return true;
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error));
              return false;
            }
          }}
          onDelete={
            db.columns.some((column) => column.id === property.id)
              ? () => {
                  try {
                    command('property.delete', { databaseId: page.id, propertyId: property.id });
                    return true;
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error));
                    return false;
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
