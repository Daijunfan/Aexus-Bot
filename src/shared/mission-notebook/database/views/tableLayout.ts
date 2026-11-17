import type { DatabaseView, Property } from '../../types';

export const selectionColumnId = '__selection';
export const actionColumnId = '__actions';

/** A stable, column-based layout shared by every header/body/footer cell.
 * Explicit widths prevent sticky offsets drifting as a table scrolls. */
export function tableLayout(view: DatabaseView, columns: Property[]) {
  const ids = [selectionColumnId, 'title', ...columns.map(column => column.id), actionColumnId];
  const widths = new Map<string, number>(ids.map(id => [
    id,
    id === selectionColumnId ? 30 : id === actionColumnId ? 38
      : Math.max(90, Math.min(600, view.columnWidths?.[id] || (id === 'title' ? 280 : 160))),
  ]));
  const target = view.frozenThrough === undefined ? 'title' : view.frozenThrough;
  // A property hidden in this view cannot serve as a freeze boundary.
  const lastFrozen = target === null ? -1 : Math.max(1, ids.indexOf(target));
  const offsets = new Map<string, number>();
  let total = 0;
  for (const [index, id] of ids.entries()) {
    if (index <= lastFrozen) offsets.set(id, total);
    total += widths.get(id)!;
  }
  return {
    ids,
    widths,
    offsets,
    total,
    edge: lastFrozen < 0 ? null : ids[lastFrozen],
    frozenThrough: target,
    wraps: (id: string) => view.columnWrap?.[id] ?? !!view.wrapCells,
  };
}
