import { useContext, useMemo, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, EyeOff, ChevronDown, MoreHorizontal, Plus, Type } from 'lucide-react';
import { useWorkspace } from '../../store';
import { IconButton, PageIcon, Popover, MenuItem } from '../../ui';
import { aggregateRows, conditionalColor, groupRows, valueForGroup } from '../model';
import { PropertyIcon, PropertyValue } from '../Properties';
import type { Aggregate, Page, PersonValue } from '../../types';
import type { ViewProps } from './types';
import { hierarchyRows } from '../structure';
import { RecordTitle } from '../RecordTitle';
import { WindowedTableBody } from './WindowedTableBody';
import { GroupHeader } from '../GroupControls';
import { AppearanceTheme } from '../../appearance';
import { conditionalColorStyle } from '../conditionalColors';
import { actionColumnId, selectionColumnId, tableLayout } from './tableLayout';

export const calculations: [Aggregate, string][] = [
  ['count', '计数全部'],
  ['count_values', '计数非空值'],
  ['count_unique', '计数唯一值'],
  ['empty', '计数空值'],
  ['percent_filled', '非空百分比'],
  ['percent_empty', '空值百分比'],
  ['sum', '求和'],
  ['average', '平均值'],
  ['median', '中位数'],
  ['min', '最小值'],
  ['max', '最大值'],
  ['range', '极差'],
];

export function TableView(props: ViewProps) {
  const {
    page,
    view,
    rows,
    columns,
    updateView,
    editProperty,
    updateOptions,
    openRow,
    addRow,
    selected,
    selectRow,
  } = props;
  const { workspace, setPageMenu } = useWorkspace();
  const theme = useContext(AppearanceTheme);
  const [calculation, setCalculation] = useState<{ property: string; x: number; y: number } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ columnId: string; x: number; y: number } | null>(null);
  const layout = useMemo(() => tableLayout(view, columns), [view, columns]);
  const groups = useMemo(() => groupRows(rows, view.groupBy, page.database!, workspace!.pages, view),
    [rows, view, page.database, workspace!.pages]);
  const groupKeys = useMemo(() => groups.map(group => group.key), [groups]);
  const groupedColumn = page.database!.columns.find(column => column.id === view.groupBy);
  // Selection and popover state should not rebuild thousands of hierarchy rows or calculations.
  const groupEntries = useMemo(() => new Map(groups.map(group => [
    group.key, hierarchyRows(group.rows, view, !!page.database!.subItems),
  ])), [groups, view, page.database]);
  const groupCalculations = useMemo(() => new Map(groups.map(group => [group.key, new Map(
    columns.filter(column => view.calculations?.[column.id]).map(column => [
      column.id, aggregateRows(group.rows, column.id, view.calculations![column.id], page.database!, workspace!.pages),
    ]),
  )])), [groups, columns, view.calculations, page.database, workspace!.pages]);
  const cellClass = (id: string) => [
    layout.offsets.has(id) && 'table-frozen-cell',
    layout.edge === id && 'table-frozen-edge',
    layout.wraps(id) ? 'table-cell-wrap' : 'table-cell-nowrap',
  ].filter(Boolean).join(' ');
  const cellStyle = (id: string, colors?: CSSProperties): CSSProperties => ({
    ...colors,
    ...(layout.offsets.has(id) ? { left: layout.offsets.get(id) } : {}),
  });
  const reorderColumn = (sourceId: string, targetId: string, after: boolean) => {
    if (page.locked || sourceId === targetId) return;
    const valid = new Set(page.database!.columns.map(column => column.id));
    const original = [...new Set([...(view.propertyOrder || []), ...page.database!.columns.map(column => column.id)])]
      .filter(id => valid.has(id));
    const order = original.filter(id => id !== sourceId);
    const position = order.indexOf(targetId);
    if (position < 0 || !valid.has(sourceId)) return;
    order.splice(position + (after ? 1 : 0), 0, sourceId);
    if (order.every((id, index) => id === original[index])) return;
    updateView({ propertyOrder: order });
  };
  const openColumnMenu = (columnId: string, event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHeaderMenu({ columnId, x: rect.left, y: rect.bottom + 4 });
  };
  const resize = (id: string, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const initial = layout.widths.get(id)!;
    const start = event.clientX;
    const header = event.currentTarget.parentElement!;
    const tableElement = header.closest('table');
    const columnElement = Array.from(tableElement?.querySelectorAll('col') || [])
      .find(column => column.dataset.columnId === id);
    let width = initial;
    const move = (e: PointerEvent) => {
      width = Math.max(90, Math.min(600, initial + e.clientX - start));
      if (columnElement) columnElement.style.width = `${width}px`;
      if (tableElement) tableElement.style.width = `${layout.total + width - initial}px`;
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      if (width !== initial) updateView({ columnWidths: { ...view.columnWidths, [id]: width } });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
  };
  const table = (records: Page[], groupKey: string) => {
    const entries = groupEntries.get(groupKey)!;
    return (
    <div className="database-table-wrap">
      <table className="database-table enhanced-table" aria-rowcount={entries.length + 2}
        style={{ width: layout.total, minWidth: layout.total }}>
        <colgroup>{layout.ids.map(id => <col key={id} data-column-id={id} style={{ width: layout.widths.get(id) }} />)}</colgroup>
        <thead>
          <tr>
            <th className={`row-selection ${cellClass(selectionColumnId)}`}
              style={cellStyle(selectionColumnId)}>
              <input
                aria-label="选择所有记录"
                type="checkbox"
                checked={!!records.length && records.every((row) => selected.has(row.id))}
                onChange={(e) => selectRow(records.map(row => row.id), e.target.checked)}
              />
            </th>
            <th className={`title-column ${cellClass('title')}`}
              style={{ ...cellStyle('title'), width: layout.widths.get('title'), minWidth: layout.widths.get('title') }}>
              <button type="button" aria-label="名称列选项" onClick={event => openColumnMenu('title', event)}>
                <Type size={16} />名称<ChevronDown size={12} />
              </button>
              <span className="column-resize" onPointerDown={(e) => resize('title', e)} />
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                className={cellClass(column.id)}
                draggable={!page.locked}
                style={{
                  ...cellStyle(column.id),
                  width: layout.widths.get(column.id),
                  minWidth: layout.widths.get(column.id),
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-mini-property', column.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (page.locked || !e.dataTransfer.types.includes('application/x-mini-property')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX >= rect.left + rect.width / 2;
                  e.currentTarget.classList.toggle('property-drop-before', !after);
                  e.currentTarget.classList.toggle('property-drop-after', after);
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('property-drop-before', 'property-drop-after')}
                onDragEnd={(e) => {
                  e.currentTarget.closest('table')?.querySelectorAll('.property-drop-before, .property-drop-after')
                    .forEach(element => element.classList.remove('property-drop-before', 'property-drop-after'));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('property-drop-before', 'property-drop-after');
                  const id = e.dataTransfer.getData('application/x-mini-property');
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (id) reorderColumn(id, column.id, e.clientX >= rect.left + rect.width / 2);
                }}
              >
                <button type="button" aria-label={`${column.name}列选项`}
                  title="按住 Option 并按 ← 或 → 调整列顺序"
                  onKeyDown={event => {
                    if (page.locked || !event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = event.key === 'ArrowLeft' ? -1 : 1;
                    const index = columns.findIndex(item => item.id === column.id);
                    const neighbor = columns[index + direction];
                    if (neighbor) reorderColumn(column.id, neighbor.id, direction > 0);
                  }}
                  onClick={event => openColumnMenu(column.id, event)}>
                  <PropertyIcon type={column.type} />
                  {column.name}
                  {view.sorts?.find(sort => sort.property === column.id)?.direction === 'asc' ? <ArrowUp size={12} />
                    : view.sorts?.some(sort => sort.property === column.id) ? <ArrowDown size={12} /> : <ChevronDown size={12} />}
                </button>
                <span className="column-resize" onPointerDown={(e) => resize(column.id, e)} />
              </th>
            ))}
            <th className="add-property-cell" style={{ width: layout.widths.get(actionColumnId) }}>
              <IconButton
                label="添加属性"
                disabled={page.locked}
                onClick={() => editProperty({ id: crypto.randomUUID(), name: '', type: 'text' })}
              >
                <Plus size={17} />
              </IconButton>
            </th>
          </tr>
        </thead>
        <WindowedTableBody rows={entries} columnCount={columns.length + 3}
          layoutKey={`${view.wrapCells}:${JSON.stringify(view.columnWrap)}:${JSON.stringify(view.columnWidths)}:${columns.map(column => column.id).join(',')}`}>
          {(entry, index) => {
            const row = entry.page;
            return (
              <tr key={row.id} data-row-id={row.id} aria-rowindex={index + 2}
                style={conditionalColorStyle(conditionalColor(row, view, page.database!, workspace!.pages), theme)}
                className={selected.has(row.id) ? 'selected-row' : ''}>
                <td className={`row-selection ${cellClass(selectionColumnId)}`}
                  style={cellStyle(selectionColumnId)}>
                  <input
                    aria-label={`选择 ${row.title || '无标题'}`}
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) => selectRow(row.id, e.target.checked)}
                  />
                </td>
                <td className={cellClass('title')}
                  style={cellStyle('title', conditionalColorStyle(conditionalColor(row, view, page.database!, workspace!.pages, 'title'), theme))}>
                  <RecordTitle
                    entry={entry}
                    database={page}
                    view={view}
                    onViewChange={updateView}
                    onOpen={openRow}
                  />
                </td>
                {columns.map((column) => (
                  <td key={column.id} className={cellClass(column.id)}
                    style={cellStyle(column.id, conditionalColorStyle(conditionalColor(row, view, page.database!, workspace!.pages, column.id), theme))}>
                    <PropertyValue
                      column={column}
                      page={row}
                      disabled={page.locked || row.locked}
                      wrap={layout.wraps(column.id)}
                      onOptionsChange={(options) => updateOptions(column, options)}
                    />
                  </td>
                ))}
                <td>
                  <IconButton
                    label={`${row.title || '无标题'} 的操作`}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setPageMenu({ id: row.id, x: r.left, y: r.bottom });
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </IconButton>
                </td>
              </tr>
            );
          }}
        </WindowedTableBody>
        <tfoot>
          <tr>
            <td className={cellClass(selectionColumnId)} style={cellStyle(selectionColumnId)} />
            <td className={cellClass('title')} style={cellStyle('title')}>
              <span className="table-total">{records.length} 条记录</span>
            </td>
            {columns.map((column) => (
              <td key={column.id} className={cellClass(column.id)} style={cellStyle(column.id)}>
                <button
                  className="column-calculation"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCalculation({ property: column.id, x: rect.left, y: rect.bottom });
                  }}
                >
                  {view.calculations?.[column.id] ? (
                    <>
                      {calculations.find(([id]) => id === view.calculations![column.id])?.[1]}{' '}
                      <strong>
                        {groupCalculations.get(groupKey)!.get(column.id)}
                        {view.calculations[column.id].startsWith('percent_') ? '%' : ''}
                      </strong>
                    </>
                  ) : (
                    <>
                      计算
                      <ChevronDown size={11} />
                    </>
                  )}
                </button>
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
      <button
        className="database-add-row"
        disabled={page.locked}
        onClick={() =>
          addRow(
            view.groupBy && groupKey && groupKey !== '__all'
              ? {
                  [view.groupBy]: valueForGroup(
                    groupedColumn, groupKey, undefined, '',
                    groupedColumn?.type === 'person'
                      ? ((records[0]?.values[groupedColumn.id] || []) as PersonValue[])
                          .find(person => person.id === groupKey)
                      : undefined,
                  ),
                }
              : undefined,
          )
        }
      >
        <Plus size={16} />
        新建页面
      </button>
    </div>
    );
  };
  return (
    <>
      {groups.map((group) => (
        <section className="database-group" key={group.key} data-group-key={group.key}>
          {view.groupBy && <GroupHeader page={page} view={view} group={group} groupKeys={groupKeys}
            updateView={updateView} editProperty={editProperty} />}
          {!view.collapsedGroups?.includes(group.key) && table(group.rows, group.key)}
        </section>
      ))}
      {headerMenu && (
        <Popover x={headerMenu.x} y={headerMenu.y} onClose={() => setHeaderMenu(null)}
          width={250} label="表格列选项">
          <div className="picker-heading">{headerMenu.columnId === 'title' ? '名称' : columns.find(column => column.id === headerMenu.columnId)?.name}</div>
          {(['asc', 'desc'] as const).map(direction => <MenuItem key={direction} disabled={page.locked}
            icon={direction === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            checked={view.sorts?.some(sort => sort.property === headerMenu.columnId && sort.direction === direction)}
            onClick={() => {
              updateView({ sorts: [{ id: crypto.randomUUID(), property: headerMenu.columnId, direction },
                ...(view.sorts || []).filter(sort => sort.property !== headerMenu.columnId)] });
              setHeaderMenu(null);
            }}>{direction === 'asc' ? '升序排列' : '降序排列'}</MenuItem>)}
          {view.sorts?.some(sort => sort.property === headerMenu.columnId) && <MenuItem disabled={page.locked} onClick={() => {
            updateView({ sorts: view.sorts?.filter(sort => sort.property !== headerMenu.columnId) });
            setHeaderMenu(null);
          }}>移除此列排序</MenuItem>}
          {headerMenu.columnId !== 'title' && <MenuItem icon={<EyeOff size={15} />} disabled={page.locked} onClick={() => {
            updateView({ hiddenProperties: [...(view.hiddenProperties || []), headerMenu.columnId] });
            setHeaderMenu(null);
          }}>隐藏此属性</MenuItem>}
          {headerMenu.columnId !== 'title' && (
            <MenuItem disabled={page.locked} onClick={() => {
              const column = columns.find(column => column.id === headerMenu.columnId);
              setHeaderMenu(null);
              if (column) editProperty(column);
            }}>编辑属性</MenuItem>
          )}
          <MenuItem disabled={page.locked} checked={layout.wraps(headerMenu.columnId)} onClick={() => {
            updateView({ columnWrap: {
              ...view.columnWrap,
              [headerMenu.columnId]: !layout.wraps(headerMenu.columnId),
            } });
            setHeaderMenu(null);
          }}>换行显示内容</MenuItem>
          <MenuItem disabled={page.locked} checked={layout.frozenThrough === headerMenu.columnId} onClick={() => {
            updateView({ frozenThrough: layout.frozenThrough === headerMenu.columnId ? null : headerMenu.columnId });
            setHeaderMenu(null);
          }}>{layout.frozenThrough === headerMenu.columnId ? '取消冻结列' : '冻结到此列'}</MenuItem>
        </Popover>
      )}
      {calculation && (
        <Popover {...calculation} onClose={() => setCalculation(null)} width={220}>
          <div className="picker-heading">列计算</div>
          <MenuItem
            onClick={() => {
              const next = { ...view.calculations };
              delete next[calculation.property];
              updateView({ calculations: next });
              setCalculation(null);
            }}
          >
            无
          </MenuItem>
          {calculations.map(([id, label]) => (
            <MenuItem
              key={id}
              checked={view.calculations?.[calculation.property] === id}
              onClick={() => {
                updateView({ calculations: { ...view.calculations, [calculation.property]: id } });
                setCalculation(null);
              }}
            >
              {label}
            </MenuItem>
          ))}
        </Popover>
      )}
    </>
  );
}
