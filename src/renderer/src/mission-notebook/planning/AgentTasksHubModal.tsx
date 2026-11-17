import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Clock,
  Pause,
  Play,
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

type FilterKind = 'all' | 'current' | 'once' | 'repeat' | 'event' | 'mission' | 'paused';

export function AgentTasksHubModal({
  initialPageId,
  onClose,
}: {
  initialPageId?: string;
  onClose: () => void;
}) {
  const { workspace, navigate, setModal, notify } = useWorkspace();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [employees, setEmployees] = useState<TaskEmployee[]>([]);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const hostCall = window.native?.hostCall;
    if (!hostCall) {
      setLoading(false);
      return;
    }
    try {
      const [jobList, missionList, sessionRes] = await Promise.all([
        hostCall('schedule.list').catch(() => []),
        hostCall('mission.list', { archived: 'active' }).catch(() => []),
        hostCall('session.list').catch(() => ({ sessions: [] })),
      ]);
      setJobs(Array.isArray(jobList) ? jobList : []);
      setMissions(Array.isArray(missionList) ? missionList : []);
      setEmployees(
        Array.isArray(sessionRes?.sessions)
          ? sessionRes.sessions.filter((s: TaskEmployee) => !s.deleting)
          : [],
      );
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

  const pageTitle = (id: string | null) => {
    if (!id) return null;
    return workspace?.pages.find((p) => p.id === id && !p.trashedAt)?.title || 'Notion 页面';
  };

  const empName = (id: string) => employees.find((e) => e.id === id)?.title || '已移除员工';

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Array<
      | { kind: 'job'; job: ScheduledJob; boundPageId: string | null; cat: 'once' | 'repeat' | 'event' }
      | { kind: 'mission'; mission: Mission; boundPageId: string | null }
    > = [];

    for (const mission of missions) {
      const boundPageId = extractBoundPageId(mission);
      if (filter === 'current' && boundPageId !== initialPageId) continue;
      if (['once', 'repeat', 'event', 'paused'].includes(filter)) continue;
      if (q) {
        const hay = `${mission.name} ${mission.prompt} ${mission.plan?.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({ kind: 'mission', mission, boundPageId });
    }

    for (const job of jobs) {
      const boundPageId = extractBoundPageId(job);
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
  }, [missions, jobs, filter, query, initialPageId]);

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

  return (
    <Modal title="🎯 Agent 任务与督办总览" onClose={onClose} wide className="agent-tasks-hub-modal">
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

      <div className="planner-hub-filters" role="tablist" aria-label="任务筛选">
        {(
          [
            ['all', `全部 (${jobs.length + missions.length})`],
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
              const linkedTitle = pageTitle(boundPageId);
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
                            pageId: boundPageId || initialPageId,
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
                      {linkedTitle && boundPageId && (
                        <button
                          type="button"
                          className="planner-page-jump"
                          onClick={() => {
                            navigate(boundPageId);
                            onClose();
                          }}
                        >
                          <span>📄 {linkedTitle}</span>
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
                          pageId: boundPageId || initialPageId,
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
            const linkedTitle = pageTitle(boundPageId);
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
                          pageId: boundPageId || initialPageId,
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
                    {linkedTitle && boundPageId && (
                      <button
                        type="button"
                        className="planner-page-jump"
                        onClick={() => {
                          navigate(boundPageId);
                          onClose();
                        }}
                      >
                        <span>📄 {linkedTitle}</span>
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
                        pageId: boundPageId || initialPageId,
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
