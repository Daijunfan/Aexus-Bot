import type { Page, Property, Workspace } from '../types.ts';
import { requireEditable, requireRecord } from '../core/access.ts';
import { CommandError } from '../core/errors.ts';
import { pageIndex } from '../model.ts';

const relationshipIndexes = new WeakMap<Page[], { subItems: Map<string, Page[]>; blocking: Map<string, string[]> }>();
function relationshipIndex(pages: Page[]) {
  let index = relationshipIndexes.get(pages);
  if (!index) {
    index = { subItems: new Map(), blocking: new Map() };
    for (const page of pages) {
      if (page.subItemOf) {
        const children = index.subItems.get(page.subItemOf) || [];
        children.push(page);
        index.subItems.set(page.subItemOf, children);
      }
      for (const id of new Set(page.blockedBy)) {
        const dependents = index.blocking.get(id) || [];
        dependents.push(page.id);
        index.blocking.set(id, dependents);
      }
    }
    relationshipIndexes.set(pages, index);
  }
  return index;
}
export function subItemsFor(pageId: string, pages: Page[]): Page[] {
  return (relationshipIndex(pages).subItems.get(pageId) || []).filter(page => !page.trashedAt);
}

export function relationIds(page: Page, column: Property, pages: Page[]): string[] {
  const value = page.values[column.id];
  let ids: string[];
  if (page.templateFor && Object.hasOwn(page.values, column.id))
    ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  else if (column.system === 'parentItem') ids = page.subItemOf ? [page.subItemOf] : [];
  else if (column.system === 'subItems')
    ids = subItemsFor(page.id, pages).map(page => page.id);
  else if (column.system === 'blockedBy') ids = page.blockedBy || [];
  else if (column.system === 'blocking')
    ids = relationshipIndex(pages).blocking.get(page.id) || [];
  else ids = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const index = pageIndex(pages);
  return ids.filter((id) => {
    const target = index.get(id);
    return target && !target.trashedAt;
  });
}
export function validateRelationships(workspace: Workspace) {
  const pages = pageIndex(workspace.pages);
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const ready: string[] = [];
  for (const page of workspace.pages) {
    if (page.subItemOf) {
      const parent = pages.get(page.subItemOf);
      if (!parent || parent.parentId !== page.parentId || !pages.get(page.parentId || '')?.database)
        throw new CommandError('INVALID_SUBITEM', '父项目必须是同一个数据库的记录');
    }
    const dependencies = page.blockedBy || [];
    remaining.set(page.id, dependencies.length);
    if (!dependencies.length) ready.push(page.id);
    for (const id of dependencies) {
      const dependency = pages.get(id);
      if (!dependency || dependency.parentId !== page.parentId || !pages.get(page.parentId || '')?.database)
        throw new CommandError('INVALID_DEPENDENCY', '依赖必须是同一数据库的记录');
      const children = dependents.get(id) || [];
      children.push(page.id);
      dependents.set(id, children);
    }
  }
  const checked = new Set<string>();
  for (const page of workspace.pages) {
    const path = new Set<string>();
    let current: Page | undefined = page;
    while (current && !checked.has(current.id)) {
      if (path.has(current.id)) throw new CommandError('SUBITEM_CYCLE', '子项目不能形成循环层级');
      path.add(current.id);
      current = pages.get(current.subItemOf || '');
    }
    for (const id of path) checked.add(id);
  }
  // Topological traversal handles deep dependency chains without recursion.
  for (let i = 0; i < ready.length; i++)
    for (const id of dependents.get(ready[i]) || []) {
      const count = remaining.get(id)! - 1;
      remaining.set(id, count);
      if (!count) ready.push(id);
    }
  if (ready.length !== workspace.pages.length)
    throw new CommandError('DEPENDENCY_CYCLE', '依赖关系不能形成循环');
}
export function assignSystemRelation(
  workspace: Workspace,
  pageId: string,
  system: NonNullable<Property['system']>,
  ids: string[],
): Workspace {
  const page = requireRecord(workspace, pageId);
  requireEditable(page);
  if (system === 'parentItem' && ids.length > 1)
    throw new CommandError('MULTIPLE_PARENTS', '一个子项目只能有一个父项目');
  for (const id of ids) {
    const target = requireRecord(workspace, id);
    requireEditable(target);
    if (target.parentId !== page.parentId)
      throw new CommandError('INVALID_RELATION', '请选择同一数据库中的记录');
  }
  const now = Date.now();
  const next = {
    ...workspace,
    pages: workspace.pages.map((value) => {
      if (system === 'parentItem' && value.id === page.id)
        return { ...value, subItemOf: ids[0] || null, updatedAt: now };
      if (system === 'blockedBy' && value.id === page.id)
        return { ...value, blockedBy: [...new Set(ids)], updatedAt: now };
      if (system === 'subItems' && (value.subItemOf === page.id || ids.includes(value.id))) {
        requireEditable(value);
        return { ...value, subItemOf: ids.includes(value.id) ? page.id : null, updatedAt: now };
      }
      if (system === 'blocking' && (value.blockedBy?.includes(page.id) || ids.includes(value.id))) {
        requireEditable(value);
        return {
          ...value,
          blockedBy: ids.includes(value.id)
            ? [...new Set([...(value.blockedBy || []), page.id])]
            : value.blockedBy?.filter((id) => id !== page.id),
          updatedAt: now,
        };
      }
      return value;
    }),
  };
  validateRelationships(next);
  return next;
}
export function applySystemValues(workspace: Workspace, pageId: string, values: Page['values']) {
  const page = workspace.pages.find((page) => page.id === pageId)!;
  if (page.templateFor) return workspace;
  const columns = workspace.pages.find((parent) => parent.id === page.parentId)?.database?.columns || [];
  const configured = columns.filter((column) => column.system && Object.hasOwn(values, column.id));
  if (!configured.length) return workspace;
  for (const column of configured) {
    const value = values[column.id];
    workspace = assignSystemRelation(
      workspace,
      pageId,
      column.system!,
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : value
          ? [String(value)]
          : [],
    );
  }
  const systemIds = new Set(configured.map((column) => column.id));
  return {
    ...workspace,
    pages: workspace.pages.map((page) =>
      page.id === pageId
        ? {
            ...page,
            values: Object.fromEntries(Object.entries(page.values).filter(([id]) => !systemIds.has(id))),
          }
        : page,
    ),
  };
}
