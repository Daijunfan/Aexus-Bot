import { useEffect, useMemo, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database as DatabaseIcon,
  FilePlus2,
  History,
  LayoutGrid,
  Play,
  Repeat,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ChannelRecord } from '../../../../shared/channels';
import type { ChatGroupView } from '../../../../shared/chat-groups';
import type { Mission, MissionSpec } from '../../../../shared/missions';
import type { ScheduledJob, ScheduleEvent, ScheduleRun } from '../../../../shared/scheduler';
import type { ScriptMonitor } from '../../../../shared/script-monitors';
import type { ModelInfo } from '../../../../shared/types';
import { internalPageIds, trashPage } from '../../../../shared/mission-notebook/model';
import { AppSelect } from '../components/AppSelect';
import { useWorkspace } from '../store';
import { Modal } from '../ui';
import {
  buildPageContextPrompt,
  extractBoundPageId,
  formatShortDate,
  grantPageAccessForEmployees,
  mergeTagsWithPageBinding,
  userVisibleTags,
  type TaskEmployee,
} from './planningTypes';
import {
  findExistingHostForTask,
  findPageTaskDatabases,
  jobToTaskRecordData,
  missionToTaskRecordData,
  TASK_COL,
  upsertTaskRecordInWorkspace,
  type TaskPagePreset,
} from './taskDatabase';

const WEEKDAYS = [
  { day: 1, label: '周一' },
  { day: 2, label: '周二' },
  { day: 3, label: '周三' },
  { day: 4, label: '周四' },
  { day: 5, label: '周五' },
  { day: 6, label: '周六' },
  { day: 7, label: '周日' },
];

type PlannerTab = 'once' | 'repeat' | 'event' | 'mission';

const toLocalInput = (iso: string, zone: string) => {
  try {
    return Temporal.Instant.from(iso)
      .toZonedDateTimeISO(zone)
      .toPlainDateTime()
      .toString({ smallestUnit: 'minute' });
  } catch {
    return '';
  }
};

const toIsoInstant = (localValue: string, zone: string) => {
  return Temporal.PlainDateTime.from(localValue).toZonedDateTime(zone).toInstant().toString();
};

export function AgentTaskComposerModal({
  pageId,
  databaseId,
  initialTab,
  jobId,
  missionId,
  initialOnceDate,
  initialEnabled,
  onClose,
}: {
  pageId?: string;
  databaseId?: string;
  initialTab?: PlannerTab;
  jobId?: string;
  missionId?: string;
  initialOnceDate?: string;
  initialEnabled?: boolean;
  onClose: () => void;
}) {
  const { workspace, update, navigate, notify, setModal } = useWorkspace();

  // Selectable host pages: exclude trashed, internal/record rows, and inline-child DBs already embedded in a doc
  const selectablePages = useMemo(() => {
    if (!workspace) return [];
    const internal = internalPageIds(workspace.pages);
    const active = workspace.pages.filter(
      (p) => !p.trashedAt && !internal.has(p.id) && (!p.sourceFile || p.sourceFile.kind === 'directory'),
    );
    return active.filter((p) => {
      if (!p.database || !p.parentId) return true;
      const parent = active.find((cand) => cand.id === p.parentId);
      return !parent || Boolean(parent.database);
    });
  }, [workspace]);

  const initialHostId = useMemo(() => {
    if (pageId) {
      const p = workspace?.pages.find((item) => item.id === pageId && !item.trashedAt);
      if (p) {
        if (p.database && p.parentId) {
          const parentDoc = selectablePages.find((cand) => cand.id === p.parentId);
          if (parentDoc) return parentDoc.id;
        }
        if (selectablePages.some((cand) => cand.id === p.id)) return p.id;
      }
    }
    return selectablePages[0]?.id || '';
  }, [pageId, workspace, selectablePages]);

  const [loading, setLoading] = useState(Boolean(jobId || missionId));
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [employees, setEmployees] = useState<TaskEmployee[]>([]);
  const [hostTimezone, setHostTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  );
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [groups, setGroups] = useState<ChatGroupView[]>([]);
  const [monitors, setMonitors] = useState<ScriptMonitor[]>([]);
  const [history, setHistory] = useState<ScheduleRun[]>([]);
  const [nativeEfforts, setNativeEfforts] = useState<string[]>([]);

  // Destination in Notion Page & Database View
  const [destMode, setDestMode] = useState<'existing-page' | 'new-page'>(() =>
    initialHostId ? 'existing-page' : 'new-page',
  );
  const [targetPageId, setTargetPageId] = useState(initialHostId);
  const [targetDbId, setTargetDbId] = useState<string>(databaseId || '__new_inline_db__');
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newDbTitle, setNewDbTitle] = useState('');
  const [viewPreset, setViewPreset] = useState<TaskPagePreset>('multi');

  const pageDatabases = useMemo(
    () => findPageTaskDatabases(workspace, targetPageId),
    [workspace, targetPageId],
  );

  useEffect(() => {
    if (destMode !== 'existing-page') return;
    if (databaseId && pageDatabases.some((d) => d.databaseId === databaseId)) {
      setTargetDbId(databaseId);
      return;
    }
    if (pageDatabases.length > 0) {
      setTargetDbId((prev) =>
        pageDatabases.some((d) => d.databaseId === prev) ? prev : pageDatabases[0].databaseId,
      );
    } else {
      setTargetDbId('__new_inline_db__');
    }
  }, [destMode, targetPageId, pageDatabases, databaseId]);

  const boundPage = useMemo(
    () => selectablePages.find((p) => p.id === targetPageId),
    [selectablePages, targetPageId],
  );

  const [tab, setTab] = useState<PlannerTab>(initialTab || 'once');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [includePageContext, setIncludePageContext] = useState(() => !jobId && !missionId);
  const [grantRight, setGrantRight] = useState<'write' | 'read' | 'create' | 'none'>('write');

  // Schedule state
  const [employeeId, setEmployeeId] = useState('');
  const [onceMode, setOnceMode] = useState<'after' | 'at'>(() =>
    initialOnceDate ? 'at' : 'after',
  );
  const [afterAmount, setAfterAmount] = useState('30');
  const [afterUnit, setAfterUnit] = useState('60');
  const [onceAt, setOnceAt] = useState(() => {
    if (initialOnceDate) {
      return initialOnceDate.includes('T')
        ? initialOnceDate.slice(0, 16)
        : `${initialOnceDate.slice(0, 10)}T09:00`;
    }
    return toLocalInput(new Date(Date.now() + 3600_000).toISOString(), hostTimezone);
  });

  const [repeatKind, setRepeatKind] = useState<'daily' | 'weekly' | 'monthly' | 'interval'>('daily');
  const [intervalAmount, setIntervalAmount] = useState('30');
  const [intervalUnit, setIntervalUnit] = useState('60');
  const [clockTime, setClockTime] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState<string>('1');
  const [timezone, setTimezone] = useState(hostTimezone);

  // Event state
  const [eventType, setEventType] = useState<ScheduleEvent['type']>('message.received');
  const [eventChannel, setEventChannel] = useState('');
  const [eventConversation, setEventConversation] = useState('');
  const [eventEmployee, setEventEmployee] = useState('');
  const [eventMonitor, setEventMonitor] = useState('');
  const [cooldown, setCooldown] = useState('60');

  // Schedule options & limits
  const [enabled, setEnabled] = useState(() =>
    initialEnabled !== undefined ? initialEnabled : true,
  );
  const [channelId, setChannelId] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [windowDays, setWindowDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [until, setUntil] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('1800');
  const [graceSeconds, setGraceSeconds] = useState('60');
  const [effort, setEffort] = useState('');
  const [thinking, setThinking] = useState<'inherit' | 'on' | 'off'>('inherit');

  // Mission state
  const [missionEmployees, setMissionEmployees] = useState<string[]>([]);
  const [missionType, setMissionType] = useState<MissionSpec['type']>('supervised');
  const [secretaryId, setSecretaryId] = useState('');
  const [reminderAmount, setReminderAmount] = useState('30');
  const [reminderUnit, setReminderUnit] = useState('60');
  const [completeResult, setCompleteResult] = useState('');
  const [showCompleteBox, setShowCompleteBox] = useState(false);

  // Shared metadata & preview
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [previewTimes, setPreviewTimes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reqKeyRef = useRef(crypto.randomUUID());
  const lastSigRef = useRef('');

  useEffect(() => {
    let alive = true;
    const loadInitial = async () => {
      const hostCall = window.native?.hostCall;
      if (!hostCall) {
        setError('当前环境不支持 Core Agent 调度');
        setLoading(false);
        return;
      }
      try {
        const [sessionRes, sysRes, chRes, chatRes, monRes] = await Promise.all([
          hostCall('session.list').catch(() => ({ sessions: [] })),
          hostCall('system.info').catch(() => ({})),
          hostCall('channel.list').catch(() => []),
          hostCall('chat.list').catch(() => []),
          hostCall('monitor.list').catch(() => []),
        ]);
        if (!alive) return;
        const zone =
          (sysRes as { timezone?: string })?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          'Asia/Shanghai';
        setHostTimezone(zone);

        const activeEmployees: TaskEmployee[] = Array.isArray(sessionRes?.sessions)
          ? sessionRes.sessions.filter((s: TaskEmployee) => !s.deleting)
          : [];
        setEmployees(activeEmployees);
        setChannels(Array.isArray(chRes) ? chRes : []);
        setGroups(Array.isArray(chatRes) ? chatRes : []);
        setMonitors(Array.isArray(monRes) ? monRes : []);

        const secs = activeEmployees.filter((e) => e.managementRole === 'secretary');
        if (!jobId && !missionId) {
          setTimezone(zone);
          if (!initialOnceDate) {
            setOnceAt(toLocalInput(new Date(Date.now() + 3600_000).toISOString(), zone));
          }
          if (activeEmployees[0]) {
            setEmployeeId(activeEmployees[0].id);
            setMissionEmployees([activeEmployees[0].id]);
          }
          if (secs[0]) {
            setSecretaryId(secs[0].id);
            setMissionType('supervised');
          } else {
            setMissionType('independent');
          }
          setLoading(false);
          return;
        }

        if (jobId) {
          const [job, runs] = await Promise.all([
            hostCall('schedule.get', { id: jobId }) as Promise<ScheduledJob>,
            hostCall('schedule.history', { id: jobId, limit: 20 }).catch(() => []) as Promise<
              ScheduleRun[]
            >,
          ]);
          if (!alive) return;
          setEditingJob(job);
          setHistory(Array.isArray(runs) ? runs : []);
          const existingRecordLoc = findExistingHostForTask(workspace, `schedule:${job.id}`);
          const existingBound = existingRecordLoc?.hostPageId || extractBoundPageId(job);
          if (existingBound && selectablePages.some((p) => p.id === existingBound)) {
            setDestMode('existing-page');
            setTargetPageId(existingBound);
            if (existingRecordLoc?.databaseId) setTargetDbId(existingRecordLoc.databaseId);
          } else if (selectablePages[0]) {
            setDestMode('existing-page');
            setTargetPageId(selectablePages[0].id);
          } else {
            setDestMode('new-page');
          }
          setGrantRight(existingBound ? 'write' : 'none');

          setName(job.name);
          setPrompt(job.action.prompt);
          setEmployeeId(job.action.employeeId);
          setChannelId(job.action.channelId || '');
          setEnabled(job.enabled);
          setPriority(job.plan?.priority || 'normal');
          setTags(userVisibleTags(job.plan?.tags).join(', '));
          setNotes(job.plan?.notes || '');
          setTimeoutSeconds(String(job.timeoutSeconds ?? 1800));
          setGraceSeconds(String(job.graceSeconds ?? 60));
          setMaxOccurrences(job.maxOccurrences ? String(job.maxOccurrences) : '');
          setEffort(job.action.effort || '');
          setThinking(
            job.action.thinking === undefined ? 'inherit' : job.action.thinking ? 'on' : 'off',
          );

          const r = job.rule;
          if (r.kind === 'once') {
            setTab('once');
            setOnceMode('at');
            setTimezone(zone);
            setOnceAt(toLocalInput(r.at, zone));
          } else if (r.kind === 'event') {
            setTab('event');
            setTimezone(zone);
            setEventType(r.event);
            setEventChannel(r.channelId || '');
            setEventConversation(r.conversation || '');
            setEventEmployee(r.employeeId || '');
            setEventMonitor(r.monitorId || '');
            setCooldown(String(r.cooldownSeconds ?? 60));
          } else if (r.kind === 'interval') {
            setTab('repeat');
            setRepeatKind('interval');
            const n = r.everySeconds;
            const u = n % 86400 === 0 ? 86400 : n % 3600 === 0 ? 3600 : n % 60 === 0 ? 60 : 1;
            setIntervalAmount(String(n / u));
            setIntervalUnit(String(u));
            setTimezone(zone);
          } else if (r.kind === 'weekly') {
            setTab('repeat');
            setRepeatKind(r.days.length === 7 ? 'daily' : 'weekly');
            setClockTime(r.time);
            setWeekdays(r.days);
            setTimezone(r.timezone || zone);
          } else if (r.kind === 'monthly') {
            setTab('repeat');
            setRepeatKind('monthly');
            setClockTime(r.time);
            setMonthDay(String(r.day));
            setTimezone(r.timezone || zone);
          }

          if (job.until) {
            const z =
              r.kind === 'weekly' || r.kind === 'monthly' ? r.timezone || zone : zone;
            setUntil(toLocalInput(job.until, z));
          }
          if (job.window) {
            setWindowStart(job.window.start);
            setWindowEnd(job.window.end);
            setWindowDays(job.window.days || [1, 2, 3, 4, 5, 6, 7]);
          }
          setIncludePageContext(false);
        } else if (missionId) {
          const mission = (await hostCall('mission.get', { id: missionId })) as Mission;
          if (!alive) return;
          setEditingMission(mission);
          const existingRecordLoc = findExistingHostForTask(workspace, `mission:${mission.id}`);
          const existingBound = existingRecordLoc?.hostPageId || extractBoundPageId(mission);
          if (existingBound && selectablePages.some((p) => p.id === existingBound)) {
            setDestMode('existing-page');
            setTargetPageId(existingBound);
            if (existingRecordLoc?.databaseId) setTargetDbId(existingRecordLoc.databaseId);
          } else if (selectablePages[0]) {
            setDestMode('existing-page');
            setTargetPageId(selectablePages[0].id);
          } else {
            setDestMode('new-page');
          }
          setGrantRight(existingBound ? 'write' : 'none');

          setTab('mission');
          setName(mission.name);
          setPrompt(mission.prompt);
          setMissionEmployees(mission.employeeIds);
          setMissionType(mission.type);
          setSecretaryId(mission.secretaryId || secs[0]?.id || '');
          const sec = mission.reminderSeconds;
          const u = sec % 86400 === 0 ? 86400 : sec % 3600 === 0 ? 3600 : sec % 60 === 0 ? 60 : 1;
          setReminderAmount(String(sec / u));
          setReminderUnit(String(u));
          setPriority(mission.plan?.priority || 'normal');
          setTags(userVisibleTags(mission.plan?.tags).join(', '));
          setNotes(mission.plan?.notes || '');
          setIncludePageContext(false);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void loadInitial();
    return () => {
      alive = false;
    };
  }, [jobId, missionId]);

  const targetEmployee = employees.find((e) => e.id === employeeId);
  const secretaries = employees.filter((e) => e.managementRole === 'secretary');

  useEffect(() => {
    let alive = true;
    setNativeEfforts([]);
    if (targetEmployee?.engine !== 'antigravity' || !window.native?.hostCall) return;
    void window.native
      .hostCall('engine.models', {
        engine: 'antigravity',
        ...(targetEmployee.model ? { model: targetEmployee.model } : {}),
      })
      .then((catalog: { models?: ModelInfo[]; defaultModel?: string }) => {
        if (!alive) return;
        const selected = catalog?.models?.find(
          (m) => m.value === (targetEmployee.model || catalog.defaultModel),
        );
        setNativeEfforts(selected?.supportedEffortLevels ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [targetEmployee?.id, targetEmployee?.engine, targetEmployee?.model]);

  const effortOptions =
    targetEmployee?.engine === 'antigravity'
      ? nativeEfforts
      : targetEmployee?.engine === 'deepseek'
        ? ['none', 'low', 'high', 'max']
        : ['low', 'medium', 'high', 'xhigh', 'max'];

  const isEditing = Boolean(editingJob || editingMission);

  const buildScheduleSpec = (resolvedPageId: string, resolvedPageTitle: string) => {
    const cleanPrompt =
      includePageContext && resolvedPageId
        ? buildPageContextPrompt(prompt, resolvedPageId, resolvedPageTitle || '无标题')
        : prompt.trim();
    const effectiveTags = mergeTagsWithPageBinding(tags, resolvedPageId || null);

    let timing: Record<string, unknown>;
    if (tab === 'once') {
      if (onceMode === 'after') {
        const secs = Math.round(Number(afterAmount) * Number(afterUnit));
        if (!Number.isFinite(secs) || secs < 1) throw new Error('延时时间必须大于等于 1 秒');
        timing = { afterSeconds: secs };
      } else {
        if (!onceAt) throw new Error('请选择执行日期与时间');
        const atIso =
          editingJob?.rule.kind === 'once' && onceAt === toLocalInput(editingJob.rule.at, timezone)
            ? editingJob.rule.at
            : toIsoInstant(onceAt, timezone);
        timing = { rule: { kind: 'once', at: atIso } };
      }
    } else if (tab === 'repeat') {
      if (repeatKind === 'interval') {
        const secs = Math.round(Number(intervalAmount) * Number(intervalUnit));
        if (!Number.isFinite(secs) || secs < 1) throw new Error('重复间隔必须大于等于 1 秒');
        timing = {
          rule: {
            kind: 'interval',
            everySeconds: secs,
            ...(editingJob?.rule.kind === 'interval' ? { anchor: editingJob.rule.anchor } : {}),
          },
        };
      } else if (repeatKind === 'monthly') {
        timing = {
          rule: {
            kind: 'monthly',
            day: monthDay === 'last' ? 'last' : Number(monthDay),
            time: clockTime,
            timezone,
          },
        };
      } else {
        const days = repeatKind === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [...weekdays].sort();
        if (!days.length) throw new Error('请至少选择一天每周执行时间');
        timing = {
          rule: {
            kind: 'weekly',
            time: clockTime,
            days,
            timezone,
          },
        };
      }
    } else {
      const cd = Number(cooldown);
      if (!Number.isInteger(cd) || cd < 0 || cd > 86400) {
        throw new Error('事件冷却时间需在 0–86400 秒之间');
      }
      if (eventType === 'channel.posted' && !eventChannel) throw new Error('请选择监听的频道');
      if (eventType === 'message.received' && !eventConversation) throw new Error('请选择监听的会话');
      if (eventType === 'session.completed' && !eventEmployee) throw new Error('请选择监听的员工');
      if (eventType.startsWith('monitor.') && !eventMonitor) throw new Error('请选择脚本监控');

      timing = {
        rule: {
          kind: 'event',
          event: eventType,
          ...(eventType === 'channel.posted' ? { channelId: eventChannel } : {}),
          ...(eventType === 'message.received' ? { conversation: eventConversation } : {}),
          ...(eventType === 'session.completed' ? { employeeId: eventEmployee } : {}),
          ...(eventType.startsWith('monitor.') ? { monitorId: eventMonitor } : {}),
          cooldownSeconds: cd,
        },
      };
    }

    return {
      name: name.trim(),
      action: {
        type: 'agent' as const,
        employeeId,
        prompt: cleanPrompt,
        ...(channelId ? { channelId } : {}),
        ...(editingJob && targetEmployee?.engine ? { engine: targetEmployee.engine } : {}),
        ...(effort ? { effort } : {}),
        ...(thinking !== 'inherit' ? { thinking: thinking === 'on' } : {}),
      },
      ...timing,
      enabled,
      timeoutSeconds: Math.max(1, Number(timeoutSeconds) || 1800),
      graceSeconds: Math.max(1, Number(graceSeconds) || 60),
      maxOccurrences: maxOccurrences ? Number(maxOccurrences) : null,
      until: until ? toIsoInstant(until, timezone) : null,
      window:
        windowStart && windowEnd
          ? { start: windowStart, end: windowEnd, timezone, days: windowDays }
          : null,
      ...(channelId
        ? { source: `channel:${channelId}` }
        : resolvedPageId
          ? { source: `notebook:${resolvedPageId}` }
          : editingJob?.source
            ? { source: editingJob.source }
            : {}),
      plan: {
        priority,
        tags: effectiveTags,
        notes,
      },
    };
  };

  const buildMissionSpec = (resolvedPageId: string, resolvedPageTitle: string) => {
    const sec = Math.round(Number(reminderAmount) * Number(reminderUnit));
    if (!Number.isSafeInteger(sec) || sec < 10 || sec > 31536000) {
      throw new Error('督办提醒间隔需在 10 秒到 365 天之间');
    }
    if (!missionEmployees.length) throw new Error('请至少指定一位执行员工');
    if (missionType === 'supervised' && !secretaryId) throw new Error('请选择督办秘书');
    const cleanPrompt =
      includePageContext && resolvedPageId
        ? buildPageContextPrompt(prompt, resolvedPageId, resolvedPageTitle || '无标题')
        : prompt.trim();
    const effectiveTags = mergeTagsWithPageBinding(tags, resolvedPageId || null);

    return {
      name: name.trim(),
      prompt: cleanPrompt,
      employeeIds: missionEmployees,
      type: missionType,
      ...(missionType === 'supervised' ? { secretaryId } : {}),
      reminderSeconds: sec,
      plan: {
        priority,
        tags: effectiveTags,
        notes,
      },
    };
  };

  const previewSchedule = async () => {
    if (!window.native?.hostCall || tab === 'mission') return;
    setError('');
    setBusy(true);
    try {
      const spec = buildScheduleSpec(
        destMode === 'existing-page' ? targetPageId : '',
        boundPage?.title || newPageTitle || '任务规划',
      );
      const res = await window.native.hostCall('schedule.preview', {
        ...(editingJob ? { id: editingJob.id, patch: spec } : { spec }),
        count: 5,
      });
      setPreviewTimes(Array.isArray(res?.times) ? res.times : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!window.native?.hostCall || busy) return;
    setError('');
    if (!name.trim()) {
      setError('请填写任务标题');
      return;
    }
    if (!prompt.trim()) {
      setError('请填写执行指令');
      return;
    }
    if (destMode === 'existing-page' && !targetPageId) {
      setError('请选择要保存任务的现有页面，或切换为“新建页面保存”');
      return;
    }

    setBusy(true);
    try {
      const hostCall = window.native.hostCall;
      let affectedEmployees: string[] = [];

      // Step 1: If destMode === 'new-page', pre-allocate host page ID so prompt/tags bind cleanly
      let finalHostPageId = destMode === 'existing-page' ? targetPageId : '';
      let createdHostPageId = '';
      let savedJob: ScheduledJob | null = null;
      let savedMission: Mission | null = null;

      // Determine pre-existing or new page title for context prompt
      const targetTitle =
        destMode === 'new-page'
          ? newPageTitle.trim() || `🗓️ ${name.trim()}`
          : boundPage?.title || '无标题';

      // Create the new page + database view first if destMode === 'new-page', or upsert after Core call:
      // Actually creating/updating in Core first ensures we never create orphan Notion rows if Core validation rejects!
      if (tab === 'mission') {
        const spec = buildMissionSpec(finalHostPageId, targetTitle);
        const sig = JSON.stringify(['mission', spec]);
        if (sig !== lastSigRef.current) {
          reqKeyRef.current = crypto.randomUUID();
          lastSigRef.current = sig;
        }
        if (editingMission) {
          savedMission = (await hostCall('mission.update', {
            id: editingMission.id,
            patch: spec,
            expectedRevision: editingMission.revision,
          })) as Mission;
        } else {
          savedMission = (await hostCall('mission.create', {
            spec,
            clientRequestId: reqKeyRef.current,
          })) as Mission;
        }
        affectedEmployees = spec.employeeIds;
      } else {
        if (!employeeId) throw new Error('请选择执行 AI 员工');
        const spec = buildScheduleSpec(finalHostPageId, targetTitle);
        const sig = JSON.stringify(['schedule', spec]);
        if (sig !== lastSigRef.current) {
          reqKeyRef.current = crypto.randomUUID();
          lastSigRef.current = sig;
        }
        if (editingJob) {
          savedJob = (await hostCall('schedule.update', {
            id: editingJob.id,
            patch: spec,
            expectedRevision: editingJob.revision ?? 1,
          })) as ScheduledJob;
        } else {
          savedJob = (await hostCall('schedule.create', {
            spec,
            clientRequestId: reqKeyRef.current,
          })) as ScheduledJob;
        }
        affectedEmployees = [employeeId];
      }

      // Step 2: Save/Upsert the structured Task Record into the Notion Page's Database View
      if (workspace) {
        const recordPayload = savedMission
          ? missionToTaskRecordData(savedMission, employees, hostTimezone)
          : jobToTaskRecordData(savedJob!, employees, hostTimezone);

        update((state) => {
          const out = upsertTaskRecordInWorkspace(
            state,
            destMode === 'new-page'
              ? {
                  mode: 'new-page',
                  newPageTitle: newPageTitle.trim() || `${name.trim()} · 任务规划`,
                  preset: viewPreset,
                  parentId: null,
                }
              : {
                  mode: 'existing-page',
                  hostPageId: targetPageId,
                  targetDatabaseId: targetDbId || '__new_inline_db__',
                  newDbTitle: newDbTitle.trim() || undefined,
                  preset: viewPreset,
                },
            {
              ...recordPayload,
              updateBlocksOnExisting: true,
            },
          );
          finalHostPageId = out.hostPageId;
          if (destMode === 'new-page') createdHostPageId = out.hostPageId;
          return out.workspace;
        });

        // If a brand-new page was created, bind p:<createdHostPageId> back onto the Core schedule/mission cleanly
        if (createdHostPageId) {
          const boundTags = mergeTagsWithPageBinding(tags, createdHostPageId);
          if (savedJob) {
            await hostCall('schedule.update', {
              id: savedJob.id,
              patch: {
                source: channelId ? `channel:${channelId}` : `notebook:${createdHostPageId}`,
                plan: { priority, tags: boundTags, notes },
                ...(includePageContext
                  ? {
                      action: {
                        ...savedJob.action,
                        prompt: buildPageContextPrompt(prompt, createdHostPageId, targetTitle),
                      },
                    }
                  : {}),
              },
              expectedRevision: savedJob.revision ?? 1,
            }).catch(() => {});
          } else if (savedMission) {
            await hostCall('mission.update', {
              id: savedMission.id,
              patch: {
                plan: { priority, tags: boundTags, notes },
                ...(includePageContext
                  ? { prompt: buildPageContextPrompt(prompt, createdHostPageId, targetTitle) }
                  : {}),
              },
              expectedRevision: savedMission.revision,
            }).catch(() => {});
          }
        }
      }

      let accessNote: string | null = null;
      if (finalHostPageId && grantRight !== 'none') {
        accessNote = await grantPageAccessForEmployees(
          finalHostPageId,
          affectedEmployees,
          grantRight,
        );
      }

      if (createdHostPageId) {
        navigate(createdHostPageId);
      }

      notify(
        accessNote ||
          (isEditing
            ? '任务配置与数据库视图记录已同步保存'
            : destMode === 'new-page'
              ? '已新建任务页面并存入多数据库视图'
              : '已将任务存入当前页面的数据库视图'),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const quickAction = async (
    fn: () => Promise<unknown>,
    successMsg: string,
    closeAfter = false,
    trashRef?: string,
  ) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      if (trashRef) {
        update((state) => {
          const matchingIds = state.pages
            .filter((p) => !p.trashedAt && p.values?.[TASK_COL.ref] === trashRef)
            .map((p) => p.id);
          return matchingIds.reduce((acc, id) => trashPage(acc, id), state);
        });
      }
      notify(successMsg);
      if (closeAfter) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: PlannerTab; label: string; icon: typeof Clock }> = [
    { id: 'once', label: '定时单次', icon: Clock },
    { id: 'repeat', label: '重复周期', icon: Repeat },
    { id: 'event', label: '事件驱动', icon: Zap },
    { id: 'mission', label: '持续督办', icon: BellRing },
  ];

  const modalTitle = editingJob
    ? `编辑任务 · ${editingJob.name}`
    : editingMission
      ? `编辑督办 · ${editingMission.name}`
      : boundPage && destMode === 'existing-page'
        ? `布置任务到数据库视图 · ${boundPage.title || '无标题'}`
        : '新建页面与数据库任务';

  return (
    <Modal title={modalTitle} onClose={onClose} wide className="agent-task-composer-modal">
      {loading ? (
        <div className="planner-loading">正在加载 Agent 与数据库视图配置…</div>
      ) : (
        <form
          className="planner-composer-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          {!editingJob && !editingMission && (
            <div className="planner-mode-tabs" role="tablist" aria-label="任务触发类型">
              {tabs.map((item) => {
                const IconComp = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    data-planner-tab={item.id}
                    aria-selected={active}
                    className={active ? 'active' : ''}
                    onClick={() => {
                      setTab(item.id);
                      setPreviewTimes(null);
                    }}
                  >
                    <IconComp size={14} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Save Destination: Existing Page DB View vs New Page Multi-DB Views */}
          <section className="planner-destination-box" aria-label="数据库视图保存位置">
            <div className="planner-destination-head">
              <span className="planner-destination-label">
                <DatabaseIcon size={14} />
                <span>保存位置（页面与数据库视图）</span>
              </span>
              <div className="planner-segmented">
                <button
                  type="button"
                  data-dest-mode="existing-page"
                  aria-pressed={destMode === 'existing-page'}
                  disabled={!selectablePages.length}
                  className={destMode === 'existing-page' ? 'active' : ''}
                  onClick={() => {
                    setDestMode('existing-page');
                    if (!targetPageId && selectablePages[0]) {
                      setTargetPageId(selectablePages[0].id);
                    }
                  }}
                >
                  <LayoutGrid size={13} />
                  <span>存入现有页面的数据库视图</span>
                </button>
                <button
                  type="button"
                  data-dest-mode="new-page"
                  aria-pressed={destMode === 'new-page'}
                  className={destMode === 'new-page' ? 'active' : ''}
                  onClick={() => setDestMode('new-page')}
                >
                  <FilePlus2 size={13} />
                  <span>新开页面并存入数据库视图</span>
                </button>
              </div>
            </div>

            {destMode === 'existing-page' ? (
              <div className="planner-form-grid">
                <label className="planner-field">
                  <span>选择现有页面 *</span>
                  <AppSelect
                    aria-label="选择目标页面"
                    value={targetPageId}
                    onChange={(e) => {
                      setTargetPageId(e.target.value);
                      if (e.target.value && grantRight === 'none') setGrantRight('write');
                    }}
                  >
                    {selectablePages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.icon ? `${p.icon} ` : ''}
                        {p.title || '无标题页面'}
                      </option>
                    ))}
                  </AppSelect>
                </label>

                <label className="planner-field">
                  <span>选择或新建该页的数据库视图 *</span>
                  <AppSelect
                    aria-label="选择目标数据库视图"
                    value={targetDbId}
                    onChange={(e) => setTargetDbId(e.target.value)}
                  >
                    {pageDatabases.map((db) => (
                      <option key={db.databaseId} value={db.databaseId}>
                        {db.icon} {db.title}（{db.viewCount} 种视图）
                      </option>
                    ))}
                    <option value="__new_inline_db__">
                      ✨ 在该页面新增一个任务数据库视图块
                    </option>
                  </AppSelect>
                </label>

                {targetDbId === '__new_inline_db__' && (
                  <>
                    <label className="planner-field">
                      <span>新数据库视图组标题（可选）</span>
                      <input
                        aria-label="新数据库视图组标题"
                        placeholder="留空自动命名，同页可嵌入多个数据库视图"
                        value={newDbTitle}
                        onChange={(e) => setNewDbTitle(e.target.value)}
                      />
                    </label>
                    <label className="planner-field">
                      <span>可视化视图组合</span>
                      <AppSelect
                        aria-label="可视化视图组合"
                        value={viewPreset}
                        onChange={(e) => setViewPreset(e.target.value as TaskPagePreset)}
                      >
                        <option value="multi">丰富多视图块（主表 + 排期日历 + 状态看板）</option>
                        <option value="calendar">日历与执行时间线双视图</option>
                        <option value="board">状态看板与类型统计双视图</option>
                        <option value="table">紧凑单数据库（含 6 种可切换视图标签）</option>
                      </AppSelect>
                    </label>
                  </>
                )}
              </div>
            ) : (
              <div className="planner-form-grid">
                <label className="planner-field">
                  <span>新页面标题</span>
                  <input
                    name="plan-new-page-title"
                    aria-label="新建页面标题"
                    placeholder="留空将按任务名称自动命名新页面"
                    value={newPageTitle}
                    onChange={(e) => setNewPageTitle(e.target.value)}
                  />
                </label>

                <label className="planner-field">
                  <span>页面数据库视图组合</span>
                  <AppSelect
                    aria-label="页面数据库视图组合"
                    value={viewPreset}
                    onChange={(e) => setViewPreset(e.target.value as TaskPagePreset)}
                  >
                    <option value="multi">丰富多视图页面（任务总表 + 排期日历 + 状态看板）</option>
                    <option value="calendar">日历与时间线规划页（排期日历 + 时间线）</option>
                    <option value="board">看板与图表分析页（状态看板 + 类型分布图）</option>
                    <option value="table">标准单数据库页（含 6 种切换视图标签）</option>
                  </AppSelect>
                </label>
              </div>
            )}
          </section>

          <div className="planner-form-grid">
            <label className="planner-field planner-wide">
              <span>任务名称 *</span>
              <input
                name="plan-name"
                aria-label="任务名称"
                placeholder="例如：每日抓取行业动态并汇总写入本页数据库"
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="planner-field">
              <span>
                <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                自动页面授权
              </span>
              <AppSelect
                aria-label="自动页面授权"
                value={grantRight}
                onChange={(e) =>
                  setGrantRight(e.target.value as 'write' | 'read' | 'create' | 'none')
                }
              >
                <option value="write">授予读 + 写权限 (推荐，Agent 可更新页面)</option>
                <option value="read">仅授予阅读权限 (read)</option>
                <option value="create">授予读 + 写 + 新建子页 (create)</option>
                <option value="none">不修改现有页面授权</option>
              </AppSelect>
            </label>

            {tab !== 'mission' ? (
              <label className="planner-field">
                <span>执行 AI 员工 *</span>
                <AppSelect
                  name="plan-employee"
                  aria-label="执行 AI 员工"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  <option value="">选择 AI 员工</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.title} ({emp.engine})
                    </option>
                  ))}
                </AppSelect>
              </label>
            ) : (
              <>
                <label className="planner-field">
                  <span>督办模式</span>
                  <AppSelect
                    aria-label="督办模式"
                    value={missionType}
                    onChange={(e) => setMissionType(e.target.value as MissionSpec['type'])}
                  >
                    <option value="supervised">秘书协同督办 (Secretary 持续跟进)</option>
                    <option value="independent">员工独立完成 (直到我确认成功)</option>
                  </AppSelect>
                </label>

                {missionType === 'supervised' && (
                  <label className="planner-field">
                    <span>督办秘书</span>
                    <AppSelect
                      aria-label="督办秘书"
                      value={secretaryId}
                      onChange={(e) => setSecretaryId(e.target.value)}
                    >
                      <option value="">选择督办秘书</option>
                      {secretaries.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                )}
              </>
            )}

            {tab !== 'mission' && (
              <label className="planner-field">
                <span>同时发布到频道 (可选)</span>
                <AppSelect
                  aria-label="同时发布到频道"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="">不自动发帖到频道</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
            )}

            {tab === 'mission' && (
              <div className="planner-field planner-wide">
                <span>指定执行员工 *（可多选，已选 {missionEmployees.length} 人）</span>
                <div className="planner-employee-chips">
                  {employees.map((emp) => {
                    const checked = missionEmployees.includes(emp.id);
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        className={`planner-emp-chip ${checked ? 'selected' : ''}`}
                        aria-pressed={checked}
                        onClick={() =>
                          setMissionEmployees((prev) =>
                            prev.includes(emp.id)
                              ? prev.filter((id) => id !== emp.id)
                              : [...prev, emp.id],
                          )
                        }
                      >
                        <span>{emp.title}</span>
                        <small>{emp.engine}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="planner-field planner-wide">
              <label htmlFor="plan-prompt-textarea" style={{ fontWeight: 550 }}>
                执行指令 / 任务目标 *
              </label>
              <textarea
                id="plan-prompt-textarea"
                name="plan-prompt"
                aria-label="执行指令"
                rows={4}
                placeholder="清楚说明 Agent 要做什么、输出到哪里或交付标准…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              {!isEditing && (
                <label className="planner-inline-check">
                  <input
                    type="checkbox"
                    checked={includePageContext}
                    onChange={(e) => setIncludePageContext(e.target.checked)}
                  />
                  <span>自动附加目标 Notion 页面标识与数据库回写提示</span>
                </label>
              )}
            </div>
          </div>

          {/* Trigger Rules Section */}
          <div className="planner-rule-box">
            {tab === 'once' && (
              <div className="planner-rule-stack">
                <div className="planner-segmented">
                  <button
                    type="button"
                    aria-pressed={onceMode === 'after'}
                    className={onceMode === 'after' ? 'active' : ''}
                    onClick={() => setOnceMode('after')}
                  >
                    延时启动
                  </button>
                  <button
                    type="button"
                    aria-pressed={onceMode === 'at'}
                    className={onceMode === 'at' ? 'active' : ''}
                    onClick={() => setOnceMode('at')}
                  >
                    指定绝对时刻
                  </button>
                </div>

                {onceMode === 'after' ? (
                  <div className="planner-form-grid">
                    <label className="planner-field">
                      <span>延迟时长</span>
                      <input
                        aria-label="延迟时长"
                        type="number"
                        min={1}
                        value={afterAmount}
                        onChange={(e) => setAfterAmount(e.target.value)}
                      />
                    </label>
                    <label className="planner-field">
                      <span>单位</span>
                      <AppSelect
                        aria-label="延迟单位"
                        value={afterUnit}
                        onChange={(e) => setAfterUnit(e.target.value)}
                      >
                        <option value="1">秒后</option>
                        <option value="60">分钟后</option>
                        <option value="3600">小时后</option>
                        <option value="86400">天后</option>
                      </AppSelect>
                    </label>
                  </div>
                ) : (
                  <div className="planner-form-grid">
                    <label className="planner-field">
                      <span>执行时间</span>
                      <input
                        aria-label="执行时间"
                        type="datetime-local"
                        value={onceAt}
                        onChange={(e) => setOnceAt(e.target.value)}
                      />
                    </label>
                    <label className="planner-field">
                      <span>时区</span>
                      <input
                        aria-label="时区"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {tab === 'repeat' && (
              <div className="planner-rule-stack">
                <div className="planner-form-grid">
                  <label className="planner-field">
                    <span>重复周期</span>
                    <AppSelect
                      aria-label="重复周期"
                      value={repeatKind}
                      onChange={(e) =>
                        setRepeatKind(e.target.value as 'daily' | 'weekly' | 'monthly' | 'interval')
                      }
                    >
                      <option value="daily">每天固定时间</option>
                      <option value="weekly">每周指定星期</option>
                      <option value="monthly">每月指定日期</option>
                      <option value="interval">固定间隔循环</option>
                    </AppSelect>
                  </label>

                  <label className="planner-field">
                    <span>时区 (IANA)</span>
                    <AppSelect
                      aria-label="重复时区"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    >
                      {[
                        ...new Set([
                          timezone,
                          hostTimezone,
                          'Asia/Shanghai',
                          'UTC',
                          'America/New_York',
                          'Europe/London',
                          'Asia/Tokyo',
                        ]),
                      ].map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                </div>

                {repeatKind === 'interval' ? (
                  <div className="planner-form-grid">
                    <label className="planner-field">
                      <span>间隔数值</span>
                      <input
                        aria-label="间隔数值"
                        type="number"
                        min={1}
                        value={intervalAmount}
                        onChange={(e) => setIntervalAmount(e.target.value)}
                      />
                    </label>
                    <label className="planner-field">
                      <span>间隔单位</span>
                      <AppSelect
                        aria-label="间隔单位"
                        value={intervalUnit}
                        onChange={(e) => setIntervalUnit(e.target.value)}
                      >
                        <option value="60">分钟</option>
                        <option value="3600">小时</option>
                        <option value="86400">天</option>
                        <option value="1">秒</option>
                      </AppSelect>
                    </label>
                  </div>
                ) : (
                  <div className="planner-form-grid">
                    <label className="planner-field">
                      <span>触发时刻 (HH:mm)</span>
                      <input
                        aria-label="触发时刻"
                        type="time"
                        value={clockTime}
                        onChange={(e) => setClockTime(e.target.value)}
                      />
                    </label>

                    {repeatKind === 'monthly' && (
                      <label className="planner-field">
                        <span>每月日期</span>
                        <AppSelect
                          aria-label="每月日期"
                          value={monthDay}
                          onChange={(e) => setMonthDay(e.target.value)}
                        >
                          <option value="last">每月最后一天</option>
                          {Array.from({ length: 31 }, (_, i) => (
                            <option key={i + 1} value={String(i + 1)}>
                              每月 {i + 1} 日
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                    )}
                  </div>
                )}

                {repeatKind === 'weekly' && (
                  <div className="planner-weekdays" role="group" aria-label="重复星期">
                    {WEEKDAYS.map((w) => {
                      const active = weekdays.includes(w.day);
                      return (
                        <button
                          key={w.day}
                          type="button"
                          aria-pressed={active}
                          className={active ? 'active' : ''}
                          onClick={() =>
                            setWeekdays((prev) =>
                              prev.includes(w.day)
                                ? prev.filter((d) => d !== w.day)
                                : [...prev, w.day].sort(),
                            )
                          }
                        >
                          {w.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'event' && (
              <div className="planner-rule-stack">
                <div className="planner-form-grid">
                  <label className="planner-field">
                    <span>事件源</span>
                    <AppSelect
                      aria-label="事件源"
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value as ScheduleEvent['type'])}
                    >
                      <option value="message.received">收到新消息时 (群聊 / 私聊)</option>
                      <option value="channel.posted">频道发布新帖时</option>
                      <option value="session.completed">指定员工会话完成时</option>
                      <option value="monitor.output">脚本监控产生输出时</option>
                      <option value="monitor.exited">脚本监控退出时</option>
                      <option value="signal">外部/API 信号触发 (Signal)</option>
                    </AppSelect>
                  </label>

                  <label className="planner-field">
                    <span>防抖冷却 (秒)</span>
                    <input
                      aria-label="事件冷却秒数"
                      type="number"
                      min={0}
                      max={86400}
                      value={cooldown}
                      onChange={(e) => setCooldown(e.target.value)}
                    />
                  </label>

                  {eventType === 'channel.posted' && (
                    <label className="planner-field planner-wide">
                      <span>监听频道 *</span>
                      <AppSelect
                        aria-label="监听频道"
                        value={eventChannel}
                        onChange={(e) => setEventChannel(e.target.value)}
                      >
                        <option value="">请选择频道</option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}

                  {eventType === 'message.received' && (
                    <label className="planner-field planner-wide">
                      <span>监听会话 (群聊 / 员工对话) *</span>
                      <AppSelect
                        aria-label="监听会话"
                        value={eventConversation}
                        onChange={(e) => setEventConversation(e.target.value)}
                      >
                        <option value="">请选择群聊或员工对话</option>
                        {groups.map((g) => (
                          <option key={g.id} value={`group:${g.id}`}>
                            群聊 · {g.name}
                          </option>
                        ))}
                        {employees.map((emp) => (
                          <option key={emp.id} value={`employee:${emp.id}`}>
                            私聊 · {emp.title}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}

                  {eventType === 'session.completed' && (
                    <label className="planner-field planner-wide">
                      <span>监听上游员工 *</span>
                      <AppSelect
                        aria-label="监听上游员工"
                        value={eventEmployee}
                        onChange={(e) => setEventEmployee(e.target.value)}
                      >
                        <option value="">请选择员工</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.title}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}

                  {eventType.startsWith('monitor.') && (
                    <label className="planner-field planner-wide">
                      <span>监听脚本监控 *</span>
                      <AppSelect
                        aria-label="监听脚本监控"
                        value={eventMonitor}
                        onChange={(e) => setEventMonitor(e.target.value)}
                      >
                        <option value="">
                          {monitors.length ? '请选择监控器' : '暂无脚本监控 (需先通过 CLI 创建)'}
                        </option>
                        {monitors.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.state})
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  )}
                </div>
              </div>
            )}

            {tab === 'mission' && (
              <div className="planner-form-grid">
                <label className="planner-field">
                  <span>督办提醒间隔</span>
                  <input
                    aria-label="督办提醒间隔"
                    type="number"
                    min={reminderUnit === '1' ? 10 : 1}
                    value={reminderAmount}
                    onChange={(e) => setReminderAmount(e.target.value)}
                  />
                </label>
                <label className="planner-field">
                  <span>单位</span>
                  <AppSelect
                    aria-label="提醒单位"
                    value={reminderUnit}
                    onChange={(e) => setReminderUnit(e.target.value)}
                  >
                    <option value="60">分钟</option>
                    <option value="3600">小时</option>
                    <option value="86400">天</option>
                    <option value="1">秒</option>
                  </AppSelect>
                </label>
              </div>
            )}
          </div>

          {/* Priority, Tags, Notes */}
          <div className="planner-form-grid">
            <label className="planner-field">
              <span>优先级</span>
              <AppSelect
                name="plan-priority"
                aria-label="优先级"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as 'low' | 'normal' | 'high' | 'urgent')
                }
              >
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </AppSelect>
            </label>

            <label className="planner-field">
              <span>标签（逗号分隔）</span>
              <input
                name="plan-tags"
                aria-label="标签"
                placeholder="research, daily"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </label>

            <label className="planner-field planner-wide">
              <span>规划备注</span>
              <textarea
                name="plan-notes"
                aria-label="规划备注"
                rows={2}
                placeholder="补充上下文、验收标准或负责人说明…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>

          {tab !== 'mission' && (
            <details className="planner-advanced">
              <summary>高级选项（运行窗口、次数上限、超时与模型推理档位）</summary>
              <div className="planner-form-grid">
                <div className="planner-field">
                  <span>执行状态</span>
                  <label className="planner-inline-check" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span>{enabled ? '已启用自动排期' : '仅保存为暂停草稿'}</span>
                  </label>
                </div>

                <label className="planner-field">
                  <span>最多触发次数</span>
                  <input
                    aria-label="最多触发次数"
                    type="number"
                    min={1}
                    placeholder="不限次数"
                    value={maxOccurrences}
                    onChange={(e) => setMaxOccurrences(e.target.value)}
                  />
                </label>

                <label className="planner-field">
                  <span>截止日期时间</span>
                  <input
                    aria-label="截止日期时间"
                    type="datetime-local"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </label>

                <label className="planner-field">
                  <span>单次超时 (秒)</span>
                  <input
                    aria-label="单次超时"
                    type="number"
                    min={1}
                    max={86400}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                  />
                </label>

                <label className="planner-field">
                  <span>允许执行时间窗 (开始)</span>
                  <input
                    aria-label="时间窗开始"
                    type="time"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                  />
                </label>

                <label className="planner-field">
                  <span>允许执行时间窗 (结束)</span>
                  <input
                    aria-label="时间窗结束"
                    type="time"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                  />
                </label>

                <label className="planner-field">
                  <span>推理强度 (Effort)</span>
                  <AppSelect
                    aria-label="推理强度"
                    value={effort}
                    onChange={(e) => setEffort(e.target.value)}
                  >
                    <option value="">遵循员工默认配置</option>
                    {effortOptions.map((lv) => (
                      <option key={lv} value={lv}>
                        {lv}
                      </option>
                    ))}
                  </AppSelect>
                </label>

                <label className="planner-field">
                  <span>深度思考 (Thinking)</span>
                  <AppSelect
                    aria-label="深度思考"
                    value={thinking}
                    onChange={(e) => setThinking(e.target.value as 'inherit' | 'on' | 'off')}
                  >
                    <option value="inherit">遵循员工默认</option>
                    <option value="on">开启</option>
                    <option value="off">关闭</option>
                  </AppSelect>
                </label>
              </div>
            </details>
          )}

          {previewTimes && (
            <div className="planner-preview-box">
              <strong>
                <CalendarClock size={14} /> 未来触发时间预览：
              </strong>
              {previewTimes.length ? (
                <ul>
                  {previewTimes.map((t) => (
                    <li key={t}>{formatShortDate(t, timezone)}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {tab === 'event' ? '事件规则有效 · 等待真实事件触发' : '无未来触发时刻（可能已暂停或超过上限）'}
                </p>
              )}
            </div>
          )}

          {editingJob && history.length > 0 && (
            <details className="planner-advanced">
              <summary>
                <History size={13} /> 最近执行记录 ({history.length})
              </summary>
              <ul className="planner-history-list">
                {history.slice(0, 8).map((run) => (
                  <li key={run.id}>
                    <span className={`planner-run-status run-${run.status}`}>{run.status}</span>
                    <span>{formatShortDate(run.startedAt, timezone)}</span>
                    <small>{run.message || run.trigger}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {editingMission && showCompleteBox && (
            <div className="planner-complete-box">
              <label className="planner-field">
                <span>交付结果说明 *</span>
                <textarea
                  rows={2}
                  placeholder="确认已完成的具体交付结果或验证依据…"
                  value={completeResult}
                  onChange={(e) => setCompleteResult(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowCompleteBox(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !completeResult.trim()}
                  onClick={() =>
                    void quickAction(
                      () =>
                        window.native!.hostCall!('mission.complete', {
                          id: editingMission.id,
                          result: completeResult.trim(),
                          expectedRevision: editingMission.revision,
                        }),
                      '督办目标已标记完成',
                      true,
                    )
                  }
                >
                  确认完成
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="planner-error" role="alert">
              {error}
            </div>
          )}

          <div className="planner-modal-footer">
            <div className="planner-footer-left">
              {!isEditing && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setModal({ type: 'agent-tasks', pageId })}
                >
                  <DatabaseIcon size={14} /> 现有任务总览
                </button>
              )}
              {tab !== 'mission' && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void previewSchedule()}
                >
                  <Sparkles size={14} /> 预览时间
                </button>
              )}

              {editingJob && (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void quickAction(
                        () => window.native!.hostCall!('schedule.run', { id: editingJob.id }),
                        '已派发立即运行',
                        true,
                      )
                    }
                  >
                    <Play size={14} /> 立即运行
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() =>
                      void quickAction(
                        () =>
                          window.native!.hostCall!('schedule.delete', {
                            id: editingJob.id,
                            expectedRevision: editingJob.revision ?? 1,
                          }),
                        '任务已删除',
                        true,
                        `schedule:${editingJob.id}`,
                      )
                    }
                  >
                    <Trash2 size={14} /> 删除
                  </button>
                </>
              )}

              {editingMission && !editingMission.engineering && (
                <>
                  {editingMission.status !== 'succeeded' ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => setShowCompleteBox(true)}
                    >
                      <CheckCircle2 size={14} /> 标记完成
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void quickAction(
                            () =>
                              window.native!.hostCall!('mission.reopen', {
                                id: editingMission.id,
                                expectedRevision: editingMission.revision,
                              }),
                            '已重新打开督办目标',
                            true,
                          )
                        }
                      >
                        重开督办
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={busy}
                        onClick={() =>
                          void quickAction(
                            () =>
                              window.native!.hostCall!('mission.delete', {
                                id: editingMission.id,
                                expectedRevision: editingMission.revision,
                              }),
                            '已完成督办已删除',
                            true,
                            `mission:${editingMission.id}`,
                          )
                        }
                      >
                        <Trash2 size={14} /> 删除
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="planner-footer-right">
              <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? '保存中…' : isEditing ? '保存修改' : '布置任务'}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
