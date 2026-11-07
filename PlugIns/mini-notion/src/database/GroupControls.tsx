import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, EyeOff, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type { DatabaseView, Page, Property, StatusGroup } from '../types';
import { useWorkspace } from '../store';
import { IconButton, MenuItem, Modal, Popover } from '../ui';
import { iconColors } from '../core/icons';
import { Tag } from './Properties';
import { propertyColors, statusGroup, statusGroupNames, statusGroupOrder } from './propertySchema';
import type { RowGroup } from './model';

const editableOptions = (column?: Property) => !!column && ['select', 'multiSelect', 'status'].includes(column.type);

export type GroupEditorAnchor = { x: number; y: number };

// Anchor the lightweight editor to the action that opened it. Missing triggers
// (for example, after creating a grouping property) use the database's main action.
export function groupEditorAnchor(target: Element | null): GroupEditorAnchor {
  const rect = target?.getBoundingClientRect();
  return rect
    ? { x: rect.left, y: rect.bottom + 5 }
    : { x: Math.max(8, (window.innerWidth - 316) / 2), y: Math.max(8, window.innerHeight / 3) };
}

export function GroupOptionEditor({ page, column, value, anchor, onClose, onCreated, revealViewId }: {
  page: Page; column: Property; value?: string; anchor: GroupEditorAnchor;
  onClose: () => void; onCreated?: (name: string) => void; revealViewId?: string;
}) {
  const { api, notify } = useWorkspace();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(value || '');
  const [color, setColor] = useState(column.optionColors?.[value || ''] || 'gray');
  const [bucket, setBucket] = useState<StatusGroup>(statusGroup(column, value || ''));
  const duplicate = name.trim() !== value && !!column.options?.includes(name.trim());
  const valid = !!name.trim() && !duplicate && !page.locked && !submitting;
  const save = async () => {
    const nextName = name.trim();
    if (!valid) return;
    setSubmitting(true);
    try {
      // Send the one-option command to the single writer. A GUI patch assembled
      // from an older snapshot can overwrite CLI or Agent changes.
      await api('property.update', { databaseId: page.id, propertyId: column.id,
        optionEdit: { kind: value === undefined ? 'create' : 'update', value, name: nextName,
          color, ...(column.type === 'status' ? { bucket } : {}) },
        ...(value === undefined && revealViewId ? { revealViewId } : {}) });
      onCreated?.(nextName);
      onClose();
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setSubmitting(false); }
  };
  return <Popover x={anchor.x} y={anchor.y} width={316} role="dialog"
    label={value === undefined ? '新增分类' : '编辑分类'}
    onClose={() => { if (!submitting) onClose(); }} className="group-option-editor">
    <div className="group-option-heading">
      <strong>{value === undefined ? '新增分类' : '编辑分类'}</strong>
      <span>{column.name}</span>
    </div>
    <form onSubmit={event => { event.preventDefault(); save(); }}
      onKeyDown={event => {
        // Enter used to accept an IME candidate must not create a category.
        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
      }}>
      <label className="field-label">分类名称
        <input aria-label="分类名称" value={name} onChange={event => setName(event.target.value)}
          aria-invalid={duplicate} aria-describedby={duplicate ? 'group-name-error' : undefined}
          onFocus={event => { if (value !== undefined) event.currentTarget.select(); }}
          placeholder="输入分类名称" />
      </label>
      {duplicate && <small id="group-name-error" role="alert" className="group-option-error">这个分类名称已存在</small>}
      {column.type === 'status' && <label className="field-label">状态分组
        <select aria-label="状态分组" value={bucket} onChange={event => setBucket(event.target.value as StatusGroup)}>
          {statusGroupOrder.map(group => <option key={group} value={group}>{statusGroupNames[group]}</option>)}
        </select>
      </label>}
      <span className="field-label">颜色</span>
      <div className="group-option-colors" role="group" aria-label="分类颜色">
        {propertyColors.map(value => <button key={value} type="button"
          aria-label={iconColors[value as keyof typeof iconColors].name} aria-pressed={color === value}
          style={{ background: iconColors[value as keyof typeof iconColors].light }}
          onClick={() => setColor(value)} />)}
      </div>
      <p className="group-option-hint">分类选项会同步到使用「{column.name}」的全部视图。</p>
      <div className="group-option-actions">
        <button type="button" disabled={submitting} onClick={onClose}>取消</button>
        <button type="submit" className="primary-button" disabled={!valid}>{submitting ? '保存中…' : '保存'}</button>
      </div>
    </form>
  </Popover>;
}

export function AddGroupButton({ page, view, propertyId = view.groupBy, updateView, placement = 'above', onCreated }: {
  page: Page; view: DatabaseView; propertyId?: string; updateView: (changes: Partial<DatabaseView>) => void;
  placement?: 'above' | 'board-end'; onCreated?: (name: string) => void;
}) {
  const [open, setOpen] = useState<GroupEditorAnchor | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const column = page.database!.columns.find(column => column.id === propertyId);
  // Do not reset hideEmptyGroups: show only the new category once the
  // property command reaches the current snapshot, avoiding stale writes.
  useEffect(() => {
    if (!created || !column?.options?.includes(created)) return;
    if (!view.revealedGroups?.includes(created))
      updateView({ revealedGroups: [...(view.revealedGroups || []), created] });
    setCreated(null);
  }, [created, column?.options, view.revealedGroups, updateView]);
  if (!editableOptions(column)) return null;
  return <>
    <button type="button" className={`group-add-button ${placement === 'board-end' ? 'group-add-board-column' : ''}`}
      aria-label={placement === 'board-end' ? '新增分类' : '新建分组'}
      title={`为「${column!.name}」添加一个可重命名的分类`}
      disabled={page.locked} onClick={event => setOpen(groupEditorAnchor(event.currentTarget))}>
      <Plus size={16} />{placement === 'board-end' ? '新增分类' : '新建分组'}
    </button>
    {open && <GroupOptionEditor page={page} column={column!} anchor={open} onClose={() => setOpen(null)}
      revealViewId={view.id} onCreated={name => onCreated ? onCreated(name) : setCreated(name)} />}
  </>;
}

export function GroupHeader({ page, view, group, groupKeys, propertyId = view.groupBy, updateView, editProperty, onAdd, className = 'database-group-heading' }: {
  page: Page; view: DatabaseView; group: RowGroup; groupKeys: string[]; propertyId?: string;
  updateView: (changes: Partial<DatabaseView>) => void; editProperty: (column: Property) => void;
  onAdd?: () => void; className?: string;
}) {
  const { api, notify } = useWorkspace();
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<GroupEditorAnchor | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const column = page.database!.columns.find(column => column.id === propertyId);
  const editable = editableOptions(column) && !!group.key;
  const collapsed = !!view.collapsedGroups?.includes(group.key);
  const order = [...new Set([...(view.groupOrder || []), ...groupKeys])];
  const position = order.indexOf(group.key);
  const toggle = () => updateView({ collapsedGroups: collapsed ? view.collapsedGroups?.filter(key => key !== group.key) : [...(view.collapsedGroups || []), group.key] });
  const move = (offset: number) => {
    const target = position + offset;
    if (target < 0 || target >= order.length) return;
    [order[position], order[target]] = [order[target], order[position]];
    updateView({ groupOrder: order }); setMenu(null);
  };
  const remove = async () => {
    if (!column || deletingBusy) return;
    setDeletingBusy(true);
    try { await api('property.update', { databaseId: page.id, propertyId: column.id,
      optionEdit: { kind: 'delete', value: group.key } }); setDeleting(false); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setDeletingBusy(false); }
  };
  return <>
    <div className={`${className} group-controls`} draggable={!page.locked}
      onDragStart={event => { if ((event.target as HTMLElement).closest('input')) return; event.dataTransfer.setData('application/x-mini-group', JSON.stringify({ databaseId: page.id, propertyId, key: group.key })); event.stopPropagation(); }}
      onDragOver={event => { if (!page.locked && event.dataTransfer.types.includes('application/x-mini-group')) { event.preventDefault(); event.stopPropagation(); } }}
      onDrop={event => {
        const value = event.dataTransfer.getData('application/x-mini-group'); if (!value || page.locked) return;
        event.preventDefault(); event.stopPropagation();
        const from = JSON.parse(value);
        if (from.databaseId !== page.id || from.propertyId !== propertyId || from.key === group.key) return;
        const next = order.filter(key => key !== from.key); next.splice(next.indexOf(group.key), 0, from.key); updateView({ groupOrder: next });
      }}>
      <IconButton label={`${collapsed ? '展开' : '折叠'}分组 ${group.label}`} onClick={toggle}><ChevronRight size={13} className={collapsed ? '' : 'rotated'} /></IconButton>
      <button ref={nameButton} className="group-name-button" draggable={false} disabled={page.locked || !editable}
        onClick={event => setEditing(groupEditorAnchor(event.currentTarget))} title={editable ? '重命名或更改颜色' : group.label}>
        {editable ? <><Tag value={group.label} options={column?.options} column={column} /><Pencil size={12} className="group-rename-hint" aria-hidden="true" /></> : <strong>{group.label}</strong>}
      </button>
      <small>{group.rows.length}</small>
      <IconButton label={`分组 ${group.label} 的更多操作`} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom }); }}><MoreHorizontal size={15} /></IconButton>
      {onAdd && <IconButton label={`在 ${group.label} 中新建`} disabled={page.locked} onClick={onAdd}><Plus size={15} /></IconButton>}
    </div>
    {menu && <Popover {...menu} onClose={() => setMenu(null)}>
      {editable && <MenuItem icon={<Pencil size={14} />} disabled={page.locked} onClick={() => { setMenu(null); setEditing(groupEditorAnchor(nameButton.current)); }}>重命名和颜色</MenuItem>}
      <MenuItem icon={<EyeOff size={14} />} onClick={() => { updateView({ hiddenGroups: [...(view.hiddenGroups || []), group.key] }); setMenu(null); }}>隐藏分组</MenuItem>
      <MenuItem icon={<ArrowUp size={14} />} disabled={position <= 0 || page.locked} onClick={() => move(-1)}>上移分组</MenuItem>
      <MenuItem icon={<ArrowDown size={14} />} disabled={position >= order.length - 1 || page.locked} onClick={() => move(1)}>下移分组</MenuItem>
      {column && <MenuItem icon={<Settings2 size={14} />} disabled={page.locked} onClick={() => { setMenu(null); editProperty(column); }}>编辑属性</MenuItem>}
      {editable && <MenuItem icon={<Trash2 size={14} />} disabled={page.locked || (column?.type === 'status' && column.options?.length === 1)} danger onClick={() => { setMenu(null); setDeleting(true); }}>删除分组</MenuItem>}
    </Popover>}
    {editing && column && <GroupOptionEditor page={page} column={column} value={group.key} anchor={editing} onClose={() => setEditing(null)} />}
    {deleting && <Modal title="删除分组" onClose={() => setDeleting(false)} className="group-option-dialog">
      <p>删除「{group.label}」这个选项，保留全部记录。{column?.type === 'status' ? '相关记录将使用默认状态。' : '相关记录中的该分类值会被移除。'}</p>
      <div className="modal-actions"><button disabled={deletingBusy} onClick={() => setDeleting(false)}>取消</button><button className="danger-button" disabled={deletingBusy} onClick={remove}>删除</button></div>
    </Modal>}
  </>;
}
