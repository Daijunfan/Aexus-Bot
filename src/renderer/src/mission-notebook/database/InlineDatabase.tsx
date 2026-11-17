import { lazy, Suspense, useContext, useState } from 'react';
import { LoadingSurface } from '../components/LoadingSurface';
import { createReactBlockSpec } from '@blocknote/react';
import { defaultProps } from '@blocknote/core';
import { ArrowUpRight, Calendar, Database as DatabaseIcon, Kanban, Link2, ListTodo, Plus } from 'lucide-react';
import { useWorkspace } from '../store';
import { EditorPageContext } from '../content/SyncedBlock';
import { MenuItem, PageIcon, Popover } from '../ui';
const Database = lazy(() => import('../components/Database').then(module => ({ default: module.Database })));
import { newView } from '../../../../shared/mission-notebook/database/model';
import type { DatabaseViewState, ViewType } from '../../../../shared/mission-notebook/types';
import { TASK_COL, createLinkedSingleViewState } from '../planning/taskDatabase';

function parseViewState(value: string): DatabaseViewState | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export const InlineDatabaseSpec = createReactBlockSpec(
  {
    type: 'databaseView',
    propSchema: {
      ...defaultProps,
      databaseId: { default: '' },
      linked: { default: false },
      viewState: { default: '' },
      title: { default: '数据库' },
    },
    content: 'none',
  },
  {
    // Database controls own their mouse/keyboard events; the side handle still
    // selects and drags the surrounding block container.
    meta: { selectable: false },
    render: ({ block, editor }) => {
      const { workspace, patch, navigate, setModal } = useWorkspace();
      const pageCtx = useContext(EditorPageContext);
      const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
      const [addViewMenu, setAddViewMenu] = useState<{ x: number; y: number } | null>(null);
      const [query, setQuery] = useState('');
      const source = workspace!.pages.find(
        (page) => page.id === block.props.databaseId && !page.trashedAt && page.database,
      );
      const isTaskDb = Boolean(
        source?.database?.columns.some((c) => c.id === TASK_COL.ref || c.id === TASK_COL.kind),
      );
      const insertSiblingViewBlock = (type: ViewType, label: string) => {
        if (!source) return;
        const viewState = isTaskDb
          ? createLinkedSingleViewState(type, label)
          : (() => {
              const v = newView(type, label);
              return JSON.stringify({ views: [v], activeViewId: v.id, view: v.type });
            })();
        editor.insertBlocks(
          [
            {
              type: 'databaseView',
              props: {
                databaseId: source.id,
                linked: true,
                title: `${source.title || '数据库'} · ${label}`,
                viewState,
              },
            },
          ],
          block,
          'after',
        );
        setAddViewMenu(null);
      };
      const choose = (id: string) => {
        const page = workspace!.pages.find((page) => page.id === id)!;
        const view = newView('table');
        editor.updateBlock(block, {
          props: {
            databaseId: id,
            linked: true,
            title: page.title || '无标题数据库',
            viewState: JSON.stringify({ views: [view], activeViewId: view.id, view: view.type }),
          },
        });
        setPicker(null);
      };
      return (
        <div
          className="inline-database"
          contentEditable={false}
          data-linked={block.props.linked}
          // Interacting with controls inside a database must not select its
          // containing ProseMirror block (or steal its native focus/drag).
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {source ? (
            <>
              <div className="inline-database-title">
                <PageIcon icon={source.icon || '📋'} size={20} />
                {block.props.linked ? (
                  <button
                    className="inline-linked-db-heading"
                    onClick={() => navigate(source.id)}
                    title={`打开源数据库：${source.title || '无标题数据库'}`}
                  >
                    <Link2 size={13} />
                    <span>{block.props.title || source.title || '关联数据库视图'}</span>
                    <ArrowUpRight size={13} />
                  </button>
                ) : (
                  <input
                    aria-label="内联数据库名称"
                    value={source.title}
                    placeholder="无标题数据库"
                    readOnly={source.locked}
                    onChange={(e) => patch(source.id, { title: e.target.value })}
                  />
                )}
                <div className="inline-db-header-actions">
                  {isTaskDb && !pageCtx?.readOnly && (
                    <button
                      type="button"
                      className="inline-db-action-pill is-accent"
                      data-db-add-task={source.id}
                      onClick={() =>
                        setModal({
                          type: 'page-task-composer',
                          pageId: pageCtx?.pageId || source.parentId || source.id,
                          databaseId: source.id,
                        })
                      }
                    >
                      <ListTodo size={13} />
                      <span>布置任务</span>
                    </button>
                  )}
                  {!pageCtx?.readOnly && (
                    <button
                      type="button"
                      className="inline-db-action-pill"
                      data-db-add-linked-view={source.id}
                      title="在当前页面下方插入该数据库的另一个可视化视图块"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setAddViewMenu({ x: rect.right - 220, y: rect.bottom + 5 });
                      }}
                    >
                      <Plus size={13} />
                      <span>同页加视图</span>
                    </button>
                  )}
                  {!block.props.linked && (
                    <button
                      className="text-button"
                      aria-label="打开数据库完整页面"
                      title="打开数据库完整页面"
                      onClick={() => navigate(source.id)}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  )}
                </div>
              </div>
              {addViewMenu && (
                <Popover {...addViewMenu} width={235} onClose={() => setAddViewMenu(null)}>
                  <div className="picker-heading">在本页下方嵌入多视图块</div>
                  <MenuItem icon={<Calendar size={15} />} onClick={() => insertSiblingViewBlock('calendar', '排期日历')}>
                    排期日历视图
                  </MenuItem>
                  <MenuItem icon={<Kanban size={15} />} onClick={() => insertSiblingViewBlock('board', '状态看板')}>
                    状态看板视图
                  </MenuItem>
                  <MenuItem icon={<DatabaseIcon size={15} />} onClick={() => insertSiblingViewBlock('timeline', '执行时间线')}>
                    执行时间线视图
                  </MenuItem>
                  <MenuItem icon={<DatabaseIcon size={15} />} onClick={() => insertSiblingViewBlock('plan', '日程规划')}>
                    日程规划视图
                  </MenuItem>
                  <MenuItem icon={<DatabaseIcon size={15} />} onClick={() => insertSiblingViewBlock('chart', '统计图表')}>
                    分布统计图视图
                  </MenuItem>
                  <MenuItem icon={<DatabaseIcon size={15} />} onClick={() => insertSiblingViewBlock('table', '表格视图')}>
                    结构化表格视图
                  </MenuItem>
                </Popover>
              )}
              <Suspense fallback={<LoadingSurface compact label="正在加载数据库…" />}><Database
                page={source}
                viewState={block.props.linked ? parseViewState(block.props.viewState) : undefined}
                onViewStateChange={
                  block.props.linked
                    ? (state) => editor.updateBlock(block, { props: { viewState: JSON.stringify(state) } })
                    : undefined
                }
              /></Suspense>
            </>
          ) : (
            <button
              className="linked-database-placeholder"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setPicker({ x: rect.left, y: rect.bottom + 5 });
              }}
            >
              <DatabaseIcon size={20} />
              <span>
                {block.props.databaseId ? '原数据库已删除 · 选择其他数据源' : '选择一个数据库，创建关联视图'}
              </span>
            </button>
          )}
          {picker && (
            <Popover {...picker} width={360} onClose={() => setPicker(null)}>
              <div className="picker-heading">关联到现有数据库</div>
              <input
                className="menu-search"
                placeholder="搜索数据库…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {workspace!.pages
                .filter(
                  (page) =>
                    page.database &&
                    !page.trashedAt &&
                    page.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((page) => (
                  <MenuItem
                    key={page.id}
                    icon={<PageIcon icon={page.icon} />}
                    onClick={() => choose(page.id)}
                  >
                    {page.title || '无标题数据库'}
                  </MenuItem>
                ))}
            </Popover>
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => (
      <p>
        <a href={`mission://page/${block.props.databaseId}`}>{block.props.title}</a>
      </p>
    ),
  },
);
