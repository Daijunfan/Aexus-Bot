import { isSelectProperty, isDateProperty, propertyDateValue } from './propertySchema.ts';
import type {
  Aggregate,
  Database,
  DatabaseView,
  FilterGroup,
  FilterRule,
  Page,
  PersonValue,
  FileValue,
  Property,
  ViewType,
} from '../types.ts';
import { readProperty, isTemplatePage, pageIndex } from '../model.ts';
import { dateWall, dateEpoch } from './dateValue.ts';
import { relationIds } from './relations.ts';

export const viewNames: Record<ViewType, string> = {
  table: '表格',
  board: '看板',
  gallery: '画廊',
  list: '列表',
  calendar: '日历',
  plan: '计划',
  timeline: '时间线',
  chart: '图表',
  feed: '动态',
  form: '表单',
};
export const subItemDisplay = (view: DatabaseView) =>
  view.subItemDisplay ||
  (['table', 'list', 'timeline'].includes(view.type)
    ? 'nested'
    : ['board', 'gallery', 'calendar'].includes(view.type)
      ? 'card'
      : 'flat');
export const emptyFilters = (): FilterGroup => ({ id: crypto.randomUUID(), conjunction: 'and', rules: [] });
export const conditionalColorViews: ViewType[] = [
  'table',
  'board',
  'gallery',
  'list',
  'calendar',
  'plan',
  'timeline',
  'feed',
];
export function removeViewProperty(view: DatabaseView, id: string): DatabaseView {
  const usesProperty = (group: FilterGroup): boolean =>
    group.rules.some((rule) => ('rules' in rule ? usesProperty(rule) : rule.property === id));
  const filter = (group: FilterGroup): FilterGroup => ({
    ...group,
    rules: group.rules
      .filter((rule) => 'rules' in rule || rule.property !== id)
      .map((rule) => ('rules' in rule ? filter(rule) : rule)),
  });
  const withoutKey = <T>(object: Record<string, T> | undefined) =>
    object ? Object.fromEntries(Object.entries(object).filter(([key]) => key !== id)) : undefined;
  return {
    ...view,
    filters: view.filters ? filter(view.filters) : undefined,
    conditionalColors: view.conditionalColors?.filter(
      (rule) => rule.targetProperty !== id && !usesProperty(rule.filter),
    ),
    sorts: view.sorts?.filter((sort) => sort.property !== id),
    groupBy: view.groupBy === id ? undefined : view.groupBy,
    subGroupBy: view.subGroupBy === id ? undefined : view.subGroupBy,
    calendarBy: view.calendarBy === id ? undefined : view.calendarBy,
    timelineEnd: view.timelineEnd === id ? '' : view.timelineEnd,
    planDoneBy: view.planDoneBy === id ? undefined : view.planDoneBy,
    chartGroup: view.chartGroup === id ? undefined : view.chartGroup,
    chartValue: view.chartValue === id ? undefined : view.chartValue,
    hiddenProperties: view.hiddenProperties?.filter((key) => key !== id),
    propertyOrder: view.propertyOrder?.filter((key) => key !== id),
    columnWidths: withoutKey(view.columnWidths),
    columnWrap: withoutKey(view.columnWrap),
    frozenThrough: view.frozenThrough === id ? null : view.frozenThrough,
    calculations: withoutKey(view.calculations),
    formRequired: view.formRequired?.filter((key) => key !== id),
  };
}
export function newView(type: ViewType, name = viewNames[type]): DatabaseView {
  return {
    id: crypto.randomUUID(),
    name,
    type,
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: [],
    openPagesIn: type === 'gallery' || type === 'calendar' ? 'center' : 'side',
  };
}

// Old workspaces keep their active layout and query when first adopting saved views.
export function getViews(database: Database): DatabaseView[] {
  if (database.views?.length) return database.views;
  return (
    ['table', 'board', 'timeline', 'calendar', 'gallery', 'list', 'chart', 'feed', 'form'] as ViewType[]
  ).map((type) => ({
    id: `legacy-${type}`,
    name: viewNames[type],
    type,
    calendarBy: database.calendarBy,
    groupBy:
      type === 'board'
        ? database.groupBy || database.columns.find((c) => isSelectProperty(c))?.id
        : undefined,
    filters:
      database.view === type && database.filter?.value
        ? {
            id: 'legacy-filter-group',
            conjunction: 'and',
            rules: [
              {
                id: 'legacy-filter',
                property: database.filter.field,
                operator: 'contains',
                value: database.filter.value,
              },
            ],
          }
        : undefined,
    sorts:
      database.view === type && database.sort
        ? [{ id: 'legacy-sort', property: database.sort.field, direction: database.sort.direction }]
        : [],
    openPagesIn: 'side',
  }));
}

export function activeView(database: Database): DatabaseView {
  const views = getViews(database);
  return (
    views.find((v) => v.id === database.activeViewId) ||
    views.find((v) => v.type === database.view) ||
    views[0]
  );
}

export function updateView(database: Database, id: string, changes: Partial<DatabaseView>): Database {
  const views = getViews(database).map((view) => (view.id === id ? { ...view, ...changes, id } : view));
  const selected =
    views.find((view) => view.id === (database.activeViewId || activeView(database).id)) || views[0];
  return { ...database, views, activeViewId: selected.id, view: selected.type };
}

export function selectView(database: Database, id: string): Database {
  const views = getViews(database);
  const view = views.find((v) => v.id === id);
  return view ? { ...database, views, activeViewId: id, view: view.type } : database;
}

const propertyIndexes = new WeakMap<Property[], Map<string, Property>>();
function databaseColumn(database: Database, id: string): Property | undefined {
  let columns = propertyIndexes.get(database.columns);
  if (!columns) {
    columns = new Map();
    for (const column of database.columns) {
      if (!columns.has(column.id)) columns.set(column.id, column);
    }
    propertyIndexes.set(database.columns, columns);
  }
  return columns.get(id);
}

function readColumnValue(page: Page, column: Property, pages: Page[]) {
  return column.type === 'checkbox' ? !!page.values[column.id] : readProperty(page, column, pages);
}

export function columnValue(page: Page, property: string, database: Database, pages: Page[]) {
  if (property === 'title') return page.title;
  if (property === 'createdAt') return page.createdAt;
  if (property === 'updatedAt') return page.updatedAt;
  const column = databaseColumn(database, property);
  return column ? readColumnValue(page, column, pages) : '';
}

const isEmpty = (value: unknown) =>
  value === '' || value === undefined || value === null || (Array.isArray(value) && value.length === 0);
export function matchesRule(row: Page, rule: FilterRule, database: Database, pages: Page[]): boolean {
  const column = databaseColumn(database, rule.property);
  const raw =
    column?.type === 'relation'
      ? relationIds(row, column, pages)
      : column?.type === 'person'
        ? ((row.values[column.id] || []) as PersonValue[]).flatMap((person) => [
            person.id,
            person.name,
            person.email,
          ])
        : columnValue(row, rule.property, database, pages);
  const scalar = (
    column && isDateProperty(column)
      ? dateWall(propertyDateValue(row, column)).slice(0, 10)
      : String(raw ?? '')
  ).toLocaleLowerCase();
  const expected = rule.value.toLocaleLowerCase();
  if (column && isDateProperty(column) && expected.includes('t')) {
    const actualTime = dateEpoch(propertyDateValue(row, column)),
      expectedTime = dateEpoch(rule.value);
    if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime)) return rule.operator === 'is_not';
    if (rule.operator === 'is') return actualTime === expectedTime;
    if (rule.operator === 'is_not') return actualTime !== expectedTime;
    if (['before', 'lt'].includes(rule.operator)) return actualTime < expectedTime;
    if (['after', 'gt'].includes(rule.operator)) return actualTime > expectedTime;
    if (['on_or_before', 'lte'].includes(rule.operator)) return actualTime <= expectedTime;
    if (['on_or_after', 'gte'].includes(rule.operator)) return actualTime >= expectedTime;
  }
  const values = Array.isArray(raw) ? raw.map((value) => String(value).toLocaleLowerCase()) : null;
  const equal = values ? values.includes(expected) : scalar === expected;
  const contains = values ? values.includes(expected) : scalar.includes(expected);
  switch (rule.operator) {
    case 'empty':
      return isEmpty(raw);
    case 'not_empty':
      return !isEmpty(raw);
    case 'is':
      return equal;
    case 'is_not':
      return !equal;
    case 'contains':
      return contains;
    case 'not_contains':
      return !contains;
    case 'starts_with':
      return scalar.startsWith(expected);
    case 'ends_with':
      return scalar.endsWith(expected);
    case 'gt':
      return !isEmpty(raw) && Number(raw) > Number(expected);
    case 'gte':
      return !isEmpty(raw) && Number(raw) >= Number(expected);
    case 'lt':
      return !isEmpty(raw) && Number(raw) < Number(expected);
    case 'lte':
      return !isEmpty(raw) && Number(raw) <= Number(expected);
    case 'before':
      return !!scalar && scalar.slice(0, 10) < expected;
    case 'after':
      return !!scalar && scalar.slice(0, 10) > expected;
    case 'on_or_before':
      return !!scalar && scalar.slice(0, 10) <= expected;
    case 'on_or_after':
      return !!scalar && scalar.slice(0, 10) >= expected;
  }
}

const activeFilter = (rule: FilterGroup | FilterRule): boolean =>
  'rules' in rule
    ? rule.rules.some(activeFilter)
    : rule.operator === 'empty' || rule.operator === 'not_empty' || rule.value.length > 0;

export function matchesFilters(
  row: Page,
  group: FilterGroup | undefined,
  database: Database,
  pages: Page[],
): boolean {
  if (!group?.rules.length) return true;
  let hasActiveRule = false;
  for (const rule of group.rules) {
    if (!activeFilter(rule)) continue;
    hasActiveRule = true;
    const matches = 'rules' in rule
      ? matchesFilters(row, rule, database, pages)
      : matchesRule(row, rule, database, pages);
    if (group.conjunction === 'and' && !matches) return false;
    if (group.conjunction === 'or' && matches) return true;
  }
  return group.conjunction === 'and' || !hasActiveRule;
}

type ColorRules = NonNullable<DatabaseView['conditionalColors']>;
const conditionalRuleIndexes = new WeakMap<ColorRules, Map<string | undefined, ColorRules>>();
const hasColorCondition = (group: FilterGroup): boolean =>
  group.rules.some(activeFilter);

/** First matching rule for each target wins; empty drafts never color every row. */
export function conditionalColor(
  row: Page,
  view: DatabaseView,
  database: Database,
  pages: Page[],
  targetProperty?: string,
) {
  const rules = view.conditionalColors;
  if (
    !rules?.length ||
    !conditionalColorViews.includes(view.type) ||
    (targetProperty !== undefined && view.type !== 'table')
  )
    return undefined;
  let byTarget = conditionalRuleIndexes.get(rules);
  if (!byTarget) {
    byTarget = new Map();
    for (const rule of rules) {
      if (!hasColorCondition(rule.filter)) continue;
      const matching = byTarget.get(rule.targetProperty) || [];
      matching.push(rule);
      byTarget.set(rule.targetProperty, matching);
    }
    conditionalRuleIndexes.set(rules, byTarget);
  }
  return byTarget.get(targetProperty)?.find((rule) =>
    matchesFilters(row, rule.filter, database, pages))?.color;
}

const rowCollator = new Intl.Collator('zh-CN', { numeric: true });
const indexedRecordsByParent = new WeakMap<Page[], Map<string, Page[]>>();
function recordsByParent(pages: Page[]): Map<string, Page[]> {
  let index = indexedRecordsByParent.get(pages);
  if (index) return index;
  index = new Map();
  for (const row of pages) {
    const parentId = row.parentId;
    if (!parentId) continue;
    const siblings = index.get(parentId) || [];
    siblings.push(row);
    index.set(parentId, siblings);
  }
  indexedRecordsByParent.set(pages, index);
  return index;
}

export function queryRows(page: Page, view: DatabaseView, pages: Page[], search = ''): Page[] {
  const database = page.database!;
  const needle = search.trim().toLocaleLowerCase();
  const rows = (recordsByParent(pages).get(page.id) || []).filter(
    (row) =>
      !row.trashedAt &&
      !row.templateFor &&
      (!isTemplatePage(row, pages) || isTemplatePage(page, pages)) &&
      (!database.subItems ||
        ((view.subItemFilter !== 'parents' || !row.subItemOf) &&
          (view.subItemFilter !== 'children' || !!row.subItemOf) &&
          (subItemDisplay(view) !== 'card' || !row.subItemOf))) &&
      matchesFilters(row, view.filters, database, pages) &&
      (!needle ||
        row.title.toLocaleLowerCase().includes(needle) ||
        `${row.title} ${database.columns.map((column) => readColumnValue(row, column, pages)).join(' ')}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const sorts = (view.sorts || []).map((sort) => {
    const column = databaseColumn(database, sort.property);
    return {
      ...sort,
      column,
      optionOrder: column?.options && (isSelectProperty(column) || column.type === 'multiSelect')
        ? new Map<string, number>(column.options.map((option, index) => [option, index]))
        : undefined,
      tagValues: new Map<Page, string[]>(),
    };
  });
  if (!sorts.length && view.manualOrder?.length) {
    const positions = new Map(view.manualOrder.map((id, index) => [id, index]));
    const unranked = view.manualOrder.length;
    return rows.sort((a, b) =>
      (positions.get(a.id) ?? unranked) - (positions.get(b.id) ?? unranked));
  }
  const sortValues = new Map<Page, ReturnType<typeof columnValue>[]>();
  const sortValue = (row: Page, index: number) => {
    let values = sortValues.get(row);
    if (!values) sortValues.set(row, (values = []));
    if (!Object.hasOwn(values, index))
      values[index] = columnValue(row, sorts[index].property, database, pages);
    return values[index];
  };
  return rows.sort((a, b) => {
    for (let index = 0; index < sorts.length; index++) {
      const sort = sorts[index],
        column = sort.column;
      const av = sortValue(a, index);
      const bv = sortValue(b, index);
      let result = 0;
      if (isEmpty(av) || isEmpty(bv)) result = Number(isEmpty(av)) - Number(isEmpty(bv));
      else if (column?.type === 'date')
        result = dateEpoch(a.values[column.id]) - dateEpoch(b.values[column.id]);
      else if (sort.optionOrder) {
        const rank = (value: string) => sort.optionOrder!.get(value) ?? sort.optionOrder!.size;
        const compare = (left: string, right: string) =>
          rank(left) - rank(right) || rowCollator.compare(left, right);
        if (column?.type === 'multiSelect') {
          const orderedTags = (row: Page, value: typeof av) => {
            let tags = sort.tagValues.get(row);
            if (!tags) {
              tags = (Array.isArray(value) ? [...value] : [String(value)]).sort(compare);
              sort.tagValues.set(row, tags);
            }
            return tags;
          };
          const aTags = orderedTags(a, av), bTags = orderedTags(b, bv);
          for (let tag = 0; tag < Math.min(aTags.length, bTags.length); tag++) {
            result = compare(aTags[tag], bTags[tag]);
            if (result) break;
          }
          if (!result) result = aTags.length - bTags.length;
        } else result = compare(String(av), String(bv));
      }
      else if (typeof av === 'number' && typeof bv === 'number') result = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') result = Number(av) - Number(bv);
      else result = rowCollator.compare(String(av), String(bv));
      if (result) return sort.direction === 'asc' ? result : -result;
    }
    return 0;
  });
}

export type RowGroup = { key: string; label: string; rows: Page[] };
export function groupRows(
  rows: Page[],
  property: string | undefined,
  database: Database,
  pages: Page[],
  view?: DatabaseView,
): RowGroup[] {
  if (!property) return [{ key: '__all', label: '', rows }];
  const column = databaseColumn(database, property);
  const people = new Map<string, string>();
  if (column?.type === 'person') {
    for (const row of rows)
      for (const person of (row.values[column.id] || []) as PersonValue[])
        people.set(person.id, person.name);
  }
  const groups = new Map<string, Page[]>();
  const configuredOptions = new Set(column?.options || []);
  for (const option of configuredOptions) groups.set(option, []);
  groups.set('', []);
  for (const row of rows) {
    const raw =
      column?.type === 'relation'
        ? relationIds(row, column, pages)
        : column?.type === 'person'
          ? ((row.values[column.id] || []) as PersonValue[]).map((person) => person.id)
          : columnValue(row, property, database, pages);
    const groupedValue =
      column && isDateProperty(column) ? dateWall(propertyDateValue(row, column)).slice(0, 10) : raw;
    const keys = Array.isArray(groupedValue)
      ? groupedValue.length
        ? groupedValue.map(String)
        : ['']
      : [
          isEmpty(groupedValue)
            ? ''
            : typeof groupedValue === 'boolean'
              ? groupedValue
                ? '已勾选'
                : '未勾选'
              : String(groupedValue),
        ];
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
  }
  const relationPages = column?.type === 'relation' ? pageIndex(pages) : undefined;
  const hiddenGroups = new Set(view?.hiddenGroups || []);
  const revealedGroups = new Set(view?.revealedGroups || []);
  const visibleGroups = [...groups]
    .filter(([key, rows]) =>
      !hiddenGroups.has(key) &&
      (!view?.hideEmptyGroups || rows.length ||
        (configuredOptions.has(key) && revealedGroups.has(key))),
    )
    .map(([key, rows]) => ({
      key,
      label: key
        ? column?.type === 'relation'
          ? relationPages?.get(key)?.title || '无标题'
          : column?.type === 'person'
            ? people.get(key) || '未知人员'
            : key
        : '无 ' + (column?.name || '分组'),
      rows,
    }));
  if (!view?.groupOrder) return visibleGroups;
  const positions = new Map<string, number>();
  view.groupOrder.forEach((key, index) => {
    if (!positions.has(key)) positions.set(key, index);
  });
  return visibleGroups.sort((a, b) =>
    (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity));
}

export function valueForGroup(
  column: Property | undefined,
  key: string,
  previous?: Page['values'][string],
  from = '',
  person?: PersonValue,
): Page['values'][string] {
  if (column?.type === 'checkbox') return key === '已勾选';
  if (column?.type === 'number') return key === '' ? '' : Number(key);
  if (column?.type === 'person') {
    const selected = Array.isArray(previous) ? previous as PersonValue[] : [];
    const remaining = column.personLimit === 1
      ? []
      : selected.filter((value) => value.id !== from && value.id !== key);
    const assignee = key ? person || selected.find(value => value.id === key) : undefined;
    if (key && !assignee) throw new Error(`找不到负责人 ${key}`);
    return assignee ? [...remaining, assignee] : remaining;
  }
  if (column?.type === 'multiSelect' || column?.type === 'relation')
    return [
      ...new Set([
        ...(Array.isArray(previous)
          ? previous.filter((v): v is string => typeof v === 'string' && v !== from)
          : []),
        ...(key ? [key] : []),
      ]),
    ];
  return key;
}

export function visibleColumns(database: Database, view: DatabaseView): Property[] {
  const hidden = new Set(view.hiddenProperties || []);
  const visible = database.columns.filter((column) => !hidden.has(column.id));
  if (!view.propertyOrder?.length) return visible;
  const positions = new Map<string, number>();
  view.propertyOrder.forEach((id, index) => {
    if (!positions.has(id)) positions.set(id, index);
  });
  return visible.sort((a, b) =>
    (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
}

export function aggregateRows(
  rows: Page[],
  property: string,
  operation: Aggregate,
  database: Database,
  pages: Page[],
): number {
  if (operation === 'count') return rows.length;
  if (operation === 'count_unique') {
    const column = databaseColumn(database, property);
    if (column && ['person', 'relation', 'files'].includes(column.type)) {
      const ids = new Set<string>();
      for (const row of rows) {
        if (column.type === 'relation')
          for (const id of relationIds(row, column, pages)) ids.add(id);
        else if (column.type === 'person')
          for (const person of (row.values[column.id] || []) as PersonValue[]) ids.add(person.id);
        else if (column.type === 'files')
          for (const file of (row.values[column.id] || []) as FileValue[]) ids.add(file.id || file.url);
      }
      return ids.size;
    }
  }
  const values = rows.map((row) => columnValue(row, property, database, pages));
  const filled = values.filter((value) => !isEmpty(value));
  if (operation === 'count_values') return filled.length;
  if (operation === 'count_unique') return new Set(filled.flat().map(String)).size;
  if (operation === 'empty') return rows.length - filled.length;
  if (operation === 'percent_filled' || operation === 'percent_empty') {
    const count = operation === 'percent_empty' ? rows.length - filled.length : filled.length;
    return rows.length ? Math.round((count / rows.length) * 100) : 0;
  }
  const numbers = filled.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (!numbers.length) return 0;
  if (operation === 'min') return numbers.reduce((a, b) => Math.min(a, b));
  if (operation === 'max') return numbers.reduce((a, b) => Math.max(a, b));
  if (operation === 'range')
    return numbers.reduce((a, b) => Math.max(a, b)) - numbers.reduce((a, b) => Math.min(a, b));
  if (operation === 'median') {
    numbers.sort((a, b) => a - b);
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  }
  const sum = numbers.reduce((a, b) => a + b, 0);
  return operation === 'average' ? Math.round((sum / numbers.length) * 100) / 100 : sum;
}
