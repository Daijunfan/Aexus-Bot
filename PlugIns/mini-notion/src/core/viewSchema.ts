import type { DatabaseView } from '../types';
import { CommandError } from './errors';

/** The CLI describes every persisted view field, including nested JSON settings. */
export const viewFields: Record<keyof DatabaseView, string> = {
  appearance: '外观对象或 null：backgroundColor/cardColor/accentColor，支持预设色和 #RRGGBB',
  conditionalColors: '[{id, filter: AND/OR筛选组, color: 预设色或#RRGGBB, targetProperty?: 仅表格单元格属性ID}]；各目标第一条命中规则优先',
  id: '视图 ID',
  name: '名称',
  type: 'table/board/plan/timeline/calendar/gallery/list/chart/feed/form',
  defaultTemplateId: '默认模板 ID 或 null',
  subItemDisplay: 'nested/flat/card',
  subItemFilter: 'all/parents/children',
  collapsedItems: '折叠记录 ID 数组',
  filters: '{id, conjunction: and/or, rules: [{id, property, operator, value} 或嵌套组]}',
  sorts: '[{id, property, direction: asc/desc}]',
  manualOrder: '手动记录排序 ID 数组；仅在没有属性排序时生效，各视图独立',
  groupBy: '分组属性 ID',
  subGroupBy: '二级分组属性 ID',
  hideEmptyGroups: 'boolean',
  colorColumns: 'boolean；仅看板：按分组选项颜色显示柔和列背景，默认开启',
  revealedGroups: '即使隐藏空组也展示这些刚新增的分类键；仅该视图有效',
  hiddenGroups: '隐藏组数组',
  collapsedGroups: '折叠组数组',
  groupOrder: '组顺序数组',
  hiddenProperties: '隐藏属性 ID 数组',
  propertyOrder: '属性 ID 顺序数组',
  columnWidths: '{属性ID: 宽度}',
  columnWrap: '{属性ID: boolean}；覆盖该列的全表换行设置',
  frozenThrough: '冻结到指定属性 ID（名称列为 title）；null 取消冻结，省略保留旧名称列冻结行为',
  calculations: '{属性ID: 聚合函数}',
  wrapCells: 'boolean',
  cardSize: 'small/medium/large',
  cardPreview: 'none/cover/content',
  openPagesIn: 'side/center/full',
  calendarBy: '所有日期视图（calendar/plan/timeline）共用的起始日期属性 ID',
  calendarMode: 'month/week',
  dateAnchor: '参考日期 YYYY-MM-DD',
  planMode: 'week/day/agenda/hourWeek/hourDay',
  timeZone: '小时计划视图的 IANA 显示时区，例如 Asia/Shanghai',
  planDoneBy: '完成状态属性 ID',
  planDoneValue: '已完成选项',
  planHideCompleted: 'boolean',
  planShowBacklog: 'boolean；省略时仅在有未排期或逾期记录时展示侧栏',
  timelineEnd: '独立结束日期属性 ID；空字符串使用起始日期属性的 end',
  timelineScale: 'week/month/quarter/year',
  chartType: 'bar/horizontal/line/donut',
  chartGroup: '图表分组属性 ID',
  chartValue: '图表值属性 ID',
  chartAggregation: 'count/count_values/count_unique/empty/percent_filled/percent_empty/sum/average/median/min/max/range',
  formDescription: '表单说明',
  formRequired: '必填属性 ID 数组',
  formSubmitLabel: '表单提交按钮文字',
};
export function validateViewFields(changes: Record<string, unknown> = {}) {
  const unknown = Object.keys(changes).filter((key) => !Object.hasOwn(viewFields, key));
  if (unknown.length)
    throw new CommandError(
      'INVALID_VIEW_FIELD',
      `未知视图字段：${unknown.join(', ')}。日历、计划、时间线都使用 calendarBy 指定日期属性。`,
      { fields: viewFields },
    );
  if (changes.colorColumns !== undefined && typeof changes.colorColumns !== 'boolean')
    throw new CommandError('INVALID_VIEW_FIELD', '显示分组列颜色只能使用 true 或 false');
  if (changes.manualOrder !== undefined &&
    (!Array.isArray(changes.manualOrder) ||
      changes.manualOrder.some(id => typeof id !== 'string' || !id) ||
      new Set(changes.manualOrder).size !== changes.manualOrder.length))
    throw new CommandError('INVALID_VIEW_FIELD', '手动顺序必须是无重复的记录 ID 数组');
}
