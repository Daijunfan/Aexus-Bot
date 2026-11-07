import { GroupHeader } from '../GroupControls';
import { EventSummary } from '../../components/EventSummary';
import { eventDescription, eventPresenter } from '../../scheduling/presentation';
import { AppSelect } from '../../components/AppSelect';
import { AppearanceTheme, recordAppearanceStyle } from '../../appearance';
import { isDateProperty } from '../propertySchema';
import { Fragment, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange, SlidersHorizontal } from 'lucide-react';
import { useWorkspace } from '../../store';
import { IconButton } from '../../ui';
import { groupRows, conditionalColor, type RowGroup } from '../model';
import { conditionalColorStyle } from '../conditionalColors';
import type { ViewProps } from './types';
import {
  dateKey as key,
  parseDay,
  viewPeriod,
  navigateViewDate,
  timelineScales,
  scheduleFields,
  scheduledRange,
  moveScheduledRecord,
  resizeScheduledRecord,
} from '../dates';
import { hierarchyRows, type HierarchyRow } from '../structure';
import { RecordTitle } from '../RecordTitle';
import { TimelineDependencies, DependencyHandle, type TimelineBarPosition } from '../TimelineDependencies';
import type { Page, Property } from '../../types';

const dayMs = 86400000;
type TimelineEntry = HierarchyRow | RowGroup;

function visibleBar(row: Page, startColumn: Property, endColumn: Property | undefined,
  origin: number, unit: number, width: number, preview?: { start: string; end: string }) {
  const range = scheduledRange(row, startColumn, endColumn);
  const start = parseDay(preview?.start ?? range.start);
  const end = parseDay(preview?.end ?? range.end) || start;
  if (!start || !end) return null;
  const left = Math.round((start.getTime() - origin) / dayMs) * unit;
  const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1);
  const visibleLeft = Math.max(0, left);
  const visibleWidth = Math.max(0, Math.min(width, left + duration * unit - 4) - visibleLeft);
  return visibleWidth > 0 ? { left: visibleLeft, right: visibleLeft + Math.max(8, visibleWidth) } : null;
}

function timelineIndexAt(offsets: number[], position: number) {
  let low = 0, high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function TimelineWindow({ entries, enabled, children }: {
  entries: TimelineEntry[];
  enabled: boolean;
  children: (entry: TimelineEntry, index: number) => ReactNode;
}) {
  const virtual = enabled && !window.native?.printMode;
  const container = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 24 });
  const [pinned, setPinned] = useState<number | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ index: number; backward: boolean } | null>(null);
  const offsets = useMemo(() => {
    const result = [0];
    for (const entry of entries) result.push(result.at(-1)! + ('rows' in entry ? 35 : 76));
    return result;
  }, [entries]);

  useLayoutEffect(() => {
    if (!virtual) return;
    const element = container.current!;
    const scroll = element.closest<HTMLElement>('.page-scroll')!;
    const measure = () => {
      const top = scroll.getBoundingClientRect().top - element.getBoundingClientRect().top;
      const bottom = top + scroll.clientHeight;
      const next = bottom <= 0 ? { start: 0, end: 0 }
        : top >= offsets.at(-1)! ? { start: entries.length, end: entries.length }
        : {
          start: Math.max(0, timelineIndexAt(offsets, Math.max(0, top)) - 5),
          end: Math.min(entries.length, timelineIndexAt(offsets, Math.max(0, bottom)) + 6),
        };
      setRange(previous => previous.start === next.start && previous.end === next.end ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(element);
    document.addEventListener('scroll', measure, true);
    measure();
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', measure, true);
    };
  }, [virtual, offsets, entries.length]);

  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const entry = container.current!.querySelector<HTMLElement>(
      `[data-timeline-entry-index="${pendingFocus.index}"]`,
    )!;
    const controls = entry.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
    );
    const target = (pendingFocus.backward ? controls[controls.length - 1] : controls[0]) || entry;
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
    setPendingFocus(null);
  }, [pendingFocus]);

  if (!virtual) return <>{entries.map((entry, index) => children(entry, index))}</>;

  const start = Math.min(range.start, entries.length);
  const end = Math.min(range.end, entries.length);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  if (pinned !== null && pinned < entries.length && (pinned < start || pinned >= end)) {
    indices.push(pinned);
    indices.sort((a, b) => a - b);
  }
  let previous = 0;
  const spacer = (height: number, key: string) => height > 0
    ? <div key={key} className="timeline-window-spacer" aria-hidden="true" style={{ height }} />
    : null;
  const remember = (target: EventTarget) => {
    const entry = (target as HTMLElement).closest<HTMLElement>('[data-timeline-entry-index]');
    if (entry) setPinned(Number(entry.dataset.timelineEntryIndex));
  };
  return <div ref={container} className="timeline-window"
    onFocusCapture={event => remember(event.target)}
    onPointerDownCapture={event => remember(event.target)}
    onKeyDownCapture={event => {
      if (event.key !== 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return;
      const entry = (event.target as HTMLElement).closest<HTMLElement>('[data-timeline-entry-index]');
      if (!entry) return;
      const controls = Array.from(entry.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
      ));
      if (event.target !== (event.shiftKey ? controls[0] : controls.at(-1))) return;
      const nextIndex = Number(entry.dataset.timelineEntryIndex) + (event.shiftKey ? -1 : 1);
      if (nextIndex < 0 || nextIndex >= entries.length ||
        container.current!.querySelector(`[data-timeline-entry-index="${nextIndex}"]`)) return;
      event.preventDefault();
      setPinned(nextIndex);
      setPendingFocus({ index: nextIndex, backward: event.shiftKey });
    }}>
    {indices.map(index => {
      const gap = offsets[index] - offsets[previous];
      previous = index + 1;
      return <Fragment key={index}>{spacer(gap, 'gap')}{children(entries[index], index)}</Fragment>;
    })}
    {spacer(offsets[entries.length] - offsets[previous], 'tail')}
  </div>;
}
export function TimelineView({ editProperty, page, view, rows, updateView, openRow, addRow }: ViewProps) {
  const theme = useContext(AppearanceTheme);
  const { patch, workspace } = useWorkspace();
  const grouped = useMemo(() => groupRows(rows, view.groupBy, page.database!, workspace!.pages, view),
    [rows, view, page.database, workspace!.pages]);
  const entries = useMemo<TimelineEntry[]>(() => view.groupBy
    ? grouped.flatMap((group) => [
        group,
        ...(view.collapsedGroups?.includes(group.key)
          ? []
          : hierarchyRows(group.rows, view, !!page.database!.subItems)),
      ])
    : hierarchyRows(rows, view, !!page.database!.subItems),
  [grouped, rows, view, page.database]);
  const groupKeys = useMemo(() => grouped.map(group => group.key), [grouped]);
  const grid = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<{ from: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; start: string; end: string } | null>(null);
  const describe = eventPresenter(workspace!, page, view);
  const dates = page.database!.columns.filter(isDateProperty);
  const { start: startColumn, end: endColumn } = scheduleFields(page, view);
  const readonlyDates = startColumn?.type !== 'date' || (!!endColumn && endColumn.type !== 'date');
  const scale = view.timelineScale || 'month';
  const config = timelineScales[scale];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const origin = viewPeriod(view).first;
  const days = Array.from(
    { length: config.days },
    (_, i) => new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + i, 12),
  );
  const width = config.days * config.width;
  const originTime = origin.getTime();
  const dependencyPositions = useMemo(() => {
    const positions = new Map<string, TimelineBarPosition>();
    if (!page.database!.dependencies?.enabled || entries.length <= 200 || !startColumn) return positions;
    let offset = 40; // Header height, followed by 35px group headers or 76px rows.
    for (const entry of entries) {
      if ('rows' in entry) {
        offset += 35;
        continue;
      }
      const bar = visibleBar(entry.page, startColumn, endColumn, originTime, config.width, width);
      if (bar) positions.set(entry.page.id, { ...bar, y: offset + 38 }); // 8px top + 60px bar / 2.
      offset += 76;
    }
    return positions;
  }, [entries, page.database, startColumn, endColumn, originTime, config.width, width]);
  const previewPositions = useMemo(() => {
    if (!drag || !dependencyPositions.has(drag.id) || !startColumn) return dependencyPositions;
    const row = rows.find((candidate) => candidate.id === drag.id);
    if (!row) return dependencyPositions;
    const updated = new Map(dependencyPositions);
    const bar = visibleBar(row, startColumn, endColumn, originTime, config.width, width, drag);
    if (bar) updated.set(row.id, { ...bar, y: dependencyPositions.get(row.id)!.y });
    else updated.delete(row.id);
    return updated;
  }, [dependencyPositions, drag, rows, startColumn, endColumn, originTime, config.width, width]);
  if (!startColumn)
    return (
      <div className="empty-state">
        <CalendarRange size={32} />
        <h3>添加日期以使用时间线</h3>
        <button
          className="primary-button"
          disabled={page.locked}
          onClick={() =>
            patch(page.id, {
              database: {
                ...page.database!,
                columns: [
                  ...page.database!.columns,
                  { id: crypto.randomUUID(), name: '开始日期', type: 'date' },
                  { id: crypto.randomUUID(), name: '结束日期', type: 'date' },
                ],
              },
            })
          }
        >
          添加开始和结束日期
        </button>
      </div>
    );
  const dragBar = (event: React.PointerEvent, id: string, from: Date, to: Date, resize: boolean) => {
    if (event.button !== 0 || readonlyDates || page.locked || rows.find((row) => row.id === id)?.locked)
      return;
    event.preventDefault();
    event.stopPropagation();
    const x = event.clientX;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    let delta = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId || !(e.buttons & 1)) return;
      delta = Math.round((e.clientX - x) / config.width);
      const start = new Date(from);
      const end = new Date(to);
      if (!resize) start.setDate(start.getDate() + delta);
      end.setDate(end.getDate() + delta);
      if (end < start) end.setTime(start.getTime());
      setDrag({ id, start: key(start), end: key(end) });
    };
    const finish = (ending: PointerEvent) => {
      if (ending.pointerId !== event.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      setDrag(null);
      if (ending.type === 'pointercancel') return;
      if (!delta) {
        if (!resize) openRow(id);
        return;
      }
      const row = rows.find((row) => row.id === id)!;
      const start = new Date(from);
      const end = new Date(to);
      if (!resize) start.setDate(start.getDate() + delta);
      end.setDate(end.getDate() + delta);
      if (end < start) end.setTime(start.getTime());
      patch(id, {
        values: resize
          ? resizeScheduledRecord(row, startColumn.id, endColumn?.id, key(end))
          : moveScheduledRecord(row, startColumn.id, endColumn?.id, key(start)),
      });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  };
  return (
    <div className="timeline-view">
      <div className="timeline-controls">
        <strong>
          {origin.getFullYear()} 年 {origin.getMonth() + 1} 月
        </strong>
        <details className="schedule-fields">
          <summary>
            <SlidersHorizontal size={14} /> 日期属性
          </summary>
          <div>
            <label>
              开始
              <AppSelect
                aria-label="时间线开始属性"
                value={startColumn.id}
                onChange={(e) => updateView({ calendarBy: e.target.value })}
              >
                {dates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label>
              结束
              <AppSelect
                aria-label="时间线结束属性"
                value={endColumn?.id || ''}
                onChange={(e) => updateView({ timelineEnd: e.target.value })}
              >
                <option value="">同一日期范围</option>
                {dates
                  .filter((c) => c.id !== startColumn.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </AppSelect>
            </label>
          </div>
        </details>
        <AppSelect
          aria-label="时间线缩放"
          value={scale}
          onChange={(e) => updateView({ timelineScale: e.target.value as typeof scale })}
        >
          <option value="week">周</option>
          <option value="month">月</option>
          <option value="quarter">季度</option>
          <option value="year">年</option>
        </AppSelect>
        <button className="text-button" onClick={() => updateView(navigateViewDate(view, 'today'))}>
          今天
        </button>
        <IconButton label="上一时间段" onClick={() => updateView(navigateViewDate(view, 'previous'))}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton label="下一时间段" onClick={() => updateView(navigateViewDate(view, 'next'))}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-grid" ref={grid} style={{ width: width + 280 }}>
          <div className="timeline-heading">
            <div className="timeline-name-header">名称</div>
            <div className="timeline-axis" style={{ width }}>
              {days.map((date, i) => (
                <span
                  key={i}
                  style={{ left: i * config.width, width: config.width }}
                  className={date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : ''}
                >
                  {scale === 'week' || scale === 'month'
                    ? date.getDate() === 1
                      ? `${date.getMonth() + 1}月`
                      : date.getDate()
                    : date.getDate() === 1
                      ? `${date.getMonth() + 1}月`
                      : ''}
                </span>
              ))}
            </div>
          </div>
          <TimelineWindow entries={entries} enabled={entries.length > 200}>
            {(item, index) => {
            if ('rows' in item)
              return (
                <div key={`group-${item.key}`} className="timeline-group-row" data-group-key={item.key}
                  data-timeline-entry-index={index}>
                  <GroupHeader page={page} view={view} group={item} groupKeys={groupKeys}
                    updateView={updateView} editProperty={editProperty} className="timeline-group-controls" />
                </div>
              );
            const row = item.page;
            const range = scheduledRange(row, startColumn, endColumn);
            const start = parseDay(drag?.id === row.id ? drag.start : range.start);
            const end = parseDay(drag?.id === row.id ? drag.end : range.end) || start;
            const left = start ? Math.round((start.getTime() - origin.getTime()) / dayMs) * config.width : 0;
            const duration =
              start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1) : 1;
            const info = describe(row),
              visibleLeft = Math.max(0, left);
            const visibleWidth = Math.max(
              0,
              Math.min(width, left + duration * config.width - 4) - visibleLeft,
            );
            return (
              <div className="timeline-row" key={row.id} data-timeline-entry-index={index}>
                <div className="timeline-row-name" title={eventDescription(info)}>
                  <div className="timeline-row-info">
                    <RecordTitle
                      entry={item}
                      database={page}
                      view={view}
                      onViewChange={updateView}
                      onOpen={openRow}
                    />
                    <small>
                      {info.when} · {info.status}
                    </small>
                  </div>
                </div>
                <div
                  className="timeline-lane"
                  style={{ width, backgroundSize: `${config.width}px 100%` }}
                  onDoubleClick={(e) => {
                    if (start || readonlyDates || page.locked) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const date = days[Math.floor((e.clientX - rect.left) / config.width)];
                    if (date) patch(row.id, { values: { ...row.values, [startColumn.id]: key(date) } });
                  }}
                >
                  {start && end && visibleWidth > 0 && (
                    <div
                      className={`timeline-bar ${visibleWidth < 180 ? 'short-bar' : ''} ${drag?.id === row.id ? 'dragging' : ''}`}
                      data-timeline-id={row.id}
                      data-label-side={
                        width - visibleLeft - visibleWidth < 230 && visibleLeft > 230 ? 'before' : 'after'
                      }
                      role="button"
                      tabIndex={0}
                      aria-label={`${row.title} ${key(start)} 至 ${key(end)}`}
                      style={{
                        ...recordAppearanceStyle(row, theme, workspace!.settings.appearance),
                        ...conditionalColorStyle(
                          conditionalColor(row, view, page.database!, workspace!.pages),
                          theme,
                        ),
                        left: visibleLeft,
                        width: Math.max(8, visibleWidth),
                      }}
                      onPointerDown={(e) => dragBar(e, row.id, start, end, false)}
                      onClick={() => {
                        if (readonlyDates || page.locked || row.locked) openRow(row.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          openRow(row.id);
                        }
                      }}
                      title={eventDescription(info)}
                    >
                      <EventSummary info={info} />
                      {page.database!.dependencies?.enabled && !page.locked && (
                        <DependencyHandle row={row} rows={rows} onConnection={setConnection} />
                      )}
                      {!readonlyDates && !page.locked && !row.locked && (
                        <div
                          className="timeline-resize"
                          onPointerDown={(e) => dragBar(e, row.id, start, end, true)}
                        />
                      )}
                    </div>
                  )}
                  <span
                    className="timeline-today"
                    style={{ left: Math.round((today.getTime() - origin.getTime()) / dayMs) * config.width }}
                  />
                </div>
              </div>
            );
            }}
          </TimelineWindow>
          {page.database!.dependencies?.enabled && (
            <TimelineDependencies
              container={grid}
              rows={rows}
              readOnly={page.locked}
              refresh={drag}
              connection={connection}
              positions={entries.length > 200 ? previewPositions : undefined}
            />
          )}
          <button className="database-add-row" onClick={() => addRow()} disabled={page.locked}>
            ＋ 新建页面
          </button>
        </div>
      </div>
      <p className="timeline-footnote">
        拖动条目调整日期，拖动右边缘调整持续时间。无日期记录可双击对应日期来安排。
      </p>
    </div>
  );
}
