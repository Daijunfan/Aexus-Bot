import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Page } from '../../types';

function rowAt(offsets: number[], position: number) {
  let low = 0, high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function WindowedCards({ rows, enabled, gallery = false, className, layoutKey, estimatedHeight, footer, children }: {
  rows: Page[];
  enabled: boolean;
  gallery?: boolean;
  className: string;
  layoutKey: string;
  estimatedHeight?: number;
  footer: ReactNode;
  children: (row: Page, index: number) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRows = useRef<Set<Element>>(new Set());
  const atBottom = useRef(false);
  const previousRows = useRef(rows);
  const [width, setWidth] = useState(0);
  const [columns, setColumns] = useState(1);
  const [measurement, setMeasurement] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 10 });
  const [interacting, setInteracting] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<{ id: string; backward: boolean }>();
  const heights = useMemo(() => new Map<string, number>(), [layoutKey, width]);
  const virtual = enabled && !window.native?.printMode;
  const rowEstimate = estimatedHeight ?? (gallery ? 260 : 140);
  const itemCount = rows.length + (footer == null ? 0 : 1);
  const rowCount = Math.ceil(itemCount / columns);
  const keys = useMemo(() => Array.from({ length: rowCount }, (_, index) =>
    rows.slice(index * columns, (index + 1) * columns).map(row => row.id).join('/') || '__new'), [rows, rowCount, columns]);
  const offsets = useMemo(() => {
    const result = [0];
    for (const key of keys) result.push(result.at(-1)! + (heights.get(key) || rowEstimate) + (gallery ? 12 : 0));
    return result;
  }, [keys, heights, measurement, gallery, rowEstimate]);
  const start = Math.min(range.start, rowCount), end = Math.min(range.end, rowCount);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  const pinned = interacting ? rows.findIndex(row => row.id === interacting) : -1;
  const pinnedRow = Math.floor(pinned / columns);
  if (pinned >= 0 && (pinnedRow < start || pinnedRow >= end)) {
    indices.push(pinnedRow);
    indices.sort((a, b) => a - b);
  }
  const measureWindow = () => {
    if (!virtual || !container.current) return;
    const scroll = container.current.closest<HTMLElement>('.page-scroll');
    const bounds = scroll?.getBoundingClientRect();
    const top = (bounds?.top || 0) - container.current.getBoundingClientRect().top;
    const height = scroll?.clientHeight || window.innerHeight;
    const next = top + height < 0 ? { start: 0, end: 0 } : top > offsets.at(-1)!
      ? { start: rowCount, end: rowCount }
      : { start: Math.max(0, rowAt(offsets, Math.max(0, top)) - 4),
          end: Math.min(rowCount, rowAt(offsets, Math.max(0, top + height)) + 5) };
    setRange(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  };
  const measureWindowRef = useRef(measureWindow);
  measureWindowRef.current = measureWindow;
  useLayoutEffect(() => {
    if (!virtual) return;
    if (previousRows.current !== rows) {
      atBottom.current = false;
      previousRows.current = rows;
    }
    if (atBottom.current) {
      const scroll = container.current!.closest<HTMLElement>('.page-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
  }, [rows, offsets, virtual]);
  useLayoutEffect(() => {
    if (!virtual) return;
    const element = container.current!;
    const scroll = element.closest<HTMLElement>('.page-scroll');
    const measure = () => {
      setWidth(element.clientWidth);
      const nextColumns = gallery ? getComputedStyle(element).gridTemplateColumns.split(' ').length : 1;
      setColumns(nextColumns);
      let changed = false;
      for (const row of element.querySelectorAll<HTMLElement>(':scope > [data-card-window-row]')) {
        const height = row.getBoundingClientRect().height;
        const key = row.dataset.cardWindowRow!;
        if (height && Math.abs(height - (heights.get(key) || rowEstimate)) > 0.5) {
          heights.set(key, height);
          changed = true;
        }
      }
      if (changed) setMeasurement(value => value + 1);
      measureWindowRef.current();
    };
    const observer = new ResizeObserver(measure);
    observerRef.current = observer;
    observer.observe(element);
    if (scroll) observer.observe(scroll);
    observedRows.current = new Set(element.querySelectorAll(':scope > [data-card-window-row]'));
    for (const row of observedRows.current) observer.observe(row);
    const onScroll = () => {
      if (scroll) atBottom.current = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1;
      measureWindowRef.current();
    };
    document.addEventListener('scroll', onScroll, true);
    measure();
    return () => {
      observerRef.current = null;
      observedRows.current.clear();
      observer.disconnect();
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [virtual, gallery, heights, rowEstimate]);
  useLayoutEffect(() => {
    const observer = observerRef.current;
    if (observer && container.current) {
      const mounted = new Set(container.current.querySelectorAll(':scope > [data-card-window-row]'));
      for (const row of observedRows.current) if (!mounted.has(row)) observer.unobserve(row);
      for (const row of mounted) if (!observedRows.current.has(row)) observer.observe(row);
      observedRows.current = mounted;
    }
    measureWindow();
  });
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const card = Array.from(container.current!.querySelectorAll<HTMLElement>('[data-record-id]'))
      .find(element => element.dataset.recordId === pendingFocus.id)!;
    const controls = card.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]');
    const target = pendingFocus.backward ? controls[controls.length - 1] || card
      : card.tabIndex >= 0 ? card : controls[0] || card;
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
    setPendingFocus(undefined);
  }, [pendingFocus]);
  const remember = (target: EventTarget) => {
    const id = (target as HTMLElement).closest<HTMLElement>('[data-record-id]')?.dataset.recordId;
    if (id) setInteracting(id);
  };
  const renderItem = (index: number) => index < rows.length ? children(rows[index], index) : footer;
  let previous = 0;
  const spacer = (height: number, key: string) => height > 0
    ? <div key={key} aria-hidden="true" className="card-window-spacer" style={{ height }} /> : null;
  return <div ref={container} className={`${className}${virtual ? ' windowed-cards' : ''}`}
    onFocusCapture={event => remember(event.target)} onPointerDownCapture={event => remember(event.target)}
    onDragStartCapture={event => remember(event.target)}
    onKeyDownCapture={event => {
      if (!virtual || event.key !== 'Tab' || event.altKey || event.metaKey || event.ctrlKey) return;
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-record-id]');
      if (!card) return;
      const selector = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]';
      const controls = [...(card.matches(selector) ? [card] : []), ...card.querySelectorAll<HTMLElement>(selector)];
      if (event.target !== (event.shiftKey ? controls[0] : controls.at(-1))) return;
      const index = rows.findIndex(row => row.id === card.dataset.recordId) + (event.shiftKey ? -1 : 1);
      const next = rows[index];
      if (!next || Array.from(container.current!.querySelectorAll<HTMLElement>('[data-record-id]')).some(element => element.dataset.recordId === next.id)) return;
      event.preventDefault();
      setInteracting(next.id);
      setPendingFocus({ id: next.id, backward: event.shiftKey });
    }}>
    {virtual ? indices.map(index => {
      const gap = offsets[index] - offsets[previous];
      previous = index + 1;
      return <Fragment key={keys[index]}>{spacer(gap, 'gap')}
        <div data-card-window-row={keys[index]} className="card-window-row"
          style={gallery ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 12, marginBottom: 12 } : { display: 'flow-root' }}>
          {Array.from({ length: Math.min(columns, itemCount - index * columns) }, (_, column) => {
            const item = index * columns + column;
            return <Fragment key={rows[item]?.id || '__new'}>{renderItem(item)}</Fragment>;
          })}
        </div>
      </Fragment>;
    }) : <>{rows.map((row, index) => <Fragment key={row.id}>{children(row, index)}</Fragment>)}{footer}</>}
    {virtual && spacer(offsets[rowCount] - offsets[previous], 'tail')}
  </div>;
}
