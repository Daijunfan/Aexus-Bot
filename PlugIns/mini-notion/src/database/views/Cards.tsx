import { EventIndicators } from '../../components/EventSummary';
import { eventSignals, eventValue } from '../../scheduling/presentation';
import { CoverImage } from '../../components/CoverImage';
import { coverPresentation } from '../../presentation';
import { isSelectProperty, isReadOnlyProperty, workspacePeople } from '../propertySchema';
import { useContext, useEffect, useMemo, useRef, type CSSProperties, type DragEvent } from 'react';
import { AppearanceTheme, recordAppearanceStyle } from '../../appearance';
import { Calendar, ChevronRight, Plus } from 'lucide-react';
import { BlockPreview } from '../../components/BlockPreview';
import type { JsonBlock } from '../../types';
import { useWorkspace } from '../../store';
import { PageIcon, IconButton, formatDate } from '../../ui';
import { plainText, readProperty } from '../../model';
import { groupRows, valueForGroup, conditionalColor } from '../model';
import { moveManualRecord } from '../manualOrdering';
import { conditionalColorStyle } from '../conditionalColors';
import { PropertyValue, Tag, optionTone } from '../Properties';
import { propertyColors } from '../propertySchema';
import type { Page, PersonValue, Property, Workspace } from '../../types';
import type { ViewProps } from './types';
import { hierarchyRows, subItemDisplay } from '../structure';
import { RecordTitle, SubitemPreview } from '../RecordTitle';
import { AddGroupButton, GroupHeader } from '../GroupControls';
import { WindowedCards } from './WindowedCards';

function RecordCard({
  row,
  props,
  gallery = false,
  groupKey = '',
  subGroupKey = '',
  onDropCard,
  onKeyboardMove,
}: {
  row: Page;
  props: ViewProps;
  gallery?: boolean;
  groupKey?: string;
  subGroupKey?: string;
  onDropCard?: (event: DragEvent<HTMLDivElement>, targetId: string, after: boolean) => void;
  onKeyboardMove?: (direction: -1 | 1) => void;
}) {
  const { setPageMenu, workspace } = useWorkspace();
  const theme = useContext(AppearanceTheme);
  const { view, page, openRow, columns } = props;
  const signals = eventSignals(row, workspace!.pages);
  const preview = view.cardPreview || (gallery ? 'content' : 'none');
  const readOnlyGroup = [view.groupBy, view.subGroupBy].some((id) =>
    page.database!.columns.some(
      (column) => column.id === id && (isReadOnlyProperty(column) || column.type === 'files'),
    ),
  );
  return (
    <div
      role="button"
      tabIndex={0}
      className={`database-card ${gallery ? 'gallery-card' : ''}`}
      style={{
        ...recordAppearanceStyle(row, theme, workspace!.settings.appearance),
        ...conditionalColorStyle(conditionalColor(row, view, page.database!, workspace!.pages), theme),
      }}
      data-record-id={row.id}
      draggable={!page.locked && !row.locked && (!readOnlyGroup || !!onDropCard) && (!onDropCard || !view.sorts?.length)}
      title={onDropCard ? (view.sorts?.length ? '请先移除属性排序，再手动排列卡片' : 'Alt+↑/↓ 调整卡片顺序') : undefined}
      aria-keyshortcuts={onKeyboardMove ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-mini-row', row.id);
        e.dataTransfer.setData('application/x-mini-row-group', groupKey);
        e.dataTransfer.setData('application/x-mini-row-subgroup', subGroupKey);
      }}
      onDragEnd={onDropCard ? (e) => {
        e.currentTarget.closest('.board-outer, .gallery-view')?.querySelectorAll('.drag-over, .drop-before, .drop-after')
          .forEach(element => element.classList.remove('drag-over', 'drop-before', 'drop-after'));
      } : undefined}
      onDragOver={onDropCard ? (e) => {
        if (page.locked || view.sorts?.length || !e.dataTransfer.types.includes('application/x-mini-row')) return;
        e.preventDefault();
        e.stopPropagation();
        const bounds = e.currentTarget.getBoundingClientRect();
        const after = gallery ? e.clientX > bounds.left + bounds.width / 2 : e.clientY > bounds.top + bounds.height / 2;
        e.currentTarget.classList.toggle('drop-after', after);
        e.currentTarget.classList.toggle('drop-before', !after);
      } : undefined}
      onDragLeave={onDropCard ? (e) => {
        e.currentTarget.classList.remove('drop-before', 'drop-after');
      } : undefined}
      onDrop={onDropCard ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        const bounds = e.currentTarget.getBoundingClientRect();
        const after = gallery ? e.clientX > bounds.left + bounds.width / 2 : e.clientY > bounds.top + bounds.height / 2;
        e.currentTarget.classList.remove('drop-before', 'drop-after');
        e.currentTarget.closest('.board-column')?.classList.remove('drag-over');
        onDropCard(e, row.id, after);
      } : undefined}
      onClick={() => openRow(row.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (onKeyboardMove && event.altKey && !event.ctrlKey && !event.metaKey &&
          (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          event.stopPropagation();
          onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openRow(row.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setPageMenu({ id: row.id, x: e.clientX, y: e.clientY });
      }}
    >
      {preview !== 'none' && (
        <div
          className={`gallery-preview ${preview === 'cover' ? coverPresentation(row.cover).className : ''}`}
          style={preview === 'cover' ? coverPresentation(row.cover, row.coverPosition, true).style : undefined}
        >
          {preview === 'cover' && <CoverImage url={row.cover} />}
          {(preview === 'content' || !row.cover) && <span>{plainText(row.blocks).slice(0, 240)}</span>}
        </div>
      )}
      <div className="database-card-body">
        <strong>
          <PageIcon icon={row.icon} size={16} />
          {row.title || '无标题'}
        </strong>
        {(signals.repeat || signals.reminders > 0) && (
          <span className="record-event-flags">
            <EventIndicators {...signals} />
          </span>
        )}
        {columns
          .filter(
            (c) =>
              c.id !== view.groupBy &&
              !(c.system === 'subItems' && page.database!.subItems && subItemDisplay(view) === 'card'),
          )
          .map((column) => {
            const value = readProperty(row, column, workspace!.pages);
            if (value === '' || value === false || (Array.isArray(value) && !value.length)) return null;
            if (isSelectProperty(column) || column.type === 'multiSelect')
              return (
                <div className="database-card-tags" key={column.id}>
                  {(Array.isArray(value) ? value : [String(value)]).map((value) => (
                    <Tag key={value} value={value} options={column.options} column={column} />
                  ))}
                </div>
              );
            return (
              <small key={column.id}>
                {column.type === 'date' && <Calendar size={12} />}
                <span>{eventValue(value, workspace!.pages)}</span>
              </small>
            );
          })}
        {page.database!.subItems && subItemDisplay(view) === 'card' && (
          <SubitemPreview row={row} onOpen={openRow} />
        )}
      </div>
    </div>
  );
}

function edgeScrollSpeed(position: number, start: number, end: number) {
  const edge = 56;
  const speed = 18;
  if (position < start + edge) return -Math.min(speed, (start + edge - position) * speed / edge);
  if (position > end - edge) return Math.min(speed, (position - end + edge) * speed / edge);
  return 0;
}

function personAwareGroupValue(rows: Page[], workspace: Workspace) {
  const people = workspacePeople(workspace);
  return (
    column: Property | undefined,
    key: string,
    previous?: Page['values'][string],
    from = '',
  ) => {
    if (column?.type !== 'person' || !key) return valueForGroup(column, key, previous, from);
    let assignee = people.find(person => person.id === key);
    if (!assignee) {
      for (const row of rows) {
        assignee = ((row.values[column.id] || []) as PersonValue[]).find(person => person.id === key);
        if (assignee) break;
      }
    }
    return valueForGroup(column, key, previous, from, assignee);
  };
}

export function BoardView(props: ViewProps) {
  const { workspace, patch, notify } = useWorkspace();
  const { rows, view, page, updateView, addRow } = props;
  const dragPointer = useRef<{ x: number; y: number; horizontal: HTMLElement; vertical: HTMLElement | null } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const stopDragScroll = () => {
    dragPointer.current = null;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
  };
  const scrollWhileDragging = () => {
    dragFrame.current = null;
    const pointer = dragPointer.current;
    if (!pointer) return;
    const horizontal = pointer.horizontal;
    const horizontalBounds = horizontal.getBoundingClientRect();
    const dx = edgeScrollSpeed(pointer.x, horizontalBounds.left, horizontalBounds.right);
    const previousLeft = horizontal.scrollLeft;
    horizontal.scrollLeft += dx;
    const vertical = pointer.vertical;
    const verticalBounds = vertical?.getBoundingClientRect();
    const dy = verticalBounds ? edgeScrollSpeed(pointer.y, verticalBounds.top, verticalBounds.bottom) : 0;
    const previousTop = vertical?.scrollTop;
    if (vertical) vertical.scrollTop += dy;
    if (horizontal.scrollLeft !== previousLeft || vertical?.scrollTop !== previousTop)
      dragFrame.current = requestAnimationFrame(scrollWhileDragging);
  };
  const trackDragScroll = (event: DragEvent<HTMLDivElement>) => {
    if (page.locked || view.sorts?.length || !event.dataTransfer.types.includes('application/x-mini-row')) return;
    const horizontal = (event.target as Element).closest<HTMLElement>('.board-view');
    if (!horizontal) return;
    dragPointer.current = {
      x: event.clientX,
      y: event.clientY,
      horizontal,
      vertical: horizontal.closest<HTMLElement>('.page-scroll'),
    };
    if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(scrollWhileDragging);
  };
  useEffect(() => () => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
  }, []);
  const groupBy = view.groupBy || page.database!.columns.find((c) => isSelectProperty(c))?.id;
  const groupProperty = page.database!.columns.find(column => column.id === groupBy);
  const coloredColumns = view.colorColumns !== false &&
    !!groupProperty && ['select', 'status', 'multiSelect'].includes(groupProperty.type);
  const readOnlyGroup = [groupBy, view.subGroupBy].some((id) =>
    page.database!.columns.some(
      (column) => column.id === id && (isReadOnlyProperty(column) || column.type === 'files'),
    ),
  );
  const { groups, subgroups, cardsBySubgroup } = useMemo(() => {
    const groups = groupRows(rows, groupBy, page.database!, workspace!.pages, view);
    const subgroups = groupRows(rows, view.subGroupBy, page.database!, workspace!.pages);
    if (!view.subGroupBy) return { groups, subgroups, cardsBySubgroup: null };

    const memberships = new Map<Page, Set<string>>();
    for (const subgroup of subgroups) {
      for (const row of subgroup.rows) {
        let keys = memberships.get(row);
        if (!keys) memberships.set(row, (keys = new Set()));
        keys.add(subgroup.key);
      }
    }
    const cardsBySubgroup = new Map(subgroups.map(subgroup => [
      subgroup.key, new Map(groups.map(group => [group.key, [] as Page[]])),
    ]));
    for (const group of groups) {
      for (const row of group.rows) {
        for (const subKey of memberships.get(row) || []) {
          cardsBySubgroup.get(subKey)!.get(group.key)!.push(row);
        }
      }
    }
    return { groups, subgroups, cardsBySubgroup };
  }, [rows, groupBy, view, page.database, workspace!.pages]);
  const groupKeys = useMemo(() => groups.map(group => group.key), [groups]);
  const orderedRowIds = useMemo(() => rows.map(row => row.id), [rows]);
  const groupValue = personAwareGroupValue(rows, workspace!);
  const layoutKey = JSON.stringify([view.cardSize, view.cardPreview, props.columns, page.database!.subItems, view.subItemDisplay]);
  const valuesInGroup = (key: string, subKey: string) => ({
    ...(groupBy ? { [groupBy]: groupValue(page.database!.columns.find(column => column.id === groupBy), key) } : {}),
    ...(view.subGroupBy && subKey !== '__all' ? { [view.subGroupBy]: groupValue(page.database!.columns.find(column => column.id === view.subGroupBy), subKey) } : {}),
  });
  const moveCard = (event: DragEvent, destination: string, subDestination: string, target?: string, after = false) => {
    const id = event.dataTransfer.getData('application/x-mini-row');
    const row = rows.find(item => item.id === id);
    if (!row || page.locked || row.locked || view.sorts?.length || id === target) return;
    const from = event.dataTransfer.getData('application/x-mini-row-group');
    const fromSub = event.dataTransfer.getData('application/x-mini-row-subgroup');
    const changedGroup = from !== destination || (view.subGroupBy && fromSub !== subDestination);
    if (changedGroup && readOnlyGroup) {
      notify('这个分组包含只读或计算属性，只能在当前列调整卡片顺序');
      return;
    }
    if (changedGroup) {
      patch(row.id, {
        values: {
          ...row.values,
          ...(groupBy ? { [groupBy]: groupValue(
            page.database!.columns.find(column => column.id === groupBy), destination,
            row.values[groupBy], from,
          ) } : {}),
          ...(view.subGroupBy && subDestination !== '__all' ? {
            [view.subGroupBy]: groupValue(
              page.database!.columns.find(column => column.id === view.subGroupBy),
              subDestination, row.values[view.subGroupBy], fromSub,
            ),
          } : {}),
        },
      });
    }
    updateView({ manualOrder: moveManualRecord(view.manualOrder, rows.map(item => item.id), id, target, after) });
  };
  return (
    <div className={`board-outer card-size-${view.cardSize || 'medium'}`}
      onDragOverCapture={trackDragScroll} onDragEndCapture={stopDragScroll}
      onDropCapture={stopDragScroll}>
      {subgroups.map((subgroup) => {
        return (
          <section key={subgroup.key} data-subgroup-key={subgroup.key}>
          {view.subGroupBy && (
            <div className="database-group-heading">
              <strong>{subgroup.label}</strong>
              <span>{subgroup.rows.length}</span>
            </div>
          )}
          <div className="board-view">
            {groups.map((group) => {
              const records = cardsBySubgroup
                ? cardsBySubgroup.get(subgroup.key)!.get(group.key)!
                : group.rows;
              const candidateTone = coloredColumns && group.key ? optionTone(group.key, groupProperty) : '';
              const tone = propertyColors.includes(candidateTone) ? candidateTone : '';
              return (
                <div
                  className={`board-column${tone ? ' board-column-tinted' : ''}`}
                  data-color-tone={tone || undefined}
                  style={tone ? { '--board-column-tint': `var(--content-${tone}-background)` } as CSSProperties : undefined}
                  data-group-key={group.key}
                  key={group.key}
                  onDragOver={(e) => {
                    if (
                      !page.locked &&
                      !view.sorts?.length &&
                      e.dataTransfer.types.includes('application/x-mini-row')
                    ) {
                      e.preventDefault();
                      e.currentTarget.classList.add('drag-over');
                    }
                  }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drag-over');
                    const movingId = e.dataTransfer.getData('application/x-mini-row');
                    const last = [...records].reverse().find(row => row.id !== movingId);
                    moveCard(e, group.key, subgroup.key, last?.id, !!last);
                  }}
                >
                  <GroupHeader page={page} view={view} group={{ ...group, rows: records }} propertyId={groupBy}
                    groupKeys={groupKeys} updateView={updateView} editProperty={props.editProperty}
                    className="board-column-title" onAdd={readOnlyGroup ? undefined : () => addRow(valuesInGroup(group.key, subgroup.key))} />
                  {!view.collapsedGroups?.includes(group.key) && (
                    <WindowedCards rows={records} enabled={rows.length > 200} className="board-cards"
                      layoutKey={layoutKey}
                      footer={<button className="board-add" disabled={readOnlyGroup || page.locked}
                        onClick={() => addRow(valuesInGroup(group.key, subgroup.key))}>
                        <Plus size={15} />新建
                      </button>}>
                      {(row, index) => (
                        <RecordCard key={row.id} row={row} props={props} groupKey={group.key}
                          subGroupKey={subgroup.key}
                          onDropCard={(event, targetId, after) => moveCard(event, group.key, subgroup.key, targetId, after)}
                          onKeyboardMove={page.locked || row.locked || view.sorts?.length ? undefined : direction => {
                            const neighbor = records[index + direction];
                            if (!neighbor) return;
                            updateView({ manualOrder: moveManualRecord(view.manualOrder, orderedRowIds,
                              row.id, neighbor.id, direction === 1) });
                          }} />
                      )}
                    </WindowedCards>
                  )}
                </div>
              );
            })}
            {subgroup.key === subgroups[0]?.key && (
              <AddGroupButton page={page} view={view} propertyId={groupBy}
                updateView={updateView} placement="board-end"
                onCreated={name => groupBy && props.onCategoryCreated?.(view.id, groupBy, name)} />
            )}
          </div>
          </section>
        );
      })}
    </div>
  );
}

export function GalleryView(props: ViewProps) {
  const { workspace, patch, notify } = useWorkspace();
  const groups = useMemo(() => groupRows(
    props.rows,
    props.view.groupBy,
    props.page.database!,
    workspace!.pages,
    props.view,
  ), [props.rows, props.view, props.page.database, workspace!.pages]);
  const groupKeys = useMemo(() => groups.map(group => group.key), [groups]);
  const orderedRowIds = useMemo(() => props.rows.map(row => row.id), [props.rows]);
  const groupProperty = props.page.database!.columns.find(column => column.id === props.view.groupBy);
  const groupValue = personAwareGroupValue(props.rows, workspace!);
  const readOnlyGroup = !!groupProperty && (isReadOnlyProperty(groupProperty) || groupProperty.type === 'files');
  const moveCard = (event: DragEvent, destination: string, target?: string, after = false) => {
    const id = event.dataTransfer.getData('application/x-mini-row');
    const row = props.rows.find(item => item.id === id);
    if (!row || props.page.locked || row.locked || props.view.sorts?.length || id === target) return;
    const from = event.dataTransfer.getData('application/x-mini-row-group');
    if (from !== destination && readOnlyGroup) {
      notify('这个分组由只读属性计算，只能在当前分组调整卡片顺序');
      return;
    }
    if (from !== destination && props.view.groupBy) patch(row.id, {
      values: {
        ...row.values,
        [props.view.groupBy]: groupValue(groupProperty, destination, row.values[props.view.groupBy], from),
      },
    });
    props.updateView({ manualOrder: moveManualRecord(props.view.manualOrder, orderedRowIds, id, target, after) });
  };
  const layoutKey = JSON.stringify([
    props.view.cardSize, props.view.cardPreview, props.columns,
    props.page.database!.subItems, props.view.subItemDisplay,
  ]);
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} data-group-key={group.key}
          onDragOver={event => {
            if (!props.page.locked && !props.view.sorts?.length &&
              event.dataTransfer.types.includes('application/x-mini-row')) event.preventDefault();
          }}
          onDrop={event => {
            event.preventDefault();
            const last = [...group.rows].reverse().find(row => row.id !== event.dataTransfer.getData('application/x-mini-row'));
            moveCard(event, group.key, last?.id, !!last);
          }}>
          {props.view.groupBy && <GroupHeader page={props.page} view={props.view} group={group}
            groupKeys={groupKeys} updateView={props.updateView} editProperty={props.editProperty} />}
          {!props.view.collapsedGroups?.includes(group.key) && (
          <WindowedCards rows={group.rows} enabled={props.rows.length > 200} gallery
            className={`gallery-view card-size-${props.view.cardSize || 'medium'}`}
            layoutKey={layoutKey}
            footer={<button className="gallery-add" disabled={props.page.locked} onClick={() => props.addRow(props.view.groupBy ? { [props.view.groupBy]: groupValue(props.page.database!.columns.find(column => column.id === props.view.groupBy), group.key) } : undefined)}>
              <Plus size={20} />新建页面
            </button>}>
            {(row, index) => <RecordCard key={row.id} row={row} props={props} gallery groupKey={group.key}
              onDropCard={(event, targetId, after) => moveCard(event, group.key, targetId, after)}
              onKeyboardMove={props.page.locked || row.locked || props.view.sorts?.length ? undefined : direction => {
                const neighbor = group.rows[index + direction];
                if (!neighbor) return;
                props.updateView({ manualOrder: moveManualRecord(props.view.manualOrder, orderedRowIds,
                  row.id, neighbor.id, direction === 1) });
              }} />}
          </WindowedCards>)}
        </section>
      ))}
    </>
  );
}

export function ListView(props: ViewProps) {
  const { workspace } = useWorkspace();
  const theme = useContext(AppearanceTheme);
  const { rows, view, page, columns, openRow, updateOptions, addRow, updateView } = props;
  const groups = useMemo(() => groupRows(rows, view.groupBy, page.database!, workspace!.pages, view),
    [rows, view, page.database, workspace!.pages]);
  const groupKeys = useMemo(() => groups.map(group => group.key), [groups]);
  const groupValue = personAwareGroupValue(rows, workspace!);
  const groupedRows = useMemo(() => groups.map(group => {
    const entries = hierarchyRows(group.rows, view, !!page.database!.subItems);
    return {
      group,
      pages: entries.map(entry => entry.page),
      entryById: new Map(entries.map(entry => [entry.page.id, entry])),
    };
  }), [groups, view, page.database]);
  const layoutKey = JSON.stringify([view.subItemDisplay, view.collapsedItems,
    columns.map(column => [column.id, column.type]), page.database!.subItems]);
  return (
    <div className="database-list">
      {groupedRows.map(({ group, pages, entryById }) => (
        <section key={group.key} data-group-key={group.key}>
          {view.groupBy && <GroupHeader page={page} view={view} group={group}
            groupKeys={groupKeys} updateView={updateView} editProperty={props.editProperty}
            onAdd={() => addRow({ [view.groupBy!]: groupValue(page.database!.columns.find(column => column.id === view.groupBy), group.key) })} />}
          {!view.collapsedGroups?.includes(group.key) && (
            <WindowedCards rows={pages} enabled={rows.length > 200}
              className="database-list-rows" layoutKey={layoutKey} estimatedHeight={42}
              footer={<button className="database-add-row" disabled={page.locked}
                onClick={() => addRow(view.groupBy ? { [view.groupBy]: groupValue(
                  page.database!.columns.find(column => column.id === view.groupBy), group.key,
                ) } : undefined)}>
                <Plus size={16} />新建页面
              </button>}>
              {(row) => (
                <div className="database-list-row" key={row.id} data-record-id={row.id} tabIndex={-1}
                  style={conditionalColorStyle(
                    conditionalColor(row, view, page.database!, workspace!.pages), theme,
                  )}>
                  <RecordTitle entry={entryById.get(row.id)!} database={page} view={view}
                    onViewChange={updateView} onOpen={openRow} />
                  {columns.map(column => (
                    <div key={column.id}>
                      <PropertyValue column={column} page={row}
                        disabled={page.locked || row.locked}
                        onOptionsChange={options => updateOptions(column, options)} />
                    </div>
                  ))}
                </div>
              )}
            </WindowedCards>
          )}
        </section>
      ))}
    </div>
  );
}

export function FeedView(props: ViewProps) {
  const { patch, workspace } = useWorkspace();
  const theme = useContext(AppearanceTheme);
  const groups = useMemo(() => groupRows(
    props.rows, props.view.groupBy, props.page.database!, workspace!.pages, props.view,
  ), [props.rows, props.view, props.page.database, workspace!.pages]);
  const groupKeys = useMemo(() => groups.map(group => group.key), [groups]);
  const layoutKey = JSON.stringify([props.columns.map(column => column.id), props.view.appearance]);
  const toggle = (row: Page, path: number[], checked: boolean) => {
    const update = (blocks: JsonBlock[], depth = 0): JsonBlock[] =>
      blocks.map((block, index) =>
        index !== path[depth]
          ? block
          : depth === path.length - 1
            ? { ...block, props: { ...block.props, checked } }
            : { ...block, children: update(block.children || [], depth + 1) },
      );
    patch(row.id, { blocks: update(row.blocks) });
  };
  return (
    <div className="feed-view">
      {groups.map(group => (
        <section key={group.key} data-group-key={group.key}>
          {props.view.groupBy && <GroupHeader page={props.page} view={props.view} group={group}
            groupKeys={groupKeys} updateView={props.updateView} editProperty={props.editProperty} />}
          {!props.view.collapsedGroups?.includes(group.key) && (
            <WindowedCards rows={group.rows} enabled={props.rows.length > 200}
              className="feed-window" layoutKey={layoutKey} estimatedHeight={380} footer={null}>
              {row => (
                <article
            key={row.id}
            className="feed-record"
            data-record-id={row.id}
            style={conditionalColorStyle(
              conditionalColor(row, props.view, props.page.database!, workspace!.pages),
              theme,
            )}
          >
            <div className="feed-record-meta">
              <span className="workspace-avatar">M</span>
              <span>
                我的工作空间<small>{formatDate(row.updatedAt)}</small>
              </span>
              <IconButton label={`打开 ${row.title || '无标题'}`} onClick={() => props.openRow(row.id)}>
                <ChevronRight size={17} />
              </IconButton>
            </div>
            <button className="feed-record-title" onClick={() => props.openRow(row.id)}>
              <PageIcon icon={row.icon} size={24} />
              <h3>{row.title || '无标题'}</h3>
            </button>
            <span className="record-event-flags">
              <EventIndicators {...eventSignals(row, workspace!.pages)} />
            </span>
            <div className="feed-record-properties">
              {props.columns.map((column) => (
                <div key={column.id}>
                  <span>{column.name}</span>
                  <PropertyValue column={column} page={row} disabled={props.page.locked || row.locked} />
                </div>
              ))}
            </div>
            <BlockPreview
              blocks={row.blocks}
              onToggle={
                !props.page.locked && !row.locked ? (path, checked) => toggle(row, path, checked) : undefined
              }
            />
            <button className="text-button" onClick={() => props.openRow(row.id)}>
              打开页面 →
            </button>
                </article>
              )}
            </WindowedCards>
          )}
        </section>
      ))}
      {!props.rows.length && <div className="empty-state">这个视图还没有记录。</div>}
    </div>
  );
}
