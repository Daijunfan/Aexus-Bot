import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Edit3, Pause, Play, Sparkles, Zap } from 'lucide-react';
import type { Mission } from '../../../../shared/missions';
import type { ScheduledJob } from '../../../../shared/scheduler';
import type { Page } from '../../../../shared/mission-notebook/types';
import { useWorkspace } from '../store';
import {
  formatMissionRule,
  formatScheduleRule,
  formatShortDate,
  missionStatusBadge,
  scheduleStatusBadge,
  type TaskEmployee,
} from './planningTypes';
import { getPageTaskRef, syncWorkspaceTaskRecords } from './taskDatabase';

export function useAgentTaskLiveSync() {
  const { update, modal } = useWorkspace();

  const runSync = useCallback(async () => {
    const hostCall = window.native?.hostCall;
    if (!hostCall) return;
    try {
      const [jobList, missionList, sessionRes, sysRes] = await Promise.all([
        hostCall('schedule.list').catch(() => []),
        hostCall('mission.list', { archived: 'all' }).catch(() => []),
        hostCall('session.list').catch(() => ({ sessions: [] })),
        hostCall('system.info').catch(() => ({})),
      ]);
      const jobs: ScheduledJob[] = Array.isArray(jobList) ? jobList : [];
      const missions: Mission[] = Array.isArray(missionList) ? missionList : [];
      const employees: TaskEmployee[] = Array.isArray(sessionRes?.sessions)
        ? sessionRes.sessions.filter((s: TaskEmployee) => !s.deleting)
        : [];
      const hostTimezone =
        (sysRes as { timezone?: string })?.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'Asia/Shanghai';

      update((state) =>
        syncWorkspaceTaskRecords(state, { jobs, missions, employees, hostTimezone }),
      );
    } catch {
      /* Ignore transient offline sync in browser-only preview. */
    }
  }, [update]);

  useEffect(() => {
    void runSync();
  }, [runSync, modal]);

  useEffect(() => {
    const off = window.native?.onHostEvent?.((event) => {
      if (
        ['schedule:changed', 'schedule:run', 'mission:changed', 'store:changed', 'client:connected'].includes(
          event.channel,
        )
      ) {
        void runSync();
      }
    });
    return () => off?.();
  }, [runSync]);
}

export function TaskRecordControlBar({ page }: { page: Page }) {
  const { setModal, notify } = useWorkspace();
  const taskRef = getPageTaskRef(page);
  const [job, setJob] = useState<ScheduledJob | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadTarget = useCallback(async () => {
    if (!taskRef || !window.native?.hostCall) return;
    try {
      if (taskRef.kind === 'schedule') {
        const res = (await window.native.hostCall('schedule.get', { id: taskRef.id })) as ScheduledJob;
        setJob(res);
        setMission(null);
      } else {
        const res = (await window.native.hostCall('mission.get', { id: taskRef.id })) as Mission;
        setMission(res);
        setJob(null);
      }
    } catch {
      setJob(null);
      setMission(null);
    } finally {
      setLoaded(true);
    }
  }, [taskRef?.kind, taskRef?.id]);

  useEffect(() => {
    void loadTarget();
  }, [loadTarget]);

  useEffect(() => {
    if (!taskRef) return;
    const off = window.native?.onHostEvent?.((ev) => {
      if (['schedule:changed', 'schedule:run', 'mission:changed'].includes(ev.channel)) {
        void loadTarget();
      }
    });
    return () => off?.();
  }, [taskRef?.kind, taskRef?.id, loadTarget]);

  if (!taskRef || !window.native?.hostCall) return null;

  if (taskRef.kind === 'schedule') {
    const badge = job ? scheduleStatusBadge(job) : null;
    return (
      <div className="task-record-control-bar" data-task-record-bar={taskRef.id}>
        <div className="task-record-bar-info">
          <Sparkles size={14} />
          <strong>{loaded && !job ? '关联调度任务已移除' : '实时调度已关联'}</strong>
          {badge && <span className={`planner-status-badge tone-${badge.tone}`}>{badge.label}</span>}
          {job && <small>{formatScheduleRule(job)}</small>}
          {job?.nextAt && <small>下次：{formatShortDate(job.nextAt)}</small>}
        </div>
        {job && (
          <div className="task-record-bar-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.native!.hostCall!('schedule.run', { id: job.id });
                  notify(`已立即派发「${job.name}」`);
                  await loadTarget();
                } catch (e) {
                  notify(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Play size={13} />
              <span>立即运行</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.native!.hostCall!(
                    job.enabled ? 'schedule.pause' : 'schedule.resume',
                    { id: job.id, expectedRevision: job.revision ?? 1 },
                  );
                  notify(job.enabled ? '已暂停定时调度' : '已启用定时调度');
                  await loadTarget();
                } catch (e) {
                  notify(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {job.enabled ? <Pause size={13} /> : <CheckCircle2 size={13} />}
              <span>{job.enabled ? '暂停' : '启用'}</span>
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                setModal({
                  type: 'page-task-composer',
                  jobId: taskRef.id,
                })
              }
            >
              <Edit3 size={13} />
              <span>编辑调度规则</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const badge = mission ? missionStatusBadge(mission) : null;
  return (
    <div className="task-record-control-bar" data-task-record-bar={taskRef.id}>
      <div className="task-record-bar-info">
        <Zap size={14} />
        <strong>{loaded && !mission ? '关联督办任务已移除' : '持续督办目标已关联'}</strong>
        {badge && <span className={`planner-status-badge tone-${badge.tone}`}>{badge.label}</span>}
        {mission && <small>{formatMissionRule(mission)}</small>}
      </div>
      {mission && (
        <div className="task-record-bar-actions">
          {mission.status !== 'succeeded' && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.native!.hostCall!('mission.remind', { id: mission.id });
                  notify(`已发送「${mission.name}」督办提醒`);
                  await loadTarget();
                } catch (e) {
                  notify(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <BellRing size={13} />
              <span>立即提醒</span>
            </button>
          )}
          {!mission.engineering && (
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                setModal({
                  type: 'page-task-composer',
                  missionId: taskRef.id,
                })
              }
            >
              <Edit3 size={13} />
              <span>编辑督办配置</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
