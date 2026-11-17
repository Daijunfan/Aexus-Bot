import { useEffect, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui';
import { AppSelect } from './AppSelect';

type NotebookResource = {
  id: string;
  title: string;
  kind: string;
  capabilities?: ('read' | 'write' | 'create')[];
};

type AccessEmployee = {
  id: string;
  title: string;
  team?: string;
  role: string;
};

type Grant = {
  employeeId: string;
  resourceId: string;
  read: boolean;
  write: boolean;
  create: boolean;
};

export function NotebookAccessDialog({
  initialPageId,
  onClose,
}: {
  initialPageId?: string;
  onClose: () => void;
}) {
  const [resources, setResources] = useState<NotebookResource[]>([]);
  const [employees, setEmployees] = useState<AccessEmployee[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState(initialPageId || '@root');
  const [draft, setDraft] = useState<Record<string, { read: boolean; write: boolean; create: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');

  const loadData = async () => {
    if (!window.native?.hostCall) {
      setError('当前环境不支持页面权限管理');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [resList, access] = await Promise.all([
        window.native.hostCall('notebook.resources'),
        window.native.hostCall('notebook.access'),
      ]);
      const items: NotebookResource[] = Array.isArray(resList?.resources) ? resList.resources : [];
      setResources(items);
      setEmployees(Array.isArray(access?.employees) ? access.employees : []);
      setGrants(Array.isArray(access?.grants) ? access.grants : []);
      setRevision(Number(access?.revision ?? 0));
      setSelectedId((prev) => (items.some((r) => r.id === prev) ? prev : items[0]?.id || '@root'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const next: Record<string, { read: boolean; write: boolean; create: boolean }> = {};
    for (const emp of employees) {
      const g = grants.find((item) => item.employeeId === emp.id && item.resourceId === selectedId);
      next[emp.id] = {
        read: !!g?.read,
        write: !!g?.write,
        create: !!g?.create,
      };
    }
    setDraft(next);
  }, [selectedId, employees, grants]);

  const currentResource = resources.find((r) => r.id === selectedId);
  const capabilities = currentResource?.capabilities ?? ['read', 'write', 'create'];
  const supportsRead = capabilities.includes('read');
  const supportsWrite = capabilities.includes('write');
  const supportsCreate = capabilities.includes('create');

  const toggle = (empId: string, right: 'read' | 'write' | 'create', checked: boolean) => {
    setSavedNotice('');
    setDraft((prev) => {
      const cur = prev[empId] || { read: false, write: false, create: false };
      const updated = { ...cur, [right]: checked };
      if ((updated.write || updated.create) && supportsRead) updated.read = true;
      if (right === 'read' && !checked) {
        updated.write = false;
        updated.create = false;
      }
      return { ...prev, [empId]: updated };
    });
  };

  const save = async () => {
    if (!window.native?.hostCall) return;
    setSaving(true);
    setError('');
    setSavedNotice('');
    try {
      const payload = employees
        .filter((emp) => emp.role !== 'secretary')
        .map((emp) => {
          const r = draft[emp.id] || { read: false, write: false, create: false };
          return {
            employeeId: emp.id,
            read: supportsRead ? Boolean(r.read) : false,
            write: supportsWrite ? Boolean(r.write) : false,
            create: supportsCreate ? Boolean(r.create) : false,
          };
        });
      const updated = await window.native.hostCall('notebook.access', {
        resourceIds: [selectedId],
        employees: payload,
        expectedRevision: revision,
      });
      setGrants(Array.isArray(updated?.grants) ? updated.grants : []);
      setRevision(Number(updated?.revision ?? revision + 1));
      setSavedNotice('页面授权已原子保存');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="🔐 Mission 笔记本页面授权" onClose={onClose} wide className="notebook-access-modal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          按页面或数据库单独授予 AI 员工阅读（read）、编辑（write）与新建子页（create）权限；Secretary（秘书）默认拥有全量访问权限。
        </p>
        <label className="field-label">
          选择要授权的资源（根目录 / 页面 / 数据库）
          <AppSelect
            aria-label="选择要授权的资源"
            value={selectedId}
            onChange={(e) => {
              setSavedNotice('');
              setSelectedId(e.target.value);
            }}
          >
            {resources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id === '@root' ? '📁 @root（顶层工作区根目录）' : `${item.kind === 'database' ? '🗃️ ' : '📄 '}${item.title}`}
              </option>
            ))}
          </AppSelect>
        </label>

        {loading ? (
          <p className="muted">正在加载授权列表…</p>
        ) : employees.length === 0 ? (
          <p className="muted">当前还没有创建 AI 员工。可在「Message」中新建员工后再设置授权。</p>
        ) : (
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>员工</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>阅读 (read)</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>编辑 (write)</th>
                  <th style={{ textAlign: 'center', padding: '8px 10px' }}>新建子页 (create)</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const isSecretary = emp.role === 'secretary';
                  const rights = draft[emp.id] || { read: false, write: false, create: false };
                  return (
                    <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 500 }}>{emp.title}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {emp.team ? `${emp.team} · ` : ''}
                          {emp.role}
                        </div>
                      </td>
                      {isSecretary ? (
                        <td colSpan={3} style={{ textAlign: 'center', padding: '8px 10px', color: 'var(--muted)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <ShieldCheck size={14} /> Secretary 自动拥有全部权限
                          </span>
                        </td>
                      ) : (
                        <>
                          <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                            <input
                              type="checkbox"
                              aria-label={`${emp.title} read`}
                              disabled={!supportsRead}
                              checked={supportsRead && rights.read}
                              onChange={(e) => toggle(emp.id, 'read', e.target.checked)}
                            />
                          </td>
                          <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                            <input
                              type="checkbox"
                              aria-label={`${emp.title} write`}
                              disabled={!supportsWrite}
                              checked={supportsWrite && rights.write}
                              onChange={(e) => toggle(emp.id, 'write', e.target.checked)}
                            />
                          </td>
                          <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                            <input
                              type="checkbox"
                              aria-label={`${emp.title} create`}
                              disabled={!supportsCreate}
                              checked={supportsCreate && rights.create}
                              onChange={(e) => toggle(emp.id, 'create', e.target.checked)}
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p role="alert" style={{ color: '#e5484d', margin: 0, fontSize: 13 }}>
            {error}
          </p>
        )}
        {savedNotice && (
          <p role="status" style={{ color: '#30a46c', margin: 0, fontSize: 13 }}>
            {savedNotice}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="text-button" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="primary-button" disabled={loading || saving} onClick={() => void save()}>
            <LockKeyhole size={14} />
            {saving ? '保存中…' : '保存授权'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
