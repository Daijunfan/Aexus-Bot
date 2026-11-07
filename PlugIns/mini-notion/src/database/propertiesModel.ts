import { dateParts, dateEpoch, dateText } from './dateValue.ts';
import type { Page, Property, PersonValue, FileValue } from '../types.ts';
import { relationIds } from './relations.ts';
import { evaluateFormula, formulaText, type FormulaContext, type FormulaValue } from './formula.ts';
import { pageIndex } from '../model.ts';

const rollupPageOrder = new WeakMap<Page[], Map<string, number>>();

export function contextFor(page: Page, pages: Page[], chain: Set<string> = new Set()): FormulaContext {
  const index = pageIndex(pages);
  return {
    pageId: page.id,
    pageName: (id) => index.get(id)?.title || '无标题',
    property: (name, targetId = page.id) => {
      const target = index.get(targetId);
      if (!target || target.trashedAt) return null;
      if (['名称', 'Name', 'title'].includes(name)) return target.title;
      if (['创建时间', 'Created time'].includes(name)) return new Date(target.createdAt);
      if (['最后编辑时间', 'Last edited time'].includes(name)) return new Date(target.updatedAt);
      const column = index.get(target.parentId || '')?.database?.columns.find((c) => c.name === name);
      if (!column) throw new Error(`未找到属性「${name}」`);
      return rawProperty(target, column, pages, chain);
    },
  };
}

function rawProperty(page: Page, column: Property, pages: Page[], chain: Set<string>): FormulaValue {
  const key = `${page.id}:${column.id}`;
  if (chain.has(key)) throw new Error(`属性「${column.name}」存在循环引用`);
  const next = new Set(chain);
  next.add(key);
  const raw = page.values[column.id];
  if (column.type === 'createdTime') return new Date(page.createdAt);
  if (column.type === 'editedTime') return new Date(page.updatedAt);
  if (column.type === 'createdBy') return page.createdBy || null;
  if (column.type === 'editedBy') return page.editedBy || null;
  if (column.type === 'uniqueId')
    return page.uniqueId?.databaseId === page.parentId
      ? `${column.idPrefix ? column.idPrefix + '-' : ''}${page.uniqueId.number}`
      : '';
  if (column.type === 'person') return Array.isArray(raw) ? (raw as PersonValue[]) : [];
  if (column.type === 'files') return Array.isArray(raw) ? (raw as FileValue[]).map((file) => file.url) : [];
  if (column.type === 'button') return column.button?.label || column.name;
  if (column.type === 'formula') return evaluateFormula(column.formula || '', contextFor(page, pages, next));
  if (column.type === 'relation') return relationIds(page, column, pages).map((id) => ({ kind: 'page', id }));
  if (column.type === 'rollup') {
    const index = pageIndex(pages);
    const relation = index
      .get(page.parentId || '')
      ?.database?.columns.find((property) => property.id === column.relationProperty);
    const ids = relation ? relationIds(page, relation, pages) : page.values[column.relationProperty || ''];
    const selected = new Set(
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
    );
    const related = [...selected]
      .map((id) => index.get(id))
      .filter((page): page is Page => !!page && !page.trashedAt);
    if (related.length > 1) {
      let order = rollupPageOrder.get(pages);
      if (!order) {
        order = new Map(pages.map((page, index) => [page.id, index]));
        rollupPageOrder.set(pages, order);
      }
      related.sort((a, b) => order!.get(a.id)! - order!.get(b.id)!);
    }
    if (!column.calculation || column.calculation === 'count') return related.length;
    const values = related.map((target) => {
      if (column.targetProperty === 'title') return target.title;
      const property = index
        .get(target.parentId || '')
        ?.database?.columns.find((c) => c.id === column.targetProperty);
      if (
        property?.type === 'number' &&
        (target.values[property.id] === undefined || target.values[property.id] === '')
      )
        return null;
      return property
        ? rawProperty(target, property, pages, next)
        : ((dateParts(target.values[column.targetProperty || ''])
            ? dateText(target.values[column.targetProperty || ''])
            : (target.values[column.targetProperty || ''] ?? null)) as FormulaValue);
    });
    const filled = values.filter(
      (value) => value !== null && value !== '' && (!Array.isArray(value) || value.length),
    );
    if (column.calculation === 'empty') return values.length - filled.length;
    if (column.calculation === 'count_not_empty') return filled.length;
    if (column.calculation === 'percent_empty' || column.calculation === 'percent_filled') {
      const count = column.calculation === 'percent_empty' ? values.length - filled.length : filled.length;
      return values.length ? (count / values.length) * 100 : 0;
    }
    if (['show', 'show_original', 'count_values', 'count_unique'].includes(column.calculation)) {
      const flattened = filled.flat();
      if (column.calculation === 'show_original') return flattened;
      if (column.calculation === 'count_values') return flattened.length;
      const seen = new Set<string>();
      const unique = flattened.filter((value) => {
        const key = JSON.stringify(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return column.calculation === 'count_unique' ? unique.length : unique;
    }
    if (column.calculation === 'earliest_date' || column.calculation === 'latest_date') {
      const dates = values.flatMap((value) =>
        value instanceof Date
          ? [value]
          : value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'dateRange'
            ? [column.calculation === 'earliest_date' ? value.start : value.end]
            : [],
      );
      if (!dates.length) return null;
      return dates.reduce((a, b) =>
        column.calculation === 'earliest_date' ? (a < b ? a : b) : a > b ? a : b,
      );
    }
    const numbers = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    if (!numbers.length) return null;
    if (column.calculation === 'min') return numbers.reduce((a, b) => Math.min(a, b));
    if (column.calculation === 'max') return numbers.reduce((a, b) => Math.max(a, b));
    if (column.calculation === 'range')
      return numbers.reduce((a, b) => Math.max(a, b)) - numbers.reduce((a, b) => Math.min(a, b));
    if (column.calculation === 'median') {
      numbers.sort((a, b) => a - b);
      const middle = Math.floor(numbers.length / 2);
      return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
    }
    const sum = numbers.reduce((a, b) => a + b, 0);
    return column.calculation === 'average' ? sum / numbers.length : sum;
  }
  if (column.type === 'date') {
    const parts = dateParts(raw);
    return !parts
      ? null
      : parts.end
        ? { kind: 'dateRange', start: new Date(dateEpoch(raw)), end: new Date(dateEpoch(raw, 'end')) }
        : new Date(dateEpoch(raw));
  }
  if (column.type === 'number') return raw === '' || raw === undefined ? 0 : Number(raw);
  if (column.type === 'checkbox') return !!raw;
  if (column.type === 'multiSelect') return Array.isArray(raw) ? (raw as string[]) : [];
  return typeof raw === 'object' && !Array.isArray(raw) ? dateText(raw) : ((raw ?? '') as FormulaValue);
}

export type PropertyResult = { ok: true; value: FormulaValue } | { ok: false; error: string };
export function computeProperty(page: Page, column: Property, pages: Page[]): PropertyResult {
  try {
    return { ok: true, value: rawProperty(page, column, pages, new Set()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readProperty(
  page: Page,
  column: Property,
  pages: Page[],
): string | number | boolean | string[] {
  if (column.type === 'button') return column.button?.label || column.name;
  if (column.type === 'date') return dateText(page.values[column.id]);
  if (column.type === 'files')
    return ((page.values[column.id] || []) as FileValue[]).map((file) => file.name);
  if (
    ![
      'formula',
      'relation',
      'rollup',
      'createdTime',
      'editedTime',
      'createdBy',
      'editedBy',
      'person',
      'uniqueId',
    ].includes(column.type)
  ) {
    const raw = page.values[column.id];
    return typeof raw === 'object' && !Array.isArray(raw)
      ? dateText(raw)
      : ((raw ?? '') as string | number | boolean | string[]);
  }
  const result = computeProperty(page, column, pages);
  if (!result.ok) return `# ${result.error}`;
  const value = result.value;
  const context = contextFor(page, pages, new Set());
  if (value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((value) => formulaText(value, context));
  if (value instanceof Date) return value.toISOString();
  return formulaText(value, context);
}
