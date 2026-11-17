import { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  History,
  ListTodo,
  Pause,
  Play,
  Plus,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import type { Mission } from '../../../../shared/missions';
import type { ScheduledJob, ScheduleRun } from '../../../../shared/scheduler';
import type { Page } from '../../../../shared/mission-notebook/types';
import { useWorkspace } from '../store';
import {
  formatMissionRule,
  formatScheduleRule,
  formatShortDate,
  isBoundToPage,
  missionStatusBadge,
  PRIORITY_LABELS,
  scheduleRuleCategory,
  scheduleStatusBadge,
  userVisibleTags,
  type TaskEmployee,
} from './planningTypes';

export function PageAgentPlanner({ page }: { page: Page }) {
  const { setModal, modal, notify } = useWorkspace();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [employees, setEmployees] = useState<TaskEmployee[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyRuns, setHistoryRuns] = useState<ScheduleRun[]>([]);
  const [completingMissionId, setCompletingMissionId] = useState<string | null>(null);
  const [completeText, setCompleteText] = useState('');

  const refresh = useCallback(async () => {
    const hostCall = window.native?.hostCall;
    if (!hostCall) return;
    try {
      const [jobList, missionList, sessionRes] = await Promise.all([
        hostCall('schedule.list').catch(() => []),
        hostCall('mission.list', { archived: 'active' }).catch(() => []),
        hostCall('session.list').catch(() => ({ sessions: [] })),
      ]);
      const allJobs: ScheduledJob[] = Array.isArray(jobList) ? jobList : [];
      const allMissions: Mission[] = Array.isArray(missionList) ? missionList : [];
      setJobs(allJobs.filter((j) => isBoundToPage(j, page.id)));
      setMissions(allMissions.filter((m) => isBoundToPage(m, page.id)));
      setEmployees(
        Array.isArray(sessionRes?.sessions)
          ? sessionRes.sessions.filter((s: TaskEmployee) => !s.deleting)
          : [],
      );
    } catch {
      /* Graceful fallback if Core RPC unavailable in standalone browser preview. */
    }
  }, [page.id]);

  useEffect(() => {
    void refresh();
  }, [refresh, modal]);

  useEffect(() => {
    const off = window.native?.onHostEvent?.((event) => {
      if (
        ['schedule:changed', 'schedule:run', 'mission:changed', 'store:changed', 'client:connected'].includes(
          event.channel,
        )
      ) {
        void refresh();
      }
    });
    return () => off?.();
  }, [refresh]);

  const employeeName = (id: string) =>
    employees.find((e) => e.id === id)?.title || '已移除员工';

  const openAgentChat = (empId: string) => {
    if (!window.native?.hostCall) return;
    void window.native.hostCall('view.open', { kind: 'messages', employee: empId }).catch(() => {});
  };

  const toggleHistory = async (jobId: string) => {
    if (historyJobId === jobId) {
      setHistoryJobId(null);
      return;
    }
    setHistoryJobId(jobId);
    try {
      const runs = await window.native?.hostCall?.('schedule.history', { id: jobId, limit: 8 });
      setHistoryRuns(Array.isArray(runs) ? runs : []);
    } catch {
      setHistoryRuns([]);
    }
  };

  const runJob = async (job: ScheduledJob) => {
    if (!window.native?.hostCall || busyId) return;
    setBusyId(job.id);
    try {
      await window.native.hostCall('schedule.run', { id: job.id });
      notify(`已立即派发「${job.name}」`);
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const togglePauseJob = async (job: ScheduledJob) => {
    if (!window.native?.hostCall || busyId) return;
    setBusyId(job.id);
    try {
      await window.native.hostCall(job.enabled ? 'schedule.pause' : 'schedule.resume', {
        id: job.id,
        expectedRevision: job.revision ?? 1,
      });
      notify(job.enabled ? `已暂停「${job.name}」` : `已恢复「${job.name}」`);
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const deleteJob = async (job: ScheduledJob) => {
    if (!window.native?.hostCall || busyId) return;
    setBusyId(job.id);
    try {
      await window.native.hostCall('schedule.delete', {
        id: job.id,
        expectedRevision: job.revision ?? 1,
      });
      notify(`已删除任务「${job.name}」`);
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remindMission = async (mission: Mission) => {
    if (!window.native?.hostCall || busyId) return;
    setBusyId(mission.id);
    try {
      await window.native.hostCall('mission.remind', { id: mission.id });
      notify(`已向执行人发送「${mission.name}」督办提醒`);
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const submitCompleteMission = async (mission: Mission) => {
    if (!window.native?.hostCall || busyId || !completeText.trim()) return;
    setBusyId(mission.id);
    try {
      await window.native.hostCall('mission.complete', {
        id: mission.id,
        result: completeText.trim(),
        expectedRevision: mission.revision,
      });
      setCompletingMissionId(null);
      setCompleteText('');
      notify(`督办目标「${mission.name}」已完成`);
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const totalCount = jobs.length + missions.length;
  const openComposer = (taskKind: 'once' | 'repeat' | 'event' | 'mission') =>
    setModal({ type: 'page-task-composer', pageId: page.id, taskKind });

  if (!window.native?.hostCall || page.database || totalCount === 0) return null;

  return (
    <section
      className="page-agent-planner"
      data-page-planner={page.id}
      aria-label="页面 Agent 任务规划"
    >
      <header className="page-planner-header">
        <div className="page-planner-title-group">
          {totalCount > 0 && (
            <button
              type="button"
              className="page-planner-collapse"
              aria-expanded={!collapsed}
              aria-label={collapsed ? '展开页面任务规划' : '折叠页面任务规划'}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <span className="page-planner-heading">
            <ListTodo size={14} />
            <span>Agent 任务规划</span>
            {totalCount > 0 && <small className="page-planner-count">{totalCount}</small>}
          </span>
        </div>

        <div className="page-planner-quick-actions">
          <button
            type="button"
            className="page-planner-add-btn"
            data-quick-task="once"
            onClick={() => openComposer('once')}
          >
            <Clock size={12} />
            <span>定时</span>
          </button>
          <button
            type="button"
            className="page-planner-add-btn"
            data-quick-task="repeat"
            onClick={() => openComposer('repeat')}
          >
            <Repeat size={12} />
            <span>重复</span>
          </button>
          <button
            type="button"
            className="page-planner-add-btn"
            data-quick-task="event"
            onClick={() => openComposer('event')}
          >
            <Zap size={12} />
            <span>事件</span>
          </button>
          <button
            type="button"
            className="page-planner-add-btn"
            data-quick-task="mission"
            onClick={() => openComposer('mission')}
          >
            <BellRing size={12} />
            <span>督办</span>
          </button>
        </div>
      </header>

      {totalCount > 0 && !collapsed && (
        <div className="page-planner-list">
          {missions.map((mission) => {
            const badge = missionStatusBadge(mission);
            const busy = busyId === mission.id;
            return (
              <article
                key={mission.id}
                className="page-planner-card"
                data-planner-mission-id={mission.id}
              >
                <div className="page-planner-card-main">
                  <div className="page-planner-card-top">
                    <span className="planner-kind-pill kind-mission">持续督办</span>
                    <button
                      type="button"
                      className="page-planner-card-title"
                      onClick={() =>
                        setModal({
                          type: 'page-task-composer',
                          pageId: page.id,
                          missionId: mission.id,
                        })
                      }
                    >
                      {mission.name}
                    </button>
                    <span className={`planner-status-badge tone-${badge.tone}`}>{badge.label}</span>
                    {mission.plan?.priority && mission.plan.priority !== 'normal' && (
                      <span className={`planner-priority pri-${mission.plan.priority}`}>
                        {PRIORITY_LABELS[mission.plan.priority]}
                      </span>
                    )}
                  </div>
                  <div className="page-planner-card-meta">
                    <span>{formatMissionRule(mission)}</span>
                    {mission.nextReminderAt && (
                      <span>下次提醒：{formatShortDate(mission.nextReminderAt)}</span>
                    )}
                    <span className="page-planner-assignees">
                      {mission.employeeIds.map((eid) => (
                        <button
                          key={eid}
                          type="button"
                          className="planner-agent-link"
                          title="前往与该员工对话"
                          onClick={() => openAgentChat(eid)}
                        >
                          {employeeName(eid)}
                        </button>
                      ))}
                    </span>
                    {userVisibleTags(mission.plan?.tags).map((tag) => (
                      <span key={tag} className="planner-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {completingMissionId === mission.id && (
                    <div className="page-planner-inline-complete">
                      <input
                        placeholder="输入验收成果说明…"
                        value={completeText}
                        onChange={(e) => setCompleteText(e.target.value)}
                      />
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || !completeText.trim()}
                        onClick={() => void submitCompleteMission(mission)}
                      >
                        确认完成
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setCompletingMissionId(null);
                          setCompleteText('');
                        }}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>

                <div className="page-planner-card-actions">
                  {mission.status !== 'succeeded' && (
                    <>
                      <button
                        type="button"
                        title="发送一次督办提醒"
                        disabled={busy}
                        onClick={() => void remindMission(mission)}
                      >
                        <BellRing size={13} />
                      </button>
                      <button
                        type="button"
                        title="标记为完成"
                        disabled={busy}
                        onClick={() => {
                          setCompletingMissionId(mission.id);
                          setCompleteText('');
                        }}
                      >
                        <CheckCircle2 size={13} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    title="编辑"
                    onClick={() =>
                      setModal({
                        type: 'page-task-composer',
                        pageId: page.id,
                        missionId: mission.id,
                      })
                    }
                  >
                    <Edit3 size={13} />
                  </button>
                </div>
              </article>
            );
          })}

          {jobs.map((job) => {
            const category = scheduleRuleCategory(job);
            const badge = scheduleStatusBadge(job);
            const busy = busyId === job.id;
            const zone =
              job.rule.kind === 'weekly' || job.rule.kind === 'monthly'
                ? job.rule.timezone
                : undefined;
            return (
              <article key={job.id} className="page-planner-card" data-planner-job-id={job.id}>
                <div className="page-planner-card-main">
                  <div className="page-planner-card-top">
                    <span className={`planner-kind-pill kind-${category}`}>
                      {category === 'once' ? '定时' : category === 'repeat' ? '重复' : '事件'}
                    </span>
                    <button
                      type="button"
                      className="page-planner-card-title"
                      onClick={() =>
                        setModal({
                          type: 'page-task-composer',
                          pageId: page.id,
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
                    {job.nextAt && <span>下次：{formatShortDate(job.nextAt, zone)}</span>}
                    <button
                      type="button"
                      className="planner-agent-link"
                      title="前往与该员工对话"
                      onClick={() => openAgentChat(job.action.employeeId)}
                    >
                      {employeeName(job.action.employeeId)}
                    </button>
                    {userVisibleTags(job.plan?.tags).map((tag) => (
                      <span key={tag} className="planner-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                  {historyJobId === job.id && (
                    <ul className="planner-inline-history">
                      {historyRuns.length === 0 ? (
                        <li className="muted">暂无执行记录</li>
                      ) : (
                        historyRuns.map((run) => (
                          <li key={run.id}>
                            <span className={`planner-run-status run-${run.status}`}>{run.status}</span>
                            <span>{formatShortDate(run.startedAt, zone)}</span>
                            <small>{run.message || run.trigger}</small>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>

                <div className="page-planner-card-actions">
                  <button
                    type="button"
                    title="立即运行"
                    aria-label={`立即运行 ${job.name}`}
                    disabled={busy}
                    onClick={() => void runJob(job)}
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    title={job.enabled ? '暂停调度' : '恢复调度'}
                    aria-label={`${job.enabled ? '暂停' : '恢复'} ${job.name}`}
                    disabled={busy}
                    onClick={() => void togglePauseJob(job)}
                  >
                    {job.enabled ? <Pause size={13} /> : <Plus size={13} />}
                  </button>
                  <button
                    type="button"
                    title="运行记录"
                    aria-label={`运行记录 ${job.name}`}
                    onClick={() => void toggleHistory(job.id)}
                  >
                    <History size={13} />
                  </button>
                  <button
                    type="button"
                    title="编辑任务"
                    aria-label={`编辑 ${job.name}`}
                    onClick={() =>
                      setModal({
                        type: 'page-task-composer',
                        pageId: page.id,
                        jobId: job.id,
                      })
                    }
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    type="button"
                    title="删除任务"
                    aria-label={`删除 ${job.name}`}
                    disabled={busy}
                    onClick={() => void deleteJob(job)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
