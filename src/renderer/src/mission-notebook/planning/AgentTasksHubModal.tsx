import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Clock,
  Database as DatabaseIcon,
  FilePlus2,
  Pause,
  Plus,
  Repeat,
  Search,
  Zap,
} from 'lucide-react';
import type { Mission } from '../../../../shared/missions';
import type { ScheduledJob } from '../../../../shared/scheduler';
import { useWorkspace } from '../store';
import { Modal } from '../ui';
import {
  extractBoundPageId,
  formatMissionRule,
  formatScheduleRule,
  formatShortDate,
  missionStatusBadge,
  PRIORITY_LABELS,
  scheduleRuleCategory,
  scheduleStatusBadge,
  type TaskEmployee,
} from './planningTypes';
import {
  findExistingHostForTask,
  importExistingTasksToNewPageInWorkspace,
  TASK_COL,
} from './taskDatabase';

type FilterKind = 'all' | 'current' | 'once' | 'repeat' | 'event' | 'mission' | 'paused';

export function AgentTasksHubModal({
  initialPageId,
  onClose,
}: {
  initialPageId?: string;
  onClose: () => void;
}) {
  const { workspace, update, navigate, setModal, notify } = useWorkspace();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [employees, setEmployees] = useState<TaskEmployee[]>([]);
  const [hostTimezone, setHostTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  );
  const [filter, setFilter] = useState<FilterKind>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importTitle, setImportTitle] = useState('Agent 定时与督办任务中心');
  const [showImportBar, setShowImportBar] = useState(false);

  const loadAll = useCallback(async () => {
    const hostCall = window.native?.hostCall;
    if (!hostCall) {
      setLoading(false);
      return;
    }
    try {
      const [jobList, missionList, sessionRes, sysRes] = await Promise.all([
        hostCall('schedule.list').catch(() => []),
        hostCall('mission.list', { archived: 'active' }).catch(() => []),
        hostCall('session.list').catch(() => ({ sessions: [] })),
        hostCall('system.info').catch(() => ({})),
      ]);
      setJobs(Array.isArray(jobList) ? jobList : []);
      setMissions(Array.isArray(missionList) ? missionList : []);
      setEmployees(
        Array.isArray(sessionRes?.sessions)
          ? sessionRes.sessions.filter((s: TaskEmployee) => !s.deleting)
          : [],
      );
      if ((sysRes as { timezone?: string })?.timezone) {
        setHostTimezone((sysRes as { timezone: string }).timezone);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const off = window.native?.onHostEvent?.((event) => {
      if (
        ['schedule:changed', 'schedule:run', 'mission:changed', 'store:changed'].includes(
          event.channel,
        )
      ) {
        void loadAll();
      }
    });
    return () => off?.();
  }, [loadAll]);

  const backedRefs = useMemo(() => {
    const set = new Set<string>();
    for (const p of workspace?.pages ?? []) {
      const refVal = p.values?.[TASK_COL.ref];
      if (!p.trashedAt && typeof refVal === 'string' && refVal) {
        set.add(refVal);
      }
    }
    return set;
  }, [workspace?.pages]);

  const unbackedCount = useMemo(() => {
    let n = 0;
    for (const j of jobs) if (!backedRefs.has(`schedule:${j.id}`)) n++;
    for (const m of missions) if (!backedRefs.has(`mission:${m.id}`)) n++;
    return n;
  }, [jobs, missions, backedRefs]);

  const resolveLinkedPage = (ref: string, fallbackPageId: string | null) => {
    const hostLoc = findExistingHostForTask(workspace, ref);
    const id = hostLoc?.hostPageId || fallbackPageId;
    if (!id) return null;
    const found = workspace?.pages.find((p) => p.id === id && !p.trashedAt);
    return found ? { id: found.id, title: found.title || 'Notion 页面', inDb: Boolean(hostLoc) } : null;
  };

  const empName = (id: string) => employees.find((e) => e.id === id)?.title || '已移除员工';

  const handleManualSaveToNewPage = () => {
    if (!workspace || (!jobs.length && !missions.length)) return;
    const jobsToSave =
      unbackedCount > 0 && unbackedCount < totalCount
        ? jobs.filter((j) => !backedRefs.has(`schedule:${j.id}`))
        : jobs;
    const missionsToSave =
      unbackedCount > 0 && unbackedCount < totalCount
        ? missions.filter((m) => !backedRefs.has(`mission:${m.id}`))
        : missions;
    let newPageId = '';
    let importedCount = 0;
    update((state) => {
      const res = importExistingTasksToNewPageInWorkspace(state, {
        jobs: jobsToSave,
        missions: missionsToSave,
        employees,
        hostTimezone,
        pageTitle: importTitle.trim() || 'Agent 定时与督办任务中心',
        preset: 'multi',
      });
      newPageId = res.hostPageId;
      importedCount = res.importedCount;
      return res.workspace;
    });
    if (newPageId) {
      navigate(newPageId);
      notify(`已手动新建页面并保存 ${importedCount} 项任务到多数据库视图`);
      onClose();
    }
  };

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Array<
      | { kind: 'job'; job: ScheduledJob; boundPageId: string | null; cat: 'once' | 'repeat' | 'event' }
      | { kind: 'mission'; mission: Mission; boundPageId: string | null }
    > = [];

    for (const mission of missions) {
      const loc = findExistingHostForTask(workspace, `mission:${mission.id}`);
      const boundPageId = loc?.hostPageId || extractBoundPageId(mission);
      if (filter === 'current' && boundPageId !== initialPageId) continue;
      if (['once', 'repeat', 'event', 'paused'].includes(filter)) continue;
      if (q) {
        const hay = `${mission.name} ${mission.prompt} ${mission.plan?.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({ kind: 'mission', mission, boundPageId });
    }

    for (const job of jobs) {
      const loc = findExistingHostForTask(workspace, `schedule:${job.id}`);
      const boundPageId = loc?.hostPageId || extractBoundPageId(job);
      const cat = scheduleRuleCategory(job);
      if (filter === 'current' && boundPageId !== initialPageId) continue;
      if (filter === 'mission') continue;
      if (filter === 'paused' && job.enabled) continue;
      if (['once', 'repeat', 'event'].includes(filter) && cat !== filter) continue;
      if (q) {
        const hay = `${job.name} ${job.action.prompt} ${job.plan?.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({ kind: 'job', job, boundPageId, cat });
    }
    return out;
  }, [missions, jobs, filter, query, initialPageId, workspace]);

  const toggleJobPause = async (job: ScheduledJob) => {
    if (!window.native?.hostCall || busyId) return;
    setBusyId(job.id);
    try {
      await window.native.hostCall(job.enabled ? 'schedule.pause' : 'schedule.resume', {
        id: job.id,
        expectedRevision: job.revision ?? 1,
      });
      await loadAll();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const totalCount = jobs.length + missions.length;

  return (
    <Modal title="🎯 Agent 任务与数据库视图总览" onClose={onClose} wide className="agent-tasks-hub-modal">
      <div className="planner-hub-toolbar">
        <label className="planner-hub-search">
          <Search size={14} />
          <input
            aria-label="搜索 Agent 任务"
            placeholder="搜索任务名称、指令或备注…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {totalCount > 0 && (
          <button
            type="button"
            className="secondary-button"
            data-save-tasks-to-page-toggle="true"
            onClick={() => setShowImportBar((v) => !v)}
          >
            <FilePlus2 size={14} />
            <span>手动保存现有任务到新页面</span>
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          data-hub-new-task="true"
          onClick={() => setModal({ type: 'page-task-composer', pageId: initialPageId })}
        >
          <Plus size={15} />
          <span>布置新任务</span>
        </button>
      </div>

      {(showImportBar || unbackedCount > 0) && totalCount > 0 && (
        <div className="planner-hub-import-banner" role="region" aria-label="手动保存现有任务到新页面">
          <div className="planner-hub-import-copy">
            <DatabaseIcon size={15} />
            <div>
              <strong>
                {unbackedCount > 0
                  ? `检测到 ${unbackedCount} 项已保存任务尚未放入页面数据库视图`
                  : `可将全部 ${totalCount} 项现有任务手动汇总保存到一个新页面`}
              </strong>
              <small>将自动创建包含「任务总表 + 排期日历 + 状态看板」多数据库视图的 Notion 页面</small>
            </div>
          </div>
          <div className="planner-hub-import-controls">
            <input
              aria-label="导入页面标题"
              value={importTitle}
              onChange={(e) => setImportTitle(e.target.value)}
              placeholder="新页面标题…"
            />
            <button
              type="button"
              className="primary-button"
              data-save-tasks-to-page="true"
              onClick={handleManualSaveToNewPage}
            >
              <FilePlus2 size={14} />
              <span>
                新建页面并保存 ({unbackedCount > 0 ? unbackedCount : totalCount})
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="planner-hub-filters" role="tablist" aria-label="任务筛选">
        {(
          [
            ['all', `全部 (${totalCount})`],
            ...(initialPageId ? ([['current', '当前页面']] as const) : []),
            ['once', '定时单次'],
            ['repeat', '重复周期'],
            ['event', '事件驱动'],
            ['mission', '持续督办'],
            ['paused', '已暂停'],
          ] as Array<[FilterKind, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? 'active' : ''}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="planner-hub-list">
        {loading ? (
          <p className="muted" style={{ padding: 20, textAlign: 'center' }}>
            正在加载全部任务…
          </p>
        ) : filteredItems.length === 0 ? (
          <div className="planner-hub-empty">
            <p className="muted">当前筛选下没有 Agent 任务</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setModal({ type: 'page-task-composer', pageId: initialPageId })}
            >
              <Plus size={14} /> 立即布置一个任务
            </button>
          </div>
        ) : (
          filteredItems.map((entry) => {
            if (entry.kind === 'mission') {
              const { mission, boundPageId } = entry;
              const badge = missionStatusBadge(mission);
              const linked = resolveLinkedPage(`mission:${mission.id}`, boundPageId);
              return (
                <article
                  key={mission.id}
                  className="planner-hub-row"
                  data-hub-item-id={mission.id}
                >
                  <div className="planner-hub-row-body">
                    <div className="page-planner-card-top">
                      <span className="planner-kind-pill kind-mission">
                        <BellRing size={11} /> 督办
                      </span>
                      <button
                        type="button"
                        className="page-planner-card-title"
                        onClick={() =>
                          setModal({
                            type: 'page-task-composer',
                            pageId: linked?.id || initialPageId,
                            missionId: mission.id,
                          })
                        }
                      >
                        {mission.name}
                      </button>
                      <span className={`planner-status-badge tone-${badge.tone}`}>{badge.label}</span>
                    </div>
                    <div className="page-planner-card-meta">
                      <span>{formatMissionRule(mission)}</span>
                      <span>
                        负责：{mission.employeeIds.map((id) => empName(id)).join('、')}
                      </span>
                      {linked && (
                        <button
                          type="button"
                          className="planner-page-jump"
                          onClick={() => {
                            navigate(linked.id);
                            onClose();
                          }}
                        >
                          <span>{linked.inDb ? '📋' : '📄'} {linked.title}</span>
                          <ArrowUpRight size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="planner-hub-row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setModal({
                          type: 'page-task-composer',
                          pageId: linked?.id || initialPageId,
                          missionId: mission.id,
                        })
                      }
                    >
                      编辑
                    </button>
                  </div>
                </article>
              );
            }

            const { job, boundPageId, cat } = entry;
            const badge = scheduleStatusBadge(job);
            const linked = resolveLinkedPage(`schedule:${job.id}`, boundPageId);
            const IconComp = cat === 'once' ? Clock : cat === 'repeat' ? Repeat : Zap;
            return (
              <article key={job.id} className="planner-hub-row" data-hub-item-id={job.id}>
                <div className="planner-hub-row-body">
                  <div className="page-planner-card-top">
                    <span className={`planner-kind-pill kind-${cat}`}>
                      <IconComp size={11} />
                      {cat === 'once' ? '定时' : cat === 'repeat' ? '重复' : '事件'}
                    </span>
                    <button
                      type="button"
                      className="page-planner-card-title"
                      onClick={() =>
                        setModal({
                          type: 'page-task-composer',
                          pageId: linked?.id || initialPageId,
                          jobId: job.id,
                        })
                      }
                    >
                      {job.name}
                    </button>
                    <span className={`planner-status-badge tone-${badge.tone}`}>{badge.label}</span>
                    {job.plan?.priority && job.plan.priority !== 'normal' && (
                      <span className={`planner-priority pri-${job.plan.priority}`}>
                        {PRIORITY_LABELS[job.plan.priority]}
                      </span>
                    )}
                  </div>
                  <div className="page-planner-card-meta">
                    <span>{formatScheduleRule(job)}</span>
                    <span>负责：{empName(job.action.employeeId)}</span>
                    {job.nextAt && <span>下次：{formatShortDate(job.nextAt)}</span>}
                    {linked && (
                      <button
                        type="button"
                        className="planner-page-jump"
                        onClick={() => {
                          navigate(linked.id);
                          onClose();
                        }}
                      >
                        <span>{linked.inDb ? '📋' : '📄'} {linked.title}</span>
                        <ArrowUpRight size={11} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="planner-hub-row-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busyId === job.id}
                    onClick={() => void toggleJobPause(job)}
                  >
                    {job.enabled ? <Pause size={12} /> : <CheckCircle2 size={12} />}
                    <span>{job.enabled ? '暂停' : '启用'}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setModal({
                        type: 'page-task-composer',
                        pageId: linked?.id || initialPageId,
                        jobId: job.id,
                      })
                    }
                  >
                    编辑
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </Modal>
  );
}
