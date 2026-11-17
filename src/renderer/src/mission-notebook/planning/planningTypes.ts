import type { Mission } from '../../../../shared/missions';
import type { ScheduledJob, ScheduleEvent } from '../../../../shared/scheduler';

export type TaskEmployee = {
  id: string;
  title: string;
  engine: string;
  cwd?: string;
  model?: string;
  avatar?: string;
  color?: string;
  managementRole?: 'secretary' | 'governor' | 'manager' | 'employee';
  deleting?: boolean;
};

export const PAGE_TAG_PREFIX = 'p:';
export const LEGACY_PAGE_TAG_PREFIX = 'page:';
export const PAGE_SOURCE_PREFIX = 'notebook:';

export function pageBindingTag(pageId: string): string {
  // SCHEDULE_SPEC_SCHEMA limits each tag to 40 chars; 'p:' + 36-char UUID = 38 chars.
  return `${PAGE_TAG_PREFIX}${pageId.slice(0, 38)}`;
}

export function extractBoundPageId(
  item: { source?: unknown; plan?: { tags?: string[] } },
): string | null {
  for (const tag of item.plan?.tags ?? []) {
    if (tag.startsWith(PAGE_TAG_PREFIX) && tag.length > PAGE_TAG_PREFIX.length) {
      return tag.slice(PAGE_TAG_PREFIX.length);
    }
    if (tag.startsWith(LEGACY_PAGE_TAG_PREFIX) && tag.length > LEGACY_PAGE_TAG_PREFIX.length) {
      return tag.slice(LEGACY_PAGE_TAG_PREFIX.length);
    }
  }
  if (
    typeof item.source === 'string' &&
    item.source.startsWith(PAGE_SOURCE_PREFIX) &&
    item.source.length > PAGE_SOURCE_PREFIX.length
  ) {
    return item.source.slice(PAGE_SOURCE_PREFIX.length);
  }
  return null;
}

export function isBoundToPage(
  item: { source?: unknown; plan?: { tags?: string[] } },
  pageId: string,
): boolean {
  const shortTag = pageBindingTag(pageId);
  const fullLegacyTag = `${LEGACY_PAGE_TAG_PREFIX}${pageId}`;
  if ((item.plan?.tags ?? []).some((t) => t === shortTag || t === fullLegacyTag)) return true;
  if (typeof item.source === 'string' && item.source === `${PAGE_SOURCE_PREFIX}${pageId}`) return true;
  return extractBoundPageId(item) === pageId;
}

export function userVisibleTags(tags?: string[]): string[] {
  return (tags ?? []).filter(
    (tag) => !tag.startsWith(PAGE_TAG_PREFIX) && !tag.startsWith(LEGACY_PAGE_TAG_PREFIX),
  );
}

export function mergeTagsWithPageBinding(rawTags: string, pageId?: string | null): string[] {
  const parsed = rawTags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => Boolean(t) && !t.startsWith(PAGE_TAG_PREFIX) && !t.startsWith(LEGACY_PAGE_TAG_PREFIX));
  const out = [...new Set(parsed)];
  if (pageId) {
    out.unshift(pageBindingTag(pageId));
  }
  return out.slice(0, 20);
}

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function scheduleRuleCategory(job: ScheduledJob): 'once' | 'repeat' | 'event' {
  if (job.rule.kind === 'once') return 'once';
  if (job.rule.kind === 'event') return 'event';
  return 'repeat';
}

export function formatScheduleRule(job: ScheduledJob): string {
  const r = job.rule;
  if (r.kind === 'once') {
    return `单次定时 · ${formatShortDate(r.at)}`;
  }
  if (r.kind === 'interval') {
    const n = r.everySeconds;
    if (n % 86400 === 0) return `每隔 ${n / 86400} 天`;
    if (n % 3600 === 0) return `每隔 ${n / 3600} 小时`;
    if (n % 60 === 0) return `每隔 ${n / 60} 分钟`;
    return `每隔 ${n} 秒`;
  }
  if (r.kind === 'monthly') {
    return `每月 ${r.day === 'last' ? '最后一天' : `${r.day} 日`} ${r.time}`;
  }
  if (r.kind === 'weekly') {
    if (r.days.length === 7) return `每天 ${r.time}`;
    return `每${r.days.map((d) => WEEKDAY_NAMES[d - 1] || d).join('、')} ${r.time}`;
  }
  const eventLabels: Record<ScheduleEvent['type'], string> = {
    signal: '信号触发 (API Signal)',
    'channel.posted': '频道新帖触发',
    'message.received': '收到新消息触发',
    'session.completed': '员工会话完成触发',
    'monitor.output': '脚本监控输出触发',
    'monitor.exited': '脚本监控退出触发',
  };
  return `${eventLabels[r.event] || r.event}${r.cooldownSeconds ? ` · 冷却 ${r.cooldownSeconds}s` : ''}`;
}

export function formatMissionRule(mission: Mission): string {
  const sec = mission.reminderSeconds;
  const intervalLabel =
    sec % 86400 === 0
      ? `每 ${sec / 86400} 天`
      : sec % 3600 === 0
        ? `每 ${sec / 3600} 小时`
        : sec % 60 === 0
          ? `每 ${sec / 60} 分钟`
          : `每 ${sec} 秒`;
  return `${mission.type === 'supervised' ? '秘书督办' : '独立执行'} · ${intervalLabel}提醒直到完成`;
}

export function formatShortDate(iso?: string | null, timeZone?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      ...(timeZone ? { timeZone } : {}),
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function scheduleStatusBadge(job: ScheduledJob): {
  label: string;
  tone: 'scheduled' | 'paused' | 'event' | 'completed' | 'warning';
} {
  if (!job.enabled) {
    if (job.disabledReason === 'employee_removed' || job.disabledReason === 'authorization_revoked') {
      return { label: '授权失效', tone: 'warning' };
    }
    return { label: '已暂停', tone: 'paused' };
  }
  if (job.rule.kind === 'event') return { label: '等待事件', tone: 'event' };
  if (job.rule.kind === 'once' && !job.nextAt) return { label: '已完成', tone: 'completed' };
  if (job.maxOccurrences && (job.occurrences ?? 0) >= job.maxOccurrences) {
    return { label: '已达次数上限', tone: 'completed' };
  }
  return { label: '已排期', tone: 'scheduled' };
}

export function missionStatusBadge(mission: Mission): {
  label: string;
  tone: 'scheduled' | 'completed' | 'warning';
} {
  if (mission.status === 'succeeded') return { label: '已完成', tone: 'completed' };
  if (mission.status === 'failed' || mission.deliveryError) {
    return { label: '需处理', tone: 'warning' };
  }
  return { label: '督办中', tone: 'scheduled' };
}

export const PRIORITY_LABELS: Record<'low' | 'normal' | 'high' | 'urgent', string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
};

export async function grantPageAccessForEmployees(
  pageId: string,
  employeeIds: string[],
  right: 'read' | 'write' | 'create' | 'none',
): Promise<string | null> {
  if (right === 'none' || !pageId || !employeeIds.length || !window.native?.hostCall) {
    return null;
  }
  const hostCall = window.native.hostCall;

  // Ensure the page is committed to notebook resources if just created.
  let resourcesResp = await hostCall('notebook.resources');
  let resources: Array<{ id: string }> = Array.isArray(resourcesResp?.resources)
    ? resourcesResp.resources
    : [];
  if (!resources.some((r) => r.id === pageId)) {
    await new Promise((r) => setTimeout(r, 320));
    resourcesResp = await hostCall('notebook.resources');
    resources = Array.isArray(resourcesResp?.resources) ? resourcesResp.resources : [];
    if (!resources.some((r) => r.id === pageId)) {
      return '任务已保存；新页面正在同步到本地索引，稍后可在右上角“授权”中确认员工权限。';
    }
  }

  const access = await hostCall('notebook.access');
  const allEmployees: Array<{ id: string; role: string }> = Array.isArray(access?.employees)
    ? access.employees
    : [];
  const grants: Array<{
    employeeId: string;
    resourceId: string;
    read: boolean;
    write: boolean;
    create: boolean;
  }> = Array.isArray(access?.grants) ? access.grants : [];
  const targetSet = new Set(employeeIds);

  const payload = allEmployees
    .filter((emp) => emp.role !== 'secretary')
    .map((emp) => {
      const prev = grants.find((g) => g.employeeId === emp.id && g.resourceId === pageId);
      const base = {
        read: Boolean(prev?.read),
        write: Boolean(prev?.write),
        create: Boolean(prev?.create),
      };
      if (!targetSet.has(emp.id)) {
        return { employeeId: emp.id, ...base };
      }
      return {
        employeeId: emp.id,
        read: true,
        write: base.write || right === 'write' || right === 'create',
        create: base.create || right === 'create',
      };
    });

  if (!payload.length) return null;

  await hostCall('notebook.access', {
    resourceIds: [pageId],
    employees: payload,
    expectedRevision: Number(access?.revision ?? 0),
  });
  return null;
}

export function buildPageContextPrompt(
  prompt: string,
  pageId: string,
  pageTitle: string,
): string {
  const clean = prompt.trim();
  const marker = `[Mission 页面上下文 · Page ID: ${pageId}]`;
  if (!pageId || clean.includes(pageId)) return clean;
  return `${clean}\n\n${marker}\n请结合 Mission 笔记本页面「${pageTitle || '无标题'}」(pageId: ${pageId}) 开展工作，必要时使用 notebook 工具读取最新内容并将执行结果或关键记录补充写入该页面。`;
}
