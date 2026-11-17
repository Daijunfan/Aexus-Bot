import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const overscan = 8;

// Keep native scrolling and a complete logical tree, mounting only visible rows.
export function SidebarList({
  count,
  label,
  itemKey,
  children,
}: {
  count: number;
  label: string;
  itemKey: (index: number) => string;
  children: (index: number) => ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(31);
  const [range, setRange] = useState({ start: 0, end: 40 });
  const virtual = count > 250;
  const measure = () => {
    const element = list.current;
    const scroll = element?.closest<HTMLElement>('.sidebar-scroll');
    if (!element || !scroll) return;
    const height = Number.parseFloat(getComputedStyle(scroll).getPropertyValue('--sidebar-row-height')) || 31;
    if (height !== rowHeight) setRowHeight(height);
    const top = scroll.getBoundingClientRect().top - element.getBoundingClientRect().top;
    const start = Math.max(0, Math.min(count, Math.floor(top / height) - overscan));
    const end = Math.max(start, Math.min(count, Math.ceil((top + scroll.clientHeight) / height) + overscan));
    setRange((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
  };
  useLayoutEffect(() => {
    if (!virtual) return;
    const scroll = list.current!.closest<HTMLElement>('.sidebar-scroll')!;
    measure();
    scroll.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(list.current!);
    return () => {
      scroll.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [count, virtual, rowHeight]);
  // A sibling section can collapse without resizing either observed element.
  useLayoutEffect(() => {
    if (virtual) measure();
  });
  const start = virtual ? Math.min(range.start, count) : 0;
  const end = virtual ? Math.min(range.end, count) : count;
  return (
    <div
      ref={list}
      role="tree"
      aria-label={label}
      style={{ paddingTop: start * rowHeight, paddingBottom: (count - end) * rowHeight }}
      onKeyDown={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-sidebar-index]');
        // Buttons inside a page row keep their own keyboard behavior.
        if (!row || event.target !== row.firstElementChild) return;
        const index = Number(row.dataset.sidebarIndex);
        let target: number;
        if (event.key === 'ArrowDown') target = Math.min(count - 1, index + 1);
        else if (event.key === 'ArrowUp') target = Math.max(0, index - 1);
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = count - 1;
        else if (
          event.key === 'ArrowLeft' &&
          (event.target as HTMLElement).getAttribute('aria-expanded') !== 'true' &&
          (event.target as HTMLElement).dataset.parentIndex !== undefined
        )
          target = Number((event.target as HTMLElement).dataset.parentIndex);
        else if (
          event.key === 'ArrowRight' &&
          (event.target as HTMLElement).getAttribute('aria-expanded') === 'true'
        )
          target = Math.min(count - 1, index + 1);
        else return;
        event.preventDefault();
        const focus = () =>
          list.current?.querySelector<HTMLElement>(`[data-sidebar-index="${target}"] > *`)?.focus();
        if (virtual) {
          const scroll = list.current!.closest<HTMLElement>('.sidebar-scroll')!;
          const top =
            list.current!.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top +
            scroll.scrollTop +
            target * rowHeight;
          if (top < scroll.scrollTop) scroll.scrollTop = top;
          else if (top + rowHeight > scroll.scrollTop + scroll.clientHeight)
            scroll.scrollTop = top + rowHeight - scroll.clientHeight;
          measure();
          requestAnimationFrame(focus);
        } else focus();
      }}
    >
      {Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
        const index = start + offset;
        return (
          <div
            key={itemKey(index)}
            data-sidebar-index={index}
            style={{ height: 'var(--sidebar-row-height, 31px)' }}
          >
            {children(index)}
          </div>
        );
      })}
    </div>
  );
}
