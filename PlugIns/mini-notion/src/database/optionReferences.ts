import type { Workspace, FilterGroup, DatabaseView } from '../types.ts';
import type { ActionStep } from '../actions/types.ts';
import { flattenBlocks } from '../core/blocks.ts';
import { isSelectProperty } from './propertySchema.ts';
import { mapLinkedViews } from './linked.ts';

// Removing an option must clear saved group UI state as well as record values.
// Otherwise recreating a previously hidden option keeps the new column invisible.
export function removeOptionGroupReferences(
  workspace: Workspace,
  databaseId: string,
  propertyId: string,
  removedNames: string[],
): Workspace {
  if (!removedNames.length) return workspace;
  const removed = new Set(removedNames);
  const source = workspace.pages.find(page => page.id === databaseId);
  const defaultGroup = source?.database?.columns.find(isSelectProperty)?.id;
  const prune = (view: DatabaseView): DatabaseView => {
    if ((view.groupBy || (view.type === 'board' ? defaultGroup : undefined)) !== propertyId) return view;
    const changes: Partial<DatabaseView> = {};
    for (const field of ['hiddenGroups', 'collapsedGroups', 'groupOrder', 'revealedGroups'] as const)
      if (view[field]?.some(name => removed.has(name)))
        changes[field] = view[field]!.filter(name => !removed.has(name));
    return Object.keys(changes).length ? { ...view, ...changes } : view;
  };
  const next = mapLinkedViews(workspace, databaseId, prune);
  return {
    ...next,
    pages: next.pages.map(page => page.id === databaseId && page.database?.views
      ? { ...page, database: { ...page.database, views: page.database.views.map(prune) } }
      : page),
  };
}


// Option names are the public values in existing workspaces; keep their saved uses aligned on rename.
export function renameOptionReferences(
  workspace: Workspace,
  databaseId: string,
  propertyId: string,
  renames: Record<string, string> = {},
) {
  if (!Object.keys(renames).length) return workspace;
  const next = structuredClone(workspace);
  const value = (input: unknown): unknown =>
    typeof input === 'string' && Object.hasOwn(renames, input)
      ? renames[input]
      : Array.isArray(input)
        ? input.map(value)
        : input;
  const filters = (group: FilterGroup | undefined) => {
    for (const rule of group?.rules || [])
      if ('rules' in rule) filters(rule);
      else if (rule.property === propertyId) rule.value = value(rule.value) as string;
  };
  const defaultGroup = next.pages
    .find((page) => page.id === databaseId)
    ?.database?.columns.find(isSelectProperty)?.id;
  const viewReferences = (view: DatabaseView) => {
    filters(view.filters);
    view.conditionalColors?.forEach((rule) => filters(rule.filter));
    if ((view.groupBy || (view.type === 'board' ? defaultGroup : undefined)) !== propertyId) return;
    for (const field of ['hiddenGroups', 'collapsedGroups', 'groupOrder', 'revealedGroups'] as const)
      if (view[field]) view[field] = view[field].map((key) => value(key) as string);
  };
  const actions = (steps: ActionStep[], currentDatabase?: string | null) => {
    let createdDatabase: string | undefined;
    for (const step of steps) {
      const target = ['create', 'edit'].includes(step.type)
        ? step.databaseId
        : step.target === 'created'
          ? createdDatabase
          : step.target && step.target !== 'current'
            ? next.pages.find((page) => page.id === step.target)?.parentId
            : currentDatabase;
      if (target === databaseId) {
        if (step.values && Object.hasOwn(step.values, propertyId))
          step.values[propertyId] = value(step.values[propertyId]);
        filters(step.filters);
      }
      if (step.type === 'create') createdDatabase = step.databaseId;
    }
  };
  for (const page of next.pages) {
    if (page.database) {
      if (page.id === databaseId) for (const view of page.database.views || []) viewReferences(view);
      for (const column of page.database.columns) if (column.button) actions(column.button.actions, page.id);
      for (const rule of page.database.automations || []) {
        if (page.id === databaseId) filters(rule.filters);
        actions(rule.actions, page.id);
      }
    }
    for (const { block } of flattenBlocks(page.blocks)) {
      if (block.type === 'button' && block.props?.actions) {
        const steps = JSON.parse(String(block.props.actions));
        actions(steps, page.parentId);
        block.props.actions = JSON.stringify(steps);
      }
      if (block.type === 'databaseView' && block.props?.databaseId === databaseId && block.props.viewState) {
        const state = JSON.parse(String(block.props.viewState));
        for (const view of state.views || []) viewReferences(view);
        block.props.viewState = JSON.stringify(state);
      }
    }
  }
  return next;
}
