import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HierarchyRow } from '../structure';

const estimatedHeight = 38;
const overscan = 8;

function rowAt(offsets: number[], position: number) {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Keep native table cells and measured row heights, including wrapped content.
 * Only mounting is windowed: callers retain the complete query/group/selection. */
export function WindowedTableBody({ rows, columnCount, layoutKey, children }: {
  rows: HierarchyRow[];
  columnCount: number;
  layoutKey: string;
  children: (entry: HierarchyRow, index: number) => ReactNode;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRows = useRef<Set<Element>>(new Set());
  const atBottom = useRef(false);
  const previousLayout = useRef({ rows, layoutKey });
  const heights = useMemo(() => new Map<string, number>(), [layoutKey]);
  const [measurement, setMeasurement] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 35 });
  // Keep an editor or its portal picker alive even if the user scrolls away.
  const [interacting, setInteracting] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<{ id: string; backward: boolean }>();
  const virtual = rows.length > 200 && !window.native?.printMode;
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result.at(-1)! + (heights.get(row.page.id) || estimatedHeight));
    return result;
  }, [rows, heights, measurement]);
  const start = virtual ? Math.min(range.start, rows.length) : 0;
  const end = virtual ? Math.min(range.end, rows.length) : rows.length;
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  const pinned = interacting ? rows.findIndex(entry => entry.page.id === interacting) : -1;
  if (virtual && pinned >= 0 && (pinned < start || pinned >= end)) {
    indices.push(pinned);
    indices.sort((a, b) => a - b);
  }
  const measureWindow = () => {
    if (!virtual || !body.current) return;
    const scroll = body.current.closest<HTMLElement>('.page-scroll');
    const bounds = scroll?.getBoundingClientRect();
    const top = (bounds?.top || 0) - body.current.getBoundingClientRect().top;
    const height = scroll?.clientHeight || window.innerHeight;
    const next = {
      start: Math.max(0, rowAt(offsets, Math.max(0, top)) - overscan),
      end: Math.min(rows.length, rowAt(offsets, Math.max(0, top + height)) + overscan + 1),
    };
    setRange(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  };
  const measureWindowRef = useRef(measureWindow);
  measureWindowRef.current = measureWindow;
  useLayoutEffect(() => {
    if (previousLayout.current.rows !== rows || previousLayout.current.layoutKey !== layoutKey) {
      atBottom.current = false;
      previousLayout.current = { rows, layoutKey };
    }
    if (virtual && atBottom.current) {
      const scroll = body.current!.closest<HTMLElement>('.page-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
  }, [rows, layoutKey, offsets, virtual]);
  useLayoutEffect(() => {
    if (!virtual) return;
    measureWindowRef.current();
    const scroll = body.current!.closest<HTMLElement>('.page-scroll');
    const observer = new ResizeObserver(() => {
      let changed = false;
      for (const row of body.current?.querySelectorAll<HTMLElement>(':scope > tr[data-row-id]') || []) {
        const height = row.getBoundingClientRect().height;
        if (height && Math.abs(height - (heights.get(row.dataset.rowId!) || estimatedHeight)) > 0.5) {
          heights.set(row.dataset.rowId!, height);
          changed = true;
        }
      }
      if (changed) setMeasurement(value => value + 1);
      measureWindowRef.current();
    });
    observerRef.current = observer;
    observedRows.current = new Set(body.current!.querySelectorAll(':scope > tr[data-row-id]'));
    for (const row of observedRows.current) observer.observe(row);
    if (scroll) observer.observe(scroll);
    const onScroll = () => {
      if (scroll) atBottom.current = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1;
      measureWindowRef.current();
    };
    // Capture also covers an inline database inside a nested scrolling panel.
    document.addEventListener('scroll', onScroll, true);
    return () => {
      observerRef.current = null;
      observedRows.current.clear();
      observer.disconnect();
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [virtual, heights]);
  // Newly mounted virtual rows need measurement; the scroll observer stays attached.
  useLayoutEffect(() => {
    const observer = observerRef.current;
    if (observer && body.current) {
      const mounted = new Set(body.current.querySelectorAll(':scope > tr[data-row-id]'));
      for (const row of observedRows.current) if (!mounted.has(row)) observer.unobserve(row);
      for (const row of mounted) if (!observedRows.current.has(row)) observer.observe(row);
      observedRows.current = mounted;
    }
    // Group collapse or preceding content can move the table without resizing it.
    measureWindow();
  });
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const row = Array.from(body.current!.querySelectorAll<HTMLElement>('tr[data-row-id]'))
      .find(element => element.dataset.rowId === pendingFocus.id)!;
    const controls = row.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]');
    const target = pendingFocus.backward ? controls[controls.length - 1] || row : controls[0] || row;
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
    setPendingFocus(undefined);
  }, [pendingFocus]);
  const remember = (target: EventTarget) => {
    const id = (target as HTMLElement).closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
    if (id) setInteracting(id);
  };
  const spacer = (height: number, key: string) => height > 0 ? (
    <tr key={key} className="table-virtual-spacer" aria-hidden="true">
      <td colSpan={columnCount} style={{ height, padding: 0, border: 0 }} />
    </tr>
  ) : null;
  let previous = 0;
  return <tbody ref={body} onFocusCapture={event => remember(event.target)} onPointerDownCapture={event => remember(event.target)}
    onKeyDownCapture={event => {
      if (!virtual || event.key !== 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return;
      const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-row-id]');
      if (!row) return;
      const selector = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';
      const controls = row.querySelectorAll<HTMLElement>(selector);
      if (event.target !== (event.shiftKey ? controls[0] : controls[controls.length - 1])) return;
      const index = rows.findIndex(entry => entry.page.id === row.dataset.rowId) + (event.shiftKey ? -1 : 1);
      const next = rows[index];
      if (!next || Array.from(body.current!.querySelectorAll<HTMLElement>('tr[data-row-id]'))
        .some(element => element.dataset.rowId === next.page.id)) return;
      event.preventDefault();
      setInteracting(next.page.id);
      setPendingFocus({ id: next.page.id, backward: event.shiftKey });
    }}>
    {indices.map(index => {
      const gap = offsets[index] - offsets[previous];
      previous = index + 1;
      return <Fragment key={rows[index].page.id}>{spacer(gap, 'gap')}{children(rows[index], index)}</Fragment>;
    })}
    {spacer(offsets[rows.length] - offsets[previous], 'tail')}
  </tbody>;
}
