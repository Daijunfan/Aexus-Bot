import type { Property, StatusGroup } from '../types.ts';
import { CommandError } from '../core/errors.ts';
import { propertyColors, statusGroup, statusGroupOrder } from './propertySchema.ts';

/**
 * Apply one option operation to the *current* property, not a UI snapshot.
 * This preserves unrelated options when a CLI command or another view updates
 * the same database between opening and saving the category editor.
 */
export type OptionEdit = {
  kind: 'create' | 'update' | 'delete';
  value?: string;
  name?: string;
  color?: string;
  bucket?: StatusGroup;
};

export function applyOptionEdit(
  column: Property,
  edit: OptionEdit,
): { changes: Partial<Property>; optionRenames?: Record<string, string> } {
  if (!edit || !['create', 'update', 'delete'].includes(edit.kind) ||
      !['select', 'multiSelect', 'status'].includes(column.type))
    throw new CommandError('INVALID_OPTION_EDIT', '只有单选、多选或状态属性可以管理分类选项');

  const options = [...(column.options || [])];
  const existing = edit.value;
  if (edit.kind !== 'create' && (typeof existing !== 'string' || !options.includes(existing)))
    throw new CommandError('OPTION_NOT_FOUND', '此分类已被修改或删除，请刷新后重试');
  if (edit.kind === 'create' && edit.value !== undefined)
    throw new CommandError('INVALID_OPTION_EDIT', '新增分类不能指定已有选项');

  const name = edit.kind === 'delete' ? '' : edit.name?.trim();
  if (edit.kind !== 'delete' && !name)
    throw new CommandError('INVALID_OPTION_NAME', '请输入分类名称');
  if (edit.kind !== 'delete' && options.some(value => value === name && value !== existing))
    throw new CommandError('DUPLICATE_OPTION', '这个分类名称已存在');
  if (edit.color !== undefined && !propertyColors.includes(edit.color))
    throw new CommandError('INVALID_COLOR', '选项颜色无效');
  if (edit.bucket !== undefined && !statusGroupOrder.includes(edit.bucket))
    throw new CommandError('INVALID_STATUS', '状态分组无效');

  const nextOptions = edit.kind === 'create' ? [...options, name!] :
    edit.kind === 'delete' ? options.filter(value => value !== existing) :
    options.map(value => value === existing ? name! : value);
  if (column.type === 'status' && nextOptions.length === 0)
    throw new CommandError('INVALID_STATUS', '至少保留一个状态');

  const optionColors = { ...column.optionColors };
  if (existing !== undefined) delete optionColors[existing];
  if (edit.kind !== 'delete')
    optionColors[name!] = edit.color || column.optionColors?.[existing || ''] || 'gray';
  const changes: Partial<Property> = { options: nextOptions, optionColors };

  if (column.type === 'status') {
    const target = edit.bucket || (existing === undefined ? 'todo' : statusGroup(column, existing));
    const groups = Object.fromEntries(statusGroupOrder.map(group => [
      group,
      [...(column.statusGroups?.[group] || [])].filter(value => value !== existing),
    ])) as Record<StatusGroup, string[]>;
    if (edit.kind !== 'delete') {
      // An unchanged bucket retains the option's position.
      const previous = existing === undefined ? [] : column.statusGroups?.[target] || [];
      const index = previous.indexOf(existing || '');
      if (index >= 0) groups[target].splice(index, 0, name!);
      else groups[target].push(name!);
    }
    changes.statusGroups = groups;
    if (column.defaultStatus === existing && edit.kind === 'update')
      changes.defaultStatus = name;
  }
  return {
    changes,
    ...(edit.kind === 'update' && existing !== name
      ? { optionRenames: { [existing!]: name! } }
      : {}),
  };
}
