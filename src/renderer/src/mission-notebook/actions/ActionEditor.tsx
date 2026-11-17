import {AppSelect} from '../components/AppSelect';
import { isSelectProperty, isReadOnlyProperty } from '../../../../shared/mission-notebook/database/propertySchema';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Sigma } from 'lucide-react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { AllSelection } from '@tiptap/pm/state';
import { schema, editorDictionary, saveAsset } from '../components/Editor';
import { EditorPageContext } from '../content/SyncedBlock';
import { useWorkspace } from '../store';
import { IconButton, Popover, MenuItem, PageIcon } from '../ui';
import { DateInput } from '../database/DateInput';
import { FilterEditor } from '../database/ViewSettings';
import { emptyFilters } from '../../../../shared/mission-notebook/database/model';
import { flattenBlocks } from '../../../../shared/mission-notebook/core/blocks';
import { dateText, isDateValue } from '../../../../shared/mission-notebook/database/dateValue';
import { plainText, isInternalPage } from '../../../../shared/mission-notebook/model';
import { actionTypes } from '../../../../shared/mission-notebook/actions/engine';
import type { ActionStep } from '../../../../shared/mission-notebook/actions/types';
import type { JsonBlock, Property } from '../../../../shared/mission-notebook/types';
import { PeoplePicker } from '../database/PeoplePicker';
import { FilesPicker } from '../database/FilesPicker';

const initialValue = (column?: Property) =>
  column?.type === 'checkbox'
    ? false
    : column?.type === 'number'
      ? 0
      : ['multiSelect', 'relation', 'person', 'files'].includes(column?.type || '')
        ? []
        : '';
function RelationValue({
  column,
  value,
  onChange,
  label,
}: {
  column: Property;
  value: unknown;
  onChange: (value: string[]) => void;
  label: string;
}) {
  const { workspace } = useWorkspace();
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const records = workspace!.pages.filter(
    (page) =>
      page.parentId === column.relationTo && !page.trashedAt && !isInternalPage(page, workspace!.pages),
  );
  return (
    <>
      <button
        className="action-relation-value"
        aria-label={label}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPicker({ x: rect.left, y: rect.bottom + 4 });
          setQuery('');
        }}
      >
        {selected.length
          ? selected.map((id) => records.find((page) => page.id === id)?.title || '已移除页面').join('、')
          : '选择关联页面…'}
      </button>
      {picker && (
        <Popover {...picker} width={310} onClose={() => setPicker(null)}>
          <input
            className="menu-search"
            placeholder="搜索关联页面…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {records
            .filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            .map((page) => (
              <MenuItem
                key={page.id}
                checked={selected.includes(page.id)}
                icon={<PageIcon icon={page.icon} size={15} />}
                onClick={() =>
                  onChange(
                    selected.includes(page.id)
                      ? selected.filter((id) => id !== page.id)
                      : column.system === 'parentItem'
                        ? [page.id]
                        : [...selected, page.id],
                  )
                }
              >
                {page.title || '无标题'}
              </MenuItem>
            ))}
          <div className="menu-divider" />
          <MenuItem
            onClick={() => {
              onChange([]);
              setPicker(null);
            }}
          >
            清空关联
          </MenuItem>
        </Popover>
      )}
    </>
  );
}
function ValueEditor({
  value,
  onChange,
  column,
  label,
  onBusyChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  column?: Property;
  label: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const formula = !!value && typeof value === 'object' && !Array.isArray(value) && 'formula' in value;
  return (
    <div className="action-value">
      <IconButton
        label={`切换${label}的公式`}
        active={formula}
        onClick={() => onChange(formula ? initialValue(column) : { formula: '' })}
      >
        <Sigma size={14} />
      </IconButton>
      {formula ? (
        <textarea
          aria-label={`${label}公式`}
          rows={2}
          placeholder='例如 prop("次数") + 1'
          value={String((value as any).formula)}
          onChange={(event) => onChange({ formula: event.target.value })}
        />
      ) : column?.type === 'date' ? (
        <DateInput label={label} value={value} onChange={onChange} />
      ) : column?.type === 'person' ? (
        <PeoplePicker label={label} value={value} onChange={onChange} single={column.personLimit === 1} />
      ) : column?.type === 'files' ? (
        <FilesPicker label={label} value={value} onChange={onChange} onBusyChange={onBusyChange} />
      ) : column?.type === 'relation' ? (
        <RelationValue column={column} value={value} onChange={onChange} label={label} />
      ) : column?.type === 'checkbox' ? (
        <input
          aria-label={label}
          type="checkbox"
          checked={!!value}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : column && isSelectProperty(column) ? (
        <AppSelect
          aria-label={label}
          value={String(value || '')}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">空</option>
          {column.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </AppSelect>
      ) : (
        <input
          aria-label={label}
          type={column?.type === 'number' ? 'number' : 'text'}
          value={
            Array.isArray(value)
              ? value.join(', ')
              : typeof value === 'object' && value !== null
                ? JSON.stringify(value)
                : String(value ?? '')
          }
          placeholder={column?.type === 'multiSelect' ? '选项，用逗号分隔' : '输入内容'}
          onChange={(event) =>
            onChange(
              column?.type === 'number'
                ? event.target.value === ''
                  ? ''
                  : Number(event.target.value)
                : column?.type === 'multiSelect'
                  ? event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean)
                  : event.target.value,
            )
          }
        />
      )}
    </div>
  );
}
function DraftBlocks({
  blocks,
  onChange,
  theme,
}: {
  blocks: JsonBlock[];
  onChange: (blocks: JsonBlock[]) => void;
  theme: 'light' | 'dark';
}) {
  const editor = useCreateBlockNote({
    schema,
    dictionary: editorDictionary,
    initialContent: blocks.length ? (blocks as any) : undefined,
    uploadFile: saveAsset,
  });
  useEffect(() => {
    const select = () => {
      if (document.activeElement?.closest('.bn-editor') === editor.prosemirrorView.dom) {
        editor.transact((tr) => tr.setSelection(new AllSelection(tr.doc)));
        editor.focus();
      }
    };
    window.addEventListener('mini:select-all', select);
    return () => window.removeEventListener('mini:select-all', select);
  }, [editor]);
  return (
    <EditorPageContext.Provider value={{ pageId: 'action-draft', theme, readOnly: true }}>
      <div className="action-draft-editor">
        <BlockNoteView
          editor={editor}
          theme={theme}
          onChange={() => onChange(editor.document as JsonBlock[])}
        />
      </div>
    </EditorPageContext.Provider>
  );
}
function Assignments({
  step,
  columns,
  onChange,
  onBusyChange,
}: {
  step: ActionStep;
  columns: Property[];
  onChange: (step: ActionStep) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const keys = [
    ...(step.title === undefined ? [] : ['title']),
    ...new Set([...Object.keys(step.values || {}), ...Object.keys(step.operations || {})]),
  ];
  const remove = (id: string) => {
    const next = { ...step, values: { ...step.values }, operations: { ...step.operations } };
    if (id === 'title') delete next.title;
    else {
      delete next.values![id];
      delete next.operations![id];
    }
    onChange(next);
  };
  return (
    <div className="action-assignments">
      {keys.map((id) => {
        const column = columns.find((column) => column.id === id),
          operation = step.operations?.[id] || 'set';
        return (
          <div className="action-assignment" key={id}>
            <div>
              <strong>{id === 'title' ? '名称' : column?.name || `已移除：${id}`}</strong>
              {id !== 'title' && step.type !== 'create' && (
                <AppSelect
                  aria-label="属性动作"
                  value={operation}
                  onChange={(event) =>
                    onChange({ ...step, operations: { ...step.operations, [id]: event.target.value as any } })
                  }
                >
                  <option value="set">设为</option>
                  <option value="clear">清空</option>
                  {column?.type === 'checkbox' && <option value="toggle">切换</option>}
                  {['relation', 'multiSelect', 'person', 'files'].includes(column?.type || '') && (
                    <>
                      <option value="add">追加</option>
                      <option value="remove">移除</option>
                    </>
                  )}
                </AppSelect>
              )}
              <IconButton label="移除此属性动作" onClick={() => remove(id)}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            {!['clear', 'toggle'].includes(operation) && (
              <ValueEditor
                onBusyChange={onBusyChange}
                column={column}
                label={`${id === 'title' ? '名称' : column?.name || id}动作值`}
                value={id === 'title' ? step.title : step.values?.[id]}
                onChange={(value) =>
                  onChange(
                    id === 'title'
                      ? { ...step, title: value }
                      : { ...step, values: { ...step.values, [id]: value } },
                  )
                }
              />
            )}
          </div>
        );
      })}
      <AppSelect
        className="action-add-property"
        aria-label="添加属性动作"
        value=""
        onChange={(event) => {
          const id = event.target.value;
          if (id)
            onChange(
              id === 'title'
                ? { ...step, title: '' }
                : {
                    ...step,
                    values: {
                      ...step.values,
                      [id]: initialValue(columns.find((column) => column.id === id)),
                    },
                  },
            );
        }}
      >
        <option value="">＋ 选择要设置的属性</option>
        {!keys.includes('title') && <option value="title">名称</option>}
        {columns
          .filter((column) => !keys.includes(column.id) && !isReadOnlyProperty(column))
          .map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
      </AppSelect>
    </div>
  );
}
type ActionEmployee = { id: string; title: string; engine: string; ready?: boolean; busy?: boolean };

function initialActionStep(stepId: string, nextType: ActionStep['type'], defaultDbId?: string): ActionStep {
  if (nextType === 'create' || nextType === 'edit') {
    return { id: stepId, type: nextType, databaseId: defaultDbId };
  }
  if (nextType === 'insert') {
    return { id: stepId, type: 'insert', blocks: [{ type: 'paragraph', content: '' }], position: 'end' };
  }
  if (nextType === 'agent') {
    return {
      id: stepId,
      type: 'agent',
      target: 'current',
      deliveryMode: 'direct',
      grantPageAccess: 'read',
      prompt: '请处理当前页面「{{title}}」（pageId={{pageId}}）。',
    };
  }
  if (nextType === 'mission') {
    return {
      id: stepId,
      type: 'mission',
      target: 'current',
      missionType: 'supervised',
      reminderSeconds: 1800,
      grantPageAccess: 'read',
      employeeIds: [],
      title: '{{title}}',
      prompt: '持续跟进当前页面「{{title}}」（pageId={{pageId}}）目标并交付验收结果。',
    };
  }
  if (nextType === 'schedule') {
    return {
      id: stepId,
      type: 'schedule',
      target: 'current',
      scheduleKind: 'interval',
      everySeconds: 3600,
      grantPageAccess: 'read',
      title: '{{title}} · 自动工作流',
      prompt: '定期检查页面「{{title}}」（pageId={{pageId}}）并执行工作流。',
    };
  }
  return { id: stepId, type: nextType };
}

export function ActionEditor({
  steps,
  onChange,
  pageId,
  databaseId,
  automatic = false,
  onBusyChange,
}: {
  steps: ActionStep[];
  onChange: (steps: ActionStep[]) => void;
  pageId: string;
  databaseId?: string;
  automatic?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { workspace, api } = useWorkspace();
  const pages = workspace!.pages.filter((page) => !page.trashedAt),
    source = pages.find((page) => page.id === pageId);
  const [jsonId, setJsonId] = useState<string | null>(null),
    [json, setJson] = useState(''),
    [jsonError, setJsonError] = useState('');
  const [employees, setEmployees] = useState<ActionEmployee[]>([]);
  useEffect(() => {
    let active = true;
    void api('assistant.list', {})
      .then((list) => {
        if (active && Array.isArray(list)) setEmployees(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const databases = pages.filter((page) => page.database && !isInternalPage(page, workspace!.pages));
  const update = (id: string, next: ActionStep) =>
    onChange(steps.map((step) => (step.id === id ? next : step)));
  return (
    <div className="action-editor">
      {steps.map((step, index) => {
        const previousCreate = steps
          .slice(0, index)
          .filter((step) => step.type === 'create')
          .at(-1);
        const targetPage =
          step.target && step.target !== 'current' && step.target !== 'created'
            ? pages.find((page) => page.id === step.target)
            : source;
        const ownerId = ['create', 'edit'].includes(step.type)
          ? step.databaseId
          : step.target === 'created'
            ? previousCreate?.databaseId
            : targetPage?.parentId || databaseId;
        const owner = pages.find((page) => page.id === ownerId),
          columns = owner?.database?.columns || [];
        const targetPicker = ['set', 'insert', 'reminder', 'open', 'trash', 'agent', 'mission', 'schedule'].includes(step.type);
        return (
          <section className="action-step" key={step.id} data-action-id={step.id}>
            <header>
              <span>{index + 1}</span>
              <AppSelect
                aria-label="动作类型"
                value={step.type}
                onChange={(event) =>
                  update(step.id, initialActionStep(step.id, event.target.value as ActionStep['type'], databaseId || databases[0]?.id))
                }
              >
                {Object.entries(actionTypes)
                  .filter(([type]) => !automatic || type !== 'open')
                  .map(([type, name]) => (
                    <option key={type} value={type}>
                      {name}
                    </option>
                  ))}
              </AppSelect>
              <IconButton
                label="上移动作"
                disabled={!index}
                onClick={() => {
                  const next = [...steps];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                <ArrowUp size={13} />
              </IconButton>
              <IconButton
                label="下移动作"
                disabled={index === steps.length - 1}
                onClick={() => {
                  const next = [...steps];
                  [next[index + 1], next[index]] = [next[index], next[index + 1]];
                  onChange(next);
                }}
              >
                <ArrowDown size={13} />
              </IconButton>
              <IconButton
                label="删除动作"
                onClick={() => onChange(steps.filter((value) => value.id !== step.id))}
              >
                <Trash2 size={13} />
              </IconButton>
            </header>
            {targetPicker && (
              <label className="action-field">
                目标页面
                <AppSelect
                  aria-label="动作目标页面"
                  value={step.target || 'current'}
                  onChange={(event) => update(step.id, { ...step, target: event.target.value })}
                >
                  <option value="current">当前页面 / 触发页面</option>
                  {previousCreate && <option value="created">此前新建的页面</option>}
                  {pages
                    .filter((page) => !isInternalPage(page, workspace!.pages))
                    .map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.title || '无标题'}
                      </option>
                    ))}
                </AppSelect>
              </label>
            )}
            {['create', 'edit'].includes(step.type) && (
              <label className="action-field">
                目标数据库
                <AppSelect
                  aria-label="动作目标数据库"
                  value={step.databaseId || ''}
                  onChange={(event) =>
                    update(step.id, { ...step, databaseId: event.target.value, values: {}, operations: {} })
                  }
                >
                  <option value="">选择数据库…</option>
                  {databases.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.title || '无标题'}
                    </option>
                  ))}
                </AppSelect>
              </label>
            )}
            {step.type === 'create' && (
              <label className="action-field">
                页面模板
                <AppSelect
                  aria-label="动作页面模板"
                  value={step.templateId || ''}
                  onChange={(event) =>
                    update(step.id, { ...step, templateId: event.target.value || undefined })
                  }
                >
                  <option value="">使用数据库默认模板</option>
                  <option value="none">空白页面</option>
                  {pages
                    .filter((page) => page.templateFor === step.databaseId)
                    .map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.title || '无标题模板'}
                      </option>
                    ))}
                </AppSelect>
              </label>
            )}
            {step.type === 'edit' && owner?.database && (
              <details className="action-filter">
                <summary>筛选要修改的页面</summary>
                <FilterEditor
                  database={owner.database}
                  group={step.filters || emptyFilters()}
                  onChange={(filters) => update(step.id, { ...step, filters })}
                />
                <label className="action-field">
                  可选公式条件
                  <input
                    aria-label="动作筛选公式"
                    placeholder='current.prop("项目") == trigger.prop("项目")'
                    value={step.filterFormula || ''}
                    onChange={(event) => update(step.id, { ...step, filterFormula: event.target.value })}
                  />
                </label>
              </details>
            )}
            {['set', 'create', 'edit'].includes(step.type) && (
              <Assignments
                step={step}
                columns={columns}
                onChange={(next) => update(step.id, next)}
                onBusyChange={onBusyChange}
              />
            )}
            {step.type === 'variable' && (
              <>
                <label className="action-field">
                  变量名
                  <input
                    aria-label="动作变量名"
                    value={step.name || ''}
                    onChange={(event) => update(step.id, { ...step, name: event.target.value })}
                  />
                </label>
                <ValueEditor
                  label="变量值"
                  value={step.value}
                  onChange={(value) => update(step.id, { ...step, value })}
                />
              </>
            )}
            {(step.type === 'notify' || step.type === 'reminder') && (
              <>
                <label className="action-field">内容</label>
                <ValueEditor
                  label="通知内容"
                  value={step.text}
                  onChange={(text) => update(step.id, { ...step, text })}
                />
              </>
            )}
            {step.type === 'reminder' && (
              <>
                <label className="action-field">提醒时刻（ISO 时间或公式）</label>
                <ValueEditor
                  label="提醒时刻"
                  value={step.at}
                  onChange={(at) => update(step.id, { ...step, at })}
                />
              </>
            )}
            {step.type === 'open' && (
              <label className="action-field">
                打开方式
                <AppSelect
                  aria-label="动作打开方式"
                  value={step.mode || 'full'}
                  onChange={(event) => update(step.id, { ...step, mode: event.target.value as any })}
                >
                  <option value="full">完整页面</option>
                  <option value="side">侧边预览</option>
                  <option value="center">居中预览</option>
                </AppSelect>
              </label>
            )}
            {step.type === 'insert' && (
              <>
                <div className="action-insert-controls">
                  <AppSelect
                    aria-label="插入内容位置"
                    value={step.position || 'end'}
                    onChange={(event) => update(step.id, { ...step, position: event.target.value as any })}
                  >
                    <option value="end">页面底部</option>
                    <option value="start">页面顶部</option>
                    <option value="beforeButton">按钮之前</option>
                    <option value="afterButton">按钮之后</option>
                  </AppSelect>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      if (jsonId === step.id) {
                        try {
                          const blocks = JSON.parse(json);
                          if (!Array.isArray(blocks)) throw Error('需要块数组');
                          update(step.id, { ...step, blocks });
                          setJsonId(null);
                          setJsonError('');
                        } catch (error) {
                          setJsonError(String(error));
                        }
                      } else {
                        setJsonId(step.id);
                        setJson(JSON.stringify(step.blocks || [], null, 2));
                      }
                    }}
                  >
                    {jsonId === step.id ? '应用 JSON' : '编辑 JSON'}
                  </button>
                </div>
                {jsonId === step.id ? (
                  <textarea
                    className="action-json"
                    aria-label="插入块 JSON"
                    rows={7}
                    value={json}
                    onChange={(event) => setJson(event.target.value)}
                  />
                ) : (
                  <DraftBlocks
                    key={`${step.id}-content`}
                    theme={theme}
                    blocks={step.blocks || []}
                    onChange={(blocks) => update(step.id, { ...step, blocks })}
                  />
                )}{' '}
                {jsonError && <p className="action-error">{jsonError}</p>}
              </>
            )}
            {step.type === 'agent' && (
              <>
                <label className="action-field">
                  执行员工
                  <AppSelect
                    aria-label="执行员工"
                    value={step.employeeId || ''}
                    onChange={(event) => update(step.id, { ...step, employeeId: event.target.value })}
                  >
                    <option value="">选择 AI 员工…</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.title} ({emp.engine})
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="action-field">
                  派发方式
                  <AppSelect
                    aria-label="派发方式"
                    value={step.deliveryMode || 'direct'}
                    onChange={(event) => update(step.id, { ...step, deliveryMode: event.target.value as any })}
                  >
                    <option value="direct">私聊消息 (direct.send)</option>
                    <option value="session">原生工作会话 (session.send)</option>
                  </AppSelect>
                </label>
                <label className="action-field">
                  自动授予目标页面权限
                  <AppSelect
                    aria-label="页面访问授权"
                    value={step.grantPageAccess || 'read'}
                    onChange={(event) => update(step.id, { ...step, grantPageAccess: event.target.value as any })}
                  >
                    <option value="none">不自动授权</option>
                    <option value="read">只读当前页 (read)</option>
                    <option value="write">读写当前页 (write)</option>
                    <option value="create">读写与新建子页 (create)</option>
                  </AppSelect>
                </label>
                <label className="action-field">发送指令（支持 {"{{title}}"} / {"{{pageId}}"} 或公式）</label>
                <ValueEditor
                  label="派发指令"
                  value={step.prompt ?? ''}
                  onChange={(prompt) => update(step.id, { ...step, prompt })}
                />
              </>
            )}
            {step.type === 'mission' && (
              <>
                <label className="action-field">目标名称</label>
                <ValueEditor
                  label="目标名称"
                  value={step.title ?? ''}
                  onChange={(title) => update(step.id, { ...step, title })}
                />
                <div className="action-field">
                  <span>负责人列表（可多选）</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {employees.length === 0 ? (
                      <small className="muted">暂无可用员工</small>
                    ) : (
                      employees.map((emp) => {
                        const checked = (step.employeeIds || []).includes(emp.id);
                        return (
                          <label key={emp.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const cur = step.employeeIds || [];
                                update(step.id, {
                                  ...step,
                                  employeeIds: event.target.checked
                                    ? [...cur, emp.id]
                                    : cur.filter((id) => id !== emp.id),
                                });
                              }}
                            />
                            {emp.title}
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
                <label className="action-field">
                  督办模式
                  <AppSelect
                    aria-label="督办模式"
                    value={step.missionType || 'supervised'}
                    onChange={(event) => update(step.id, { ...step, missionType: event.target.value as any })}
                  >
                    <option value="supervised">持续督办 (Secretary + 执行员工)</option>
                    <option value="independent">独立目标 (仅提醒执行员工)</option>
                  </AppSelect>
                </label>
                <label className="action-field">
                  提醒周期（秒）
                  <input
                    aria-label="提醒周期（秒）"
                    type="number"
                    min={10}
                    value={step.reminderSeconds ?? 1800}
                    onChange={(event) =>
                      update(step.id, { ...step, reminderSeconds: Math.max(10, Number(event.target.value) || 1800) })
                    }
                  />
                </label>
                <label className="action-field">
                  自动授予目标页面权限
                  <AppSelect
                    aria-label="页面访问授权"
                    value={step.grantPageAccess || 'read'}
                    onChange={(event) => update(step.id, { ...step, grantPageAccess: event.target.value as any })}
                  >
                    <option value="none">不自动授权</option>
                    <option value="read">只读当前页 (read)</option>
                    <option value="write">读写当前页 (write)</option>
                    <option value="create">读写与新建子页 (create)</option>
                  </AppSelect>
                </label>
                <label className="action-field">目标说明（支持 {"{{title}}"} / {"{{pageId}}"} 或公式）</label>
                <ValueEditor
                  label="目标说明"
                  value={step.prompt ?? ''}
                  onChange={(prompt) => update(step.id, { ...step, prompt })}
                />
              </>
            )}
            {step.type === 'schedule' && (
              <>
                <label className="action-field">工作流名称</label>
                <ValueEditor
                  label="工作流名称"
                  value={step.title ?? ''}
                  onChange={(title) => update(step.id, { ...step, title })}
                />
                <label className="action-field">
                  执行员工
                  <AppSelect
                    aria-label="执行员工"
                    value={step.employeeId || ''}
                    onChange={(event) => update(step.id, { ...step, employeeId: event.target.value })}
                  >
                    <option value="">选择 AI 员工…</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.title} ({emp.engine})
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label className="action-field">
                  触发周期
                  <AppSelect
                    aria-label="触发周期"
                    value={step.scheduleKind || 'interval'}
                    onChange={(event) => update(step.id, { ...step, scheduleKind: event.target.value as any })}
                  >
                    <option value="once">单次定时 (once)</option>
                    <option value="interval">固定间隔 (interval)</option>
                    <option value="weekly">每周计划 (weekly)</option>
                    <option value="event">事件触发 (event)</option>
                  </AppSelect>
                </label>
                {(step.scheduleKind || 'interval') === 'once' && (
                  <>
                    <label className="action-field">执行时刻（ISO 时间或公式）</label>
                    <ValueEditor
                      label="执行时刻"
                      value={step.scheduleAt ?? ''}
                      onChange={(scheduleAt) => update(step.id, { ...step, scheduleAt })}
                    />
                  </>
                )}
                {(step.scheduleKind || 'interval') === 'interval' && (
                  <label className="action-field">
                    间隔分钟数
                    <input
                      aria-label="间隔分钟数"
                      type="number"
                      min={1}
                      value={Math.max(1, Math.round((step.everySeconds ?? 3600) / 60))}
                      onChange={(event) =>
                        update(step.id, { ...step, everySeconds: Math.max(1, Number(event.target.value) || 60) * 60 })
                      }
                    />
                  </label>
                )}
                {step.scheduleKind === 'weekly' && (
                  <>
                    <label className="action-field">
                      每日时间 (HH:MM)
                      <input
                        aria-label="每日时间"
                        type="text"
                        placeholder="09:00"
                        value={step.weeklyTime || '09:00'}
                        onChange={(event) => update(step.id, { ...step, weeklyTime: event.target.value })}
                      />
                    </label>
                    <div className="action-field">
                      <span>执行星期</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                          const days = step.weeklyDays?.length ? step.weeklyDays : [1];
                          const checked = days.includes(day);
                          return (
                            <label key={day} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const next = event.target.checked
                                    ? [...new Set([...days, day])].sort((a, b) => a - b)
                                    : days.filter((d) => d !== day);
                                  update(step.id, { ...step, weeklyDays: next.length ? next : [1] });
                                }}
                              />
                              周{['一', '二', '三', '四', '五', '六', '日'][day - 1]}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                {step.scheduleKind === 'event' && (
                  <label className="action-field">
                    监听事件
                    <AppSelect
                      aria-label="监听事件"
                      value={step.eventName || 'signal'}
                      onChange={(event) => update(step.id, { ...step, eventName: event.target.value as any })}
                    >
                      <option value="signal">手动/外部信号 (signal)</option>
                      <option value="channel.posted">频道新内容 (channel.posted)</option>
                      <option value="message.received">收到新消息 (message.received)</option>
                      <option value="session.completed">会话完成 (session.completed)</option>
                    </AppSelect>
                  </label>
                )}
                <label className="action-field">
                  自动授予目标页面权限
                  <AppSelect
                    aria-label="页面访问授权"
                    value={step.grantPageAccess || 'read'}
                    onChange={(event) => update(step.id, { ...step, grantPageAccess: event.target.value as any })}
                  >
                    <option value="none">不自动授权</option>
                    <option value="read">只读当前页 (read)</option>
                    <option value="write">读写当前页 (write)</option>
                    <option value="create">读写与新建子页 (create)</option>
                  </AppSelect>
                </label>
                <label className="action-field">定时任务指令（支持 {"{{title}}"} / {"{{pageId}}"} 或公式）</label>
                <ValueEditor
                  label="定时任务指令"
                  value={step.prompt ?? ''}
                  onChange={(prompt) => update(step.id, { ...step, prompt })}
                />
              </>
            )}
          </section>
        );
      })}
      <button
        type="button"
        className="action-add secondary-button"
        onClick={() => onChange([...steps, { id: crypto.randomUUID(), type: 'set', values: {} }])}
      >
        <Plus size={15} />
        添加动作
      </button>
      <p className="action-hint">
        公式可使用 prop("属性")、trigger、current、created、triggerTime，以及前面定义的变量。
      </p>
    </div>
  );
}
export function ActionPreview({ preview }: { preview: any }) {
  const { workspace } = useWorkspace();
  const format = (value: any) =>
    isDateValue(value)
      ? dateText(value)
      : Array.isArray(value)
        ? value.join('、')
        : value === undefined || value === null || value === ''
          ? '空'
          : typeof value === 'boolean'
            ? value
              ? '已勾选'
              : '未勾选'
            : String(value);
  const messages = (preview.changes?.meta?.after?.inbox || []).filter(
    (item: any) => !(preview.changes?.meta?.before?.inbox || []).some((old: any) => old.id === item.id),
  );
  return (
    <div className="action-preview">
      <strong>将影响 {preview.changes?.pages?.length || 0} 个页面</strong>
      {preview.changes?.pages?.map((change: any) => {
        const page = change.after || change.before,
          columns = workspace!.pages.find((owner) => owner.id === page.parentId)?.database?.columns || [];
        const before = new Map(
          flattenBlocks(change.before?.blocks || []).map((item) => [item.block.id, item.block]),
        );
        const changedBlocks = flattenBlocks(change.after?.blocks || []).filter(
          (item) => JSON.stringify(before.get(item.block.id)) !== JSON.stringify(item.block),
        );
        return (
          <div key={change.id}>
            <span>
              {!change.before
                ? '新建'
                : !change.after || (change.after.trashedAt && !change.before?.trashedAt)
                  ? '移除'
                  : '修改'}
            </span>
            <b>{page.title || '无标题'}</b>
            {Object.entries(change.after?.values || {})
              .filter(([id, value]) => JSON.stringify(value) !== JSON.stringify(change.before?.values?.[id]))
              .map(([id, value]) => (
                <small key={id}>
                  {columns.find((column) => column.id === id)?.name || id}：
                  {format(change.before?.values?.[id])} → {format(value)}
                </small>
              ))}
            {changedBlocks.length > 0 && (
              <small className="action-preview-content">
                {plainText(changedBlocks.map((item) => item.block)).slice(0, 600)}
              </small>
            )}
          </div>
        );
      })}
      {messages.map((item: any) => (
        <p key={item.id}>通知：{item.text}</p>
      ))}
      {preview.effects?.map((effect: any, index: number) => {
        if (effect.type === 'agent_dispatch') {
          return (
            <p key={index}>
              派发 AI 员工 <b>{effect.employeeId}</b>（{effect.deliveryMode === 'session' ? '工作会话' : '私聊'} · 授权 {effect.grantPageAccess}）：{effect.prompt.slice(0, 120)}
            </p>
          );
        }
        if (effect.type === 'mission_create') {
          return (
            <p key={index}>
              创建督办目标「<b>{effect.name}</b>」（{effect.missionType} · {effect.employeeIds.join(', ')}）
            </p>
          );
        }
        if (effect.type === 'schedule_create') {
          return (
            <p key={index}>
              创建定时工作流「<b>{effect.name}</b>」（{effect.scheduleKind} · {effect.employeeId}）
            </p>
          );
        }
        return (
          <p key={index}>
            打开：
            {preview.changes?.pages?.find((change: any) => change.id === effect.pageId)?.after?.title ||
              workspace!.pages.find((page) => page.id === effect.pageId)?.title ||
              effect.pageId}
          </p>
        );
      })}
    </div>
  );
}
