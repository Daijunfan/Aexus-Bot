import { Temporal } from '@js-temporal/polyfill';
import type { Mission } from '../../../../shared/missions';
import type { ScheduledJob } from '../../../../shared/scheduler';
import { emptyFilters } from '../../../../shared/mission-notebook/database/model';
import {
  dateParts,
  localTimeZone,
  makeDateValue,
} from '../../../../shared/mission-notebook/database/dateValue';
import { makePage } from '../../../../shared/mission-notebook/model';
import type {
  Database,
  DatabaseView,
  DatabaseViewState,
  JsonBlock,
  Page,
  Property,
  ViewType,
  Workspace,
} from '../../../../shared/mission-notebook/types';
import {
  formatMissionRule,
  formatScheduleRule,
  missionStatusBadge,
  PRIORITY_LABELS,
  scheduleRuleCategory,
  scheduleStatusBadge,
  userVisibleTags,
  type TaskEmployee,
} from './planningTypes';

export const TASK_COL = {
  kind: 'task_kind',
  status: 'task_status',
  assignee: 'task_assignee',
  schedule: 'task_schedule',
  rule: 'task_rule',
  priority: 'task_priority',
  tags: 'task_tags',
  ref: 'task_ref',
} as const;

export type TaskPagePreset = 'multi' | 'calendar' | 'board' | 'table';

export const TASK_KIND_LABELS: Record<'once' | 'repeat' | 'event' | 'mission', string> = {
  once: '定时单次',
  repeat: '重复周期',
  event: '事件驱动',
  mission: '持续督办',
};

export const TASK_KIND_ICONS: Record<'once' | 'repeat' | 'event' | 'mission', string> = {
  once: '⏱️',
  repeat: '🔁',
  event: '⚡',
  mission: '🎯',
};

export function parseTaskRef(
  raw: unknown,
): { kind: 'schedule' | 'mission'; id: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw.startsWith('schedule:') && raw.length > 9) {
    return { kind: 'schedule', id: raw.slice(9) };
  }
  if (raw.startsWith('mission:') && raw.length > 8) {
    return { kind: 'mission', id: raw.slice(8) };
  }
  return null;
}

export function getPageTaskRef(page: Page): { kind: 'schedule' | 'mission'; id: string } | null {
  const direct = parseTaskRef(page.values?.[TASK_COL.ref]);
  if (direct) return direct;
  for (const val of Object.values(page.values ?? {})) {
    const parsed = parseTaskRef(val);
    if (parsed) return parsed;
  }
  return null;
}

export function isTaskDatabase(database?: Database | null): boolean {
  return Boolean(
    database?.columns?.some((c) => c.id === TASK_COL.ref || c.id === TASK_COL.kind),
  );
}

export function buildAgentTaskColumns(assigneeOptions: string[] = [], tagOptions: string[] = []): Property[] {
  return [
    {
      id: TASK_COL.kind,
      name: '任务类型',
      type: 'select',
      options: ['定时单次', '重复周期', '事件驱动', '持续督办'],
      optionColors: {
        定时单次: 'blue',
        重复周期: 'purple',
        事件驱动: 'orange',
        持续督办: 'pink',
      },
    },
    {
      id: TASK_COL.status,
      name: '运行状态',
      type: 'status',
      options: ['已暂停', '授权失效', '已排期', '等待事件', '督办中', '需处理', '已完成', '已达次数上限'],
      defaultStatus: '已排期',
      statusGroups: {
        todo: ['已暂停', '授权失效'],
        doing: ['已排期', '等待事件', '督办中', '需处理'],
        done: ['已完成', '已达次数上限'],
      },
      optionColors: {
        已排期: 'blue',
        等待事件: 'orange',
        督办中: 'purple',
        需处理: 'red',
        已暂停: 'gray',
        授权失效: 'red',
        已完成: 'green',
        已达次数上限: 'green',
      },
    },
    {
      id: TASK_COL.assignee,
      name: '执行员工',
      type: 'multiSelect',
      options: [...new Set(assigneeOptions.filter(Boolean))],
    },
    {
      id: TASK_COL.schedule,
      name: '下次触发 / 排期',
      type: 'date',
    },
    {
      id: TASK_COL.rule,
      name: '触发规则',
      type: 'text',
    },
    {
      id: TASK_COL.priority,
      name: '优先级',
      type: 'select',
      options: ['紧急', '高', '普通', '低'],
      optionColors: {
        紧急: 'red',
        高: 'orange',
        普通: 'blue',
        低: 'gray',
      },
    },
    {
      id: TASK_COL.tags,
      name: '标签',
      type: 'multiSelect',
      options: [...new Set(tagOptions.filter(Boolean))],
    },
    {
      id: TASK_COL.ref,
      name: '任务关联ID',
      type: 'text',
    },
  ];
}

export function ensureAgentTaskColumns(
  database: Database,
  assigneeOptions: string[] = [],
  tagOptions: string[] = [],
): Database {
  const canonical = buildAgentTaskColumns(assigneeOptions, tagOptions);
  const existingById = new Map(database.columns.map((c) => [c.id, c]));
  let changed = false;
  const nextColumns = [...database.columns];

  for (const col of canonical) {
    const prev = existingById.get(col.id);
    if (!prev) {
      nextColumns.push(col);
      changed = true;
    } else if (col.options?.length) {
      const mergedOpts = [...new Set([...(prev.options ?? []), ...col.options])];
      if (mergedOpts.length !== (prev.options ?? []).length) {
        const idx = nextColumns.findIndex((c) => c.id === col.id);
        nextColumns[idx] = { ...prev, options: mergedOpts };
        changed = true;
      }
    }
  }

  const nextViews = database.views?.map((v) => {
    if (!(v.hiddenProperties ?? []).includes(TASK_COL.ref)) {
      changed = true;
      return { ...v, hiddenProperties: [...(v.hiddenProperties ?? []), TASK_COL.ref] };
    }
    return v;
  });

  if (!changed) return database;
  return {
    ...database,
    columns: nextColumns,
    ...(nextViews ? { views: nextViews } : {}),
  };
}

export function createTaskDatabaseViews(primaryType: ViewType = 'table'): {
  views: DatabaseView[];
  activeViewId: string;
  view: ViewType;
} {
  const hidden = [TASK_COL.ref];
  const tableView: DatabaseView = {
    id: crypto.randomUUID(),
    name: '任务总表',
    type: 'table',
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: hidden,
    openPagesIn: 'side',
    calculations: { title: 'count' },
    columnWidths: {
      title: 252,
      [TASK_COL.kind]: 96,
      [TASK_COL.status]: 98,
      [TASK_COL.assignee]: 128,
      [TASK_COL.schedule]: 148,
      [TASK_COL.rule]: 164,
      [TASK_COL.priority]: 74,
      [TASK_COL.tags]: 108,
    },
  };

  const boardView: DatabaseView = {
    id: crypto.randomUUID(),
    name: '状态看板',
    type: 'board',
    groupBy: TASK_COL.status,
    colorColumns: true,
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: hidden,
    openPagesIn: 'side',
  };

  const calendarView: DatabaseView = {
    id: crypto.randomUUID(),
    name: '排期日历',
    type: 'calendar',
    calendarBy: TASK_COL.schedule,
    calendarMode: 'month',
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: hidden,
    openPagesIn: 'side',
  };

  const timelineView: DatabaseView = {
    id: crypto.randomUUID(),
    name: '时间线',
    type: 'timeline',
    calendarBy: TASK_COL.schedule,
    timelineScale: 'week',
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: hidden,
    openPagesIn: 'side',
  };

  const planView: DatabaseView = {
    id: crypto.randomUUID(),
    name: '日程规划',
    type: 'plan',
    calendarBy: TASK_COL.schedule,
    planMode: 'week',
    planDoneBy: TASK_COL.status,
    planDoneValue: '已完成',
    planShowBacklog: true,
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: hidden,
    openPagesIn: 'side',
  };

  const chartView: DatabaseView = {
    id: crypto.randomUUID(),
    name: '统计图',
    type: 'chart',
    chartType: 'donut',
    chartGroup: TASK_COL.kind,
    chartAggregation: 'count',
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: hidden,
    openPagesIn: 'side',
  };

  const views = [tableView, boardView, calendarView, timelineView, planView, chartView];
  const active = views.find((v) => v.type === primaryType) ?? tableView;
  return {
    views,
    activeViewId: active.id,
    view: active.type,
  };
}

export function createLinkedSingleViewState(
  type: ViewType,
  name: string,
  extra: Partial<DatabaseView> = {},
): string {
  const view: DatabaseView = {
    id: crypto.randomUUID(),
    name,
    type,
    filters: emptyFilters(),
    sorts: [],
    hiddenProperties: [TASK_COL.ref],
    openPagesIn: 'side',
    ...(type === 'calendar' || type === 'timeline' || type === 'plan'
      ? { calendarBy: TASK_COL.schedule }
      : {}),
    ...(type === 'board'
      ? { groupBy: TASK_COL.status, colorColumns: true }
      : {}),
    ...(type === 'chart'
      ? { chartType: 'bar', chartGroup: TASK_COL.kind, chartAggregation: 'count' }
      : {}),
    ...extra,
  };
  const state: DatabaseViewState = {
    views: [view],
    activeViewId: view.id,
    view: view.type,
  };
  return JSON.stringify(state);
}

export function createAgentTaskDatabase(
  primaryType: ViewType = 'table',
  assigneeOptions: string[] = [],
  tagOptions: string[] = [],
): Database {
  const viewBundle = createTaskDatabaseViews(primaryType);
  return {
    columns: buildAgentTaskColumns(assigneeOptions, tagOptions),
    views: viewBundle.views,
    activeViewId: viewBundle.activeViewId,
    view: viewBundle.view,
    calendarBy: TASK_COL.schedule,
    groupBy: TASK_COL.status,
  };
}

function safeScheduleDateValue(
  iso: string | null | undefined,
  zone: string,
): Page['values'][string] {
  if (!iso) return '';
  try {
    const localZone = localTimeZone();
    if (!zone || zone === localZone) {
      return Temporal.Instant.from(iso)
        .toZonedDateTimeISO(localZone)
        .toPlainDateTime()
        .toString({ smallestUnit: 'minute' });
    }
    return makeDateValue(iso, undefined, zone);
  } catch {
    return '';
  }
}

function buildRecordBlocks(prompt: string, notes?: string): JsonBlock[] {
  const blocks: JsonBlock[] = [
    {
      id: crypto.randomUUID(),
      type: 'heading',
      props: { level: 3 },
      content: [{ type: 'text', text: '执行指令与交付目标', styles: {} }],
    },
    {
      id: crypto.randomUUID(),
      type: 'paragraph',
      content: prompt.trim()
        ? [{ type: 'text', text: prompt.trim(), styles: {} }]
        : [],
    },
  ];
  if (notes?.trim()) {
    blocks.push(
      {
        id: crypto.randomUUID(),
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: '规划备注', styles: {} }],
      },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: notes.trim(), styles: {} }],
      },
    );
  }
  return blocks;
}

export function jobToTaskRecordData(
  job: ScheduledJob,
  employees: TaskEmployee[],
  hostTimezone: string,
): {
  ref: string;
  title: string;
  icon: string;
  assignees: string[];
  tags: string[];
  values: Page['values'];
  blocks: JsonBlock[];
} {
  const category = scheduleRuleCategory(job);
  const badge = scheduleStatusBadge(job);
  const empName =
    employees.find((e) => e.id === job.action.employeeId)?.title || '未分配员工';
  const tags = userVisibleTags(job.plan?.tags);
  const zone =
    job.rule.kind === 'weekly' || job.rule.kind === 'monthly'
      ? job.rule.timezone || hostTimezone
      : hostTimezone;
  const dateSource =
    job.nextAt || (job.rule.kind === 'once' ? job.rule.at : undefined);
  const priorityLabel = PRIORITY_LABELS[job.plan?.priority || 'normal'] || '普通';
  const ref = `schedule:${job.id}`;

  return {
    ref,
    title: job.name,
    icon: TASK_KIND_ICONS[category],
    assignees: [empName],
    tags,
    values: {
      [TASK_COL.kind]: TASK_KIND_LABELS[category],
      [TASK_COL.status]: badge.label,
      [TASK_COL.assignee]: [empName],
      [TASK_COL.schedule]: safeScheduleDateValue(dateSource, zone),
      [TASK_COL.rule]: formatScheduleRule(job),
      [TASK_COL.priority]: priorityLabel,
      [TASK_COL.tags]: tags,
      [TASK_COL.ref]: ref,
    },
    blocks: buildRecordBlocks(job.action.prompt, job.plan?.notes),
  };
}

export function missionToTaskRecordData(
  mission: Mission,
  employees: TaskEmployee[],
  hostTimezone: string,
): {
  ref: string;
  title: string;
  icon: string;
  assignees: string[];
  tags: string[];
  values: Page['values'];
  blocks: JsonBlock[];
} {
  const badge = missionStatusBadge(mission);
  const assignees = mission.employeeIds.map(
    (id) => employees.find((e) => e.id === id)?.title || '未分配员工',
  );
  const tags = userVisibleTags(mission.plan?.tags);
  const priorityLabel = PRIORITY_LABELS[mission.plan?.priority || 'normal'] || '普通';
  const ref = `mission:${mission.id}`;

  return {
    ref,
    title: mission.name,
    icon: TASK_KIND_ICONS.mission,
    assignees,
    tags,
    values: {
      [TASK_COL.kind]: TASK_KIND_LABELS.mission,
      [TASK_COL.status]: badge.label,
      [TASK_COL.assignee]: assignees,
      [TASK_COL.schedule]: safeScheduleDateValue(mission.nextReminderAt, hostTimezone),
      [TASK_COL.rule]: formatMissionRule(mission),
      [TASK_COL.priority]: priorityLabel,
      [TASK_COL.tags]: tags,
      [TASK_COL.ref]: ref,
    },
    blocks: buildRecordBlocks(mission.prompt, mission.plan?.notes),
  };
}

export type PageDatabaseEntry = {
  databaseId: string;
  title: string;
  icon: string;
  isFullPageDatabase: boolean;
  viewCount: number;
  blockCountOnPage: number;
};

function collectDatabaseBlocks(blocks: JsonBlock[], out: JsonBlock[] = []): JsonBlock[] {
  for (const block of blocks ?? []) {
    if (block.type === 'databaseView' && typeof block.props?.databaseId === 'string' && block.props.databaseId) {
      out.push(block);
    }
    if (Array.isArray(block.children) && block.children.length) {
      collectDatabaseBlocks(block.children, out);
    }
  }
  return out;
}

export function findPageTaskDatabases(
  workspace: Workspace | null | undefined,
  hostPageId: string,
): PageDatabaseEntry[] {
  if (!workspace || !hostPageId) return [];
  const host = workspace.pages.find((p) => p.id === hostPageId && !p.trashedAt);
  if (!host) return [];

  if (host.database) {
    return [
      {
        databaseId: host.id,
        title: host.title || '当前数据库页面',
        icon: host.icon || '📋',
        isFullPageDatabase: true,
        viewCount: host.database.views?.length ?? 6,
        blockCountOnPage: 1,
      },
    ];
  }

  const dbBlocks = collectDatabaseBlocks(host.blocks);
  const grouped = new Map<string, PageDatabaseEntry>();
  for (const b of dbBlocks) {
    const dbId = String(b.props!.databaseId);
    const dbPage = workspace.pages.find((p) => p.id === dbId && !p.trashedAt && p.database);
    if (!dbPage) continue;
    const prev = grouped.get(dbId);
    if (prev) {
      prev.blockCountOnPage += 1;
    } else {
      grouped.set(dbId, {
        databaseId: dbPage.id,
        title: dbPage.title || String(b.props?.title || '内联任务数据库'),
        icon: dbPage.icon || '📋',
        isFullPageDatabase: false,
        viewCount: dbPage.database!.views?.length ?? 6,
        blockCountOnPage: 1,
      });
    }
  }
  return [...grouped.values()];
}

export function findExistingHostForTask(
  workspace: Workspace | null | undefined,
  taskRef: string,
): { hostPageId: string; databaseId: string; recordId: string } | null {
  if (!workspace || !taskRef) return null;
  const row = workspace.pages.find(
    (p) => !p.trashedAt && p.parentId && p.values?.[TASK_COL.ref] === taskRef,
  );
  if (!row || !row.parentId) return null;
  const dbPage = workspace.pages.find((p) => p.id === row.parentId && !p.trashedAt && p.database);
  if (!dbPage) return null;

  // If dbPage is an inline database whose parentId is a document page, return that document page
  if (dbPage.parentId) {
    const parentDoc = workspace.pages.find((p) => p.id === dbPage.parentId && !p.trashedAt && !p.database);
    if (parentDoc) {
      return { hostPageId: parentDoc.id, databaseId: dbPage.id, recordId: row.id };
    }
  }
  return { hostPageId: dbPage.id, databaseId: dbPage.id, recordId: row.id };
}

export function buildInlineDatabaseViewBlocks(
  databaseId: string,
  databaseTitle: string,
  preset: TaskPagePreset,
): JsonBlock[] {
  const primaryBlock: JsonBlock = {
    id: crypto.randomUUID(),
    type: 'databaseView',
    props: {
      databaseId,
      linked: false,
      title: databaseTitle,
      viewState: '',
    },
  };

  if (preset === 'multi') {
    const calendarLinked: JsonBlock = {
      id: crypto.randomUUID(),
      type: 'databaseView',
      props: {
        databaseId,
        linked: true,
        title: '排期日历视图',
        viewState: createLinkedSingleViewState('calendar', '排期日历', {
          calendarMode: 'month',
        }),
      },
    };
    const boardLinked: JsonBlock = {
      id: crypto.randomUUID(),
      type: 'databaseView',
      props: {
        databaseId,
        linked: true,
        title: '执行状态看板',
        viewState: createLinkedSingleViewState('board', '状态看板', {
          groupBy: TASK_COL.status,
          colorColumns: true,
        }),
      },
    };
    return [primaryBlock, calendarLinked, boardLinked];
  }

  if (preset === 'calendar') {
    const timelineLinked: JsonBlock = {
      id: crypto.randomUUID(),
      type: 'databaseView',
      props: {
        databaseId,
        linked: true,
        title: '执行时间线视图',
        viewState: createLinkedSingleViewState('timeline', '执行时间线'),
      },
    };
    return [primaryBlock, timelineLinked];
  }

  if (preset === 'board') {
    const chartLinked: JsonBlock = {
      id: crypto.randomUUID(),
      type: 'databaseView',
      props: {
        databaseId,
        linked: true,
        title: '任务类型分布统计',
        viewState: createLinkedSingleViewState('chart', '任务类型分布'),
      },
    };
    return [primaryBlock, chartLinked];
  }

  return [primaryBlock];
}

function isOnlyBlankParagraphs(blocks: JsonBlock[]): boolean {
  return (
    blocks.length === 0 ||
    blocks.every(
      (b) =>
        b.type === 'paragraph' &&
        (!b.content || (Array.isArray(b.content) && b.content.length === 0)),
    )
  );
}

export function upsertTaskRecordInWorkspace(
  state: Workspace,
  destination:
    | {
        mode: 'new-page';
        newPageTitle: string;
        preset: TaskPagePreset;
        parentId?: string | null;
      }
    | {
        mode: 'existing-page';
        hostPageId: string;
        targetDatabaseId: string | '__new_inline_db__';
        newDbTitle?: string;
        preset?: TaskPagePreset;
      },
  record: {
    ref: string;
    title: string;
    icon: string;
    assignees: string[];
    tags: string[];
    values: Page['values'];
    blocks: JsonBlock[];
    updateBlocksOnExisting?: boolean;
  },
): { workspace: Workspace; hostPageId: string; databaseId: string; recordId: string } {
  let pages = [...state.pages];
  let hostPageId = '';
  let databaseId = '';

  const presetPrimaryView: Record<TaskPagePreset, ViewType> = {
    multi: 'table',
    calendar: 'calendar',
    board: 'board',
    table: 'table',
  };

  if (destination.mode === 'new-page') {
    const hostTitle = destination.newPageTitle.trim() || `${record.title || 'Agent'} · 任务规划`;
    const hostPage = makePage({
      parentId: destination.parentId ?? null,
      title: hostTitle,
      icon: '🗓️',
      fullWidth: true,
      blocks: [],
    });
    hostPageId = hostPage.id;

    const dbTitle = 'Agent 任务规划';
    const dbPage = makePage({
      parentId: hostPage.id,
      title: dbTitle,
      icon: '📋',
      fullWidth: true,
      database: createAgentTaskDatabase(
        presetPrimaryView[destination.preset],
        record.assignees,
        record.tags,
      ),
    });
    databaseId = dbPage.id;

    hostPage.blocks = [
      {
        id: crypto.randomUUID(),
        type: 'callout',
        props: { emoji: '⚡' },
        content: [
          {
            type: 'text',
            text: '本页面通过多数据库视图管理并可视化 Agent 的定时、重复、事件驱动与督办任务。点击任意记录可查看完整指令或调整调度规则。',
            styles: {},
          },
        ],
      },
      ...buildInlineDatabaseViewBlocks(dbPage.id, dbPage.title, destination.preset),
      { id: crypto.randomUUID(), type: 'paragraph', content: [] },
    ];

    pages.push(hostPage, dbPage);
  } else {
    const hostIdx = pages.findIndex((p) => p.id === destination.hostPageId && !p.trashedAt);
    if (hostIdx < 0) {
      throw new Error('所选目标页面不存在或已移入回收站');
    }
    const hostPage = { ...pages[hostIdx] };
    hostPageId = hostPage.id;

    if (hostPage.database && destination.targetDatabaseId === hostPage.id) {
      hostPage.database = ensureAgentTaskColumns(hostPage.database, record.assignees, record.tags);
      hostPage.updatedAt = Date.now();
      pages[hostIdx] = hostPage;
      databaseId = hostPage.id;
    } else if (
      destination.targetDatabaseId &&
      destination.targetDatabaseId !== '__new_inline_db__'
    ) {
      const dbIdx = pages.findIndex(
        (p) => p.id === destination.targetDatabaseId && !p.trashedAt && p.database,
      );
      if (dbIdx < 0) throw new Error('所选目标数据库视图不存在');
      const dbPage = {
        ...pages[dbIdx],
        database: ensureAgentTaskColumns(pages[dbIdx].database!, record.assignees, record.tags),
        updatedAt: Date.now(),
      };
      pages[dbIdx] = dbPage;
      databaseId = dbPage.id;
    } else {
      const preset = destination.preset ?? 'multi';
      const existingDbs = findPageTaskDatabases(state, hostPage.id);
      const dbTitle =
        destination.newDbTitle?.trim() ||
        (existingDbs.length > 0
          ? `Agent 任务视图 ${existingDbs.length + 1}`
          : 'Agent 任务规划');
      const dbPage = makePage({
        parentId: hostPage.id,
        title: dbTitle,
        icon: '📋',
        fullWidth: true,
        database: createAgentTaskDatabase(
          presetPrimaryView[preset],
          record.assignees,
          record.tags,
        ),
      });
      databaseId = dbPage.id;
      const insertedBlocks = buildInlineDatabaseViewBlocks(dbPage.id, dbPage.title, preset);
      const baseBlocks = isOnlyBlankParagraphs(hostPage.blocks) ? [] : [...hostPage.blocks];
      hostPage.blocks = [
        ...baseBlocks,
        ...insertedBlocks,
        { id: crypto.randomUUID(), type: 'paragraph', content: [] },
      ];
      hostPage.fullWidth = true;
      hostPage.updatedAt = Date.now();
      pages[hostIdx] = hostPage;
      pages.push(dbPage);
    }
  }

  // Upsert row inside databaseId (and if moving from another DB, update in place or move)
  const existingRowIdx = pages.findIndex(
    (p) => !p.trashedAt && p.values?.[TASK_COL.ref] === record.ref,
  );
  let recordId = '';
  if (existingRowIdx >= 0) {
    const prev = pages[existingRowIdx];
    recordId = prev.id;
    pages[existingRowIdx] = {
      ...prev,
      parentId: databaseId,
      title: record.title,
      icon: record.icon,
      values: {
        ...prev.values,
        ...record.values,
      },
      ...(record.updateBlocksOnExisting ? { blocks: record.blocks } : {}),
      updatedAt: Date.now(),
    };
  } else {
    const rowPage = makePage({
      parentId: databaseId,
      title: record.title,
      icon: record.icon,
      values: record.values,
      blocks: record.blocks,
    });
    recordId = rowPage.id;
    pages.push(rowPage);
  }

  return {
    workspace: {
      ...state,
      pages,
    },
    hostPageId,
    databaseId,
    recordId,
  };
}

export function importExistingTasksToNewPageInWorkspace(
  state: Workspace,
  opts: {
    jobs: ScheduledJob[];
    missions: Mission[];
    employees: TaskEmployee[];
    hostTimezone: string;
    pageTitle?: string;
    preset?: TaskPagePreset;
  },
): { workspace: Workspace; hostPageId: string; databaseId: string; importedCount: number } {
  const { jobs, missions, employees, hostTimezone, preset = 'multi' } = opts;
  const records = [
    ...missions.map((m) => missionToTaskRecordData(m, employees, hostTimezone)),
    ...jobs.map((j) => jobToTaskRecordData(j, employees, hostTimezone)),
  ];

  const allAssignees = records.flatMap((r) => r.assignees);
  const allTags = records.flatMap((r) => r.tags);
  const hostTitle = opts.pageTitle?.trim() || 'Agent 定时与督办任务中心';

  const hostPage = makePage({
    parentId: null,
    title: hostTitle,
    icon: '🗓️',
    fullWidth: true,
    blocks: [],
  });

  const dbPage = makePage({
    parentId: hostPage.id,
    title: 'Agent 任务主数据库',
    icon: '📋',
    fullWidth: true,
    database: createAgentTaskDatabase('table', allAssignees, allTags),
  });

  hostPage.blocks = [
    {
      id: crypto.randomUUID(),
      type: 'callout',
      props: { emoji: '📥' },
      content: [
        {
          type: 'text',
          text: `已手动汇总保存 ${records.length} 项现有定时、重复、事件驱动与督办任务。本页同时提供主表格、排期日历与状态看板多个数据库视图，所有状态与下次触发时间均与系统调度引擎实时同步。`,
          styles: {},
        },
      ],
    },
    ...buildInlineDatabaseViewBlocks(dbPage.id, dbPage.title, preset),
    { id: crypto.randomUUID(), type: 'paragraph', content: [] },
  ];

  const rowPages = records.map((rec) =>
    makePage({
      parentId: dbPage.id,
      title: rec.title,
      icon: rec.icon,
      values: rec.values,
      blocks: rec.blocks,
    }),
  );

  return {
    workspace: {
      ...state,
      pages: [...state.pages, hostPage, dbPage, ...rowPages],
      activePageId: hostPage.id,
      recent: [hostPage.id, ...state.recent.filter((id) => id !== hostPage.id)].slice(0, 20),
    },
    hostPageId: hostPage.id,
    databaseId: dbPage.id,
    importedCount: rowPages.length,
  };
}

export function insertAdditionalTaskDatabaseOnPage(
  state: Workspace,
  hostPageId: string,
  preset: TaskPagePreset = 'multi',
  customTitle?: string,
): { workspace: Workspace; databaseId: string } {
  const idx = state.pages.findIndex((p) => p.id === hostPageId && !p.trashedAt && !p.database);
  if (idx < 0) return { workspace: state, databaseId: '' };
  const host = state.pages[idx];
  const existingCount = findPageTaskDatabases(state, hostPageId).length;
  const dbTitle =
    customTitle?.trim() ||
    (existingCount === 0 ? 'Agent 任务规划' : `Agent 任务视图 ${existingCount + 1}`);

  const primaryType: ViewType =
    preset === 'calendar' ? 'calendar' : preset === 'board' ? 'board' : 'table';
  const dbPage = makePage({
    parentId: host.id,
    title: dbTitle,
    icon: '📋',
    fullWidth: true,
    database: createAgentTaskDatabase(primaryType),
  });

  const newBlocks = buildInlineDatabaseViewBlocks(dbPage.id, dbPage.title, preset);
  const baseBlocks = isOnlyBlankParagraphs(host.blocks) ? [] : [...host.blocks];
  const updatedHost: Page = {
    ...host,
    fullWidth: true,
    blocks: [
      ...baseBlocks,
      ...newBlocks,
      { id: crypto.randomUUID(), type: 'paragraph', content: [] },
    ],
    updatedAt: Date.now(),
  };

  const pages = [...state.pages];
  pages[idx] = updatedHost;
  pages.push(dbPage);
  return {
    workspace: { ...state, pages },
    databaseId: dbPage.id,
  };
}

export function syncWorkspaceTaskRecords(
  state: Workspace,
  data: {
    jobs: ScheduledJob[];
    missions: Mission[];
    employees: TaskEmployee[];
    hostTimezone: string;
  },
): Workspace {
  const hasAnyTaskRow = state.pages.some(
    (p) => !p.trashedAt && typeof p.values?.[TASK_COL.ref] === 'string' && p.values[TASK_COL.ref],
  );
  if (!hasAnyTaskRow) return state;

  const jobMap = new Map(data.jobs.map((j) => [j.id, j]));
  const missionMap = new Map(data.missions.map((m) => [m.id, m]));
  let anyChanged = false;
  const dbAdditions = new Map<string, { assignees: string[]; tags: string[] }>();

  const nextPages = state.pages.map((page) => {
    if (page.trashedAt || !page.parentId) return page;
    const parsed = parseTaskRef(page.values?.[TASK_COL.ref]);
    if (!parsed) return page;

    let projected: ReturnType<typeof jobToTaskRecordData> | null = null;
    if (parsed.kind === 'schedule') {
      const job = jobMap.get(parsed.id);
      if (!job) return page;
      projected = jobToTaskRecordData(job, data.employees, data.hostTimezone);
    } else {
      const mission = missionMap.get(parsed.id);
      if (!mission) return page;
      projected = missionToTaskRecordData(mission, data.employees, data.hostTimezone);
    }

    const nextValues = {
      ...page.values,
      ...projected.values,
    };

    const sameTitle = page.title === projected.title;
    const sameIcon = page.icon === projected.icon;
    const sameValues = JSON.stringify(page.values) === JSON.stringify(nextValues);
    if (sameTitle && sameIcon && sameValues) return page;

    anyChanged = true;
    const prevDb = dbAdditions.get(page.parentId) ?? { assignees: [], tags: [] };
    prevDb.assignees.push(...projected.assignees);
    prevDb.tags.push(...projected.tags);
    dbAdditions.set(page.parentId, prevDb);

    return {
      ...page,
      title: projected.title,
      icon: projected.icon,
      values: nextValues,
    };
  });

  if (!anyChanged) return state;

  const finalPages = nextPages.map((p) => {
    const extra = dbAdditions.get(p.id);
    if (!extra || !p.database) return p;
    const updatedDb = ensureAgentTaskColumns(p.database, extra.assignees, extra.tags);
    return updatedDb === p.database ? p : { ...p, database: updatedDb };
  });

  return {
    ...state,
    pages: finalPages,
  };
}

const PRIORITY_REVERSE: Record<string, 'low' | 'normal' | 'high' | 'urgent'> = {
  低: 'low',
  普通: 'normal',
  高: 'high',
  紧急: 'urgent',
};

function dateValueToOnceIso(
  nextVal: unknown,
  existingIso: string,
  zone: string,
): string | null {
  const parts = dateParts(nextVal);
  if (!parts?.start) return null;
  try {
    const startText = parts.start;
    if (startText.includes('T')) {
      if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(startText)) {
        return Temporal.Instant.from(startText).toString();
      }
      return Temporal.PlainDateTime.from(startText)
        .toZonedDateTime(parts.timeZone || zone)
        .toInstant()
        .toString();
    }
    const prevTime = Temporal.Instant.from(existingIso)
      .toZonedDateTimeISO(zone)
      .toPlainTime();
    return Temporal.PlainDate.from(startText)
      .toPlainDateTime(prevTime)
      .toZonedDateTime(zone)
      .toInstant()
      .toString();
  } catch {
    return null;
  }
}

export function syncPatchedTaskRowToCore(prevPage: Page, changes: Partial<Page>): void {
  const hostCall = window.native?.hostCall;
  if (!hostCall) return;
  const ref = getPageTaskRef(prevPage);
  if (!ref) return;

  const nextTitle =
    changes.title !== undefined && changes.title.trim() && changes.title !== prevPage.title
      ? changes.title.trim()
      : undefined;
  const nextVals = changes.values;
  const statusChanged =
    nextVals !== undefined &&
    nextVals[TASK_COL.status] !== undefined &&
    nextVals[TASK_COL.status] !== prevPage.values?.[TASK_COL.status];
  const priorityChanged =
    nextVals !== undefined &&
    typeof nextVals[TASK_COL.priority] === 'string' &&
    nextVals[TASK_COL.priority] !== prevPage.values?.[TASK_COL.priority];
  const tagsChanged =
    nextVals !== undefined &&
    Array.isArray(nextVals[TASK_COL.tags]) &&
    JSON.stringify(nextVals[TASK_COL.tags]) !== JSON.stringify(prevPage.values?.[TASK_COL.tags]);
  const scheduleChanged =
    nextVals !== undefined &&
    nextVals[TASK_COL.schedule] !== undefined &&
    JSON.stringify(nextVals[TASK_COL.schedule]) !==
      JSON.stringify(prevPage.values?.[TASK_COL.schedule]);

  if (!nextTitle && !statusChanged && !priorityChanged && !tagsChanged && !scheduleChanged) {
    return;
  }

  if (ref.kind === 'schedule') {
    void (async () => {
      try {
        let job = (await hostCall('schedule.get', { id: ref.id })) as ScheduledJob;
        if (!job) return;
        if (statusChanged) {
          const st = nextVals![TASK_COL.status];
          if (st === '已暂停' && job.enabled) {
            job = (await hostCall('schedule.pause', {
              id: job.id,
              expectedRevision: job.revision ?? 1,
            })) as ScheduledJob;
          } else if ((st === '已排期' || st === '等待事件') && !job.enabled) {
            job = (await hostCall('schedule.resume', {
              id: job.id,
              expectedRevision: job.revision ?? 1,
            })) as ScheduledJob;
          }
        }
        const patch: Record<string, unknown> = {};
        if (nextTitle) patch.name = nextTitle;
        if (priorityChanged || tagsChanged) {
          const prevPlan: Partial<NonNullable<ScheduledJob['plan']>> = job.plan ?? {};
          const boundTags = (prevPlan.tags ?? []).filter((t: string) => /^p:/i.test(t));
          const userTags = tagsChanged
            ? (nextVals![TASK_COL.tags] as string[]).filter((t) => t && !/^p:/i.test(t))
            : userVisibleTags(prevPlan.tags);
          patch.plan = {
            ...prevPlan,
            priority: priorityChanged
              ? PRIORITY_REVERSE[String(nextVals![TASK_COL.priority])] || prevPlan.priority || 'normal'
              : prevPlan.priority,
            tags: [...new Set([...userTags, ...boundTags])],
          };
        }
        if (scheduleChanged && job.rule.kind === 'once') {
          const nextIso = dateValueToOnceIso(
            nextVals![TASK_COL.schedule],
            job.rule.at,
            localTimeZone() || 'Asia/Shanghai',
          );
          if (nextIso && nextIso !== job.rule.at) {
            patch.rule = { kind: 'once', at: nextIso };
          }
        }
        if (Object.keys(patch).length > 0) {
          await hostCall('schedule.update', {
            id: job.id,
            patch,
            expectedRevision: job.revision ?? 1,
          });
        }
      } catch {
        /* Transient revision races resolve automatically on next host event sync. */
      }
    })();
    return;
  }

  void (async () => {
    try {
      let mission = (await hostCall('mission.get', { id: ref.id })) as Mission;
      if (!mission || mission.engineering) return;
      if (statusChanged) {
        const st = nextVals![TASK_COL.status];
        if (st === '已完成' && mission.status !== 'succeeded') {
          mission = (await hostCall('mission.complete', {
            id: mission.id,
            result: '已在 Mission 数据库视图标记完成',
            expectedRevision: mission.revision,
          })) as Mission;
        } else if (st === '督办中' && mission.status === 'succeeded') {
          mission = (await hostCall('mission.reopen', {
            id: mission.id,
            expectedRevision: mission.revision,
          })) as Mission;
        }
      }
      const patch: Record<string, unknown> = {};
      if (nextTitle) patch.name = nextTitle;
      if (priorityChanged || tagsChanged) {
        const prevPlan: Partial<NonNullable<Mission['plan']>> = mission.plan ?? {};
        const boundTags = (prevPlan.tags ?? []).filter((t: string) => /^p:/i.test(t));
        const userTags = tagsChanged
          ? (nextVals![TASK_COL.tags] as string[]).filter((t) => t && !/^p:/i.test(t))
          : userVisibleTags(prevPlan.tags);
        patch.plan = {
          ...prevPlan,
          priority: priorityChanged
            ? PRIORITY_REVERSE[String(nextVals![TASK_COL.priority])] || prevPlan.priority || 'normal'
            : prevPlan.priority,
          tags: [...new Set([...userTags, ...boundTags])],
        };
      }
      if (Object.keys(patch).length > 0) {
        await hostCall('mission.update', {
          id: mission.id,
          patch,
          expectedRevision: mission.revision,
        });
      }
    } catch {
      /* Transient revision races resolve automatically on next host event sync. */
    }
  })();
}
