import type { ViewType } from '../types.ts';

export const viewTypes: { type: ViewType; name: string; description: string }[] = [
  { type: 'table', name: '表格', description: '在行和列中查看全部属性' },
  { type: 'board', name: '看板', description: '按状态或其他属性排列卡片' },
  { type: 'timeline', name: '时间线', description: '安排项目时间与持续时长' },
  { type: 'calendar', name: '日历', description: '按日期查看和安排记录' },
  { type: 'plan', name: '计划', description: '日计划、周计划与议程，管理待办和排期' },
  { type: 'list', name: '列表', description: '简洁的页面列表' },
  { type: 'gallery', name: '画廊', description: '用可视卡片展示内容' },
  { type: 'chart', name: '图表', description: '可交互的图形与数值统计' },
  { type: 'feed', name: '动态', description: '浏览记录正文与最新进展' },
  { type: 'form', name: '表单', description: '收集信息并创建数据库记录' },
];
