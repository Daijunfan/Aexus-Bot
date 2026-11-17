import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PluginGrant, PluginResource, PluginRights } from '../../../shared/plugin-access';
import { api } from '../api';
import { translate as uiText, useI18n } from '../i18n';
import { useDialogFocus } from '../office/useDialogFocus';
import { Icon } from './Icon';

type ResourceItem = PluginResource & { active?: boolean };
type AccessEmployee = { id: string; title: string; team: string; role: string };
type AccessPayload = {
  workspace?: string;
  revision: number;
  grants: PluginGrant[];
  employees: AccessEmployee[];
};

const RIGHTS: ReadonlyArray<'read' | 'write' | 'create'> = ['read', 'write', 'create'];
const RIGHT_LABELS: Record<'read' | 'write' | 'create', string> = {
  read: 'Read access',
  write: 'Modify access',
  create: 'Create access',
};

const KIND_LABELS: Record<string, string> = {
  root: 'Top-level Creation',
  document: 'Document',
  study: 'Study Set',
  host: 'Cloud Host',
};

export function LibraryAccessDialog({
  target,
  workspace,
  initialResourceIds,
  onClose,
  onSaved,
}: {
  target: 'reader' | 'host';
  workspace?: string;
  initialResourceIds?: string[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  useI18n();
  useDialogFocus('.library-access-dialog', true);

  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [selected, setSelected] = useState<string[]>(initialResourceIds ?? []);
  const [edits, setEdits] = useState<Record<string, Partial<PluginRights>>>({});
  const [filter, setFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [limit, setLimit] = useState(250);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const resourceCmd = target === 'reader' ? 'reader.resources' : 'host.resources';
  const accessCmd = target === 'reader' ? 'reader.access' : 'host.access';
  const scopeArgs = target === 'reader' && workspace ? { workspace } : {};

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const [catalog, current] = await Promise.all([
        api.call<{ resources: ResourceItem[] }>(resourceCmd, scopeArgs),
        api.call<AccessPayload>(accessCmd, scopeArgs),
      ]);
      const list = catalog.resources ?? [];
      setResources(list);
      setAccess(current);
      setEdits({});
      setSelected((old) => {
        if (old.length) return old.filter((id) => list.some((r) => r.id === id));
        if (initialResourceIds?.length) return initialResourceIds.filter((id) => list.some((r) => r.id === id));
        const active = list.filter((r) => r.active).map((r) => r.id);
        return active.length ? active : list.slice(0, 1).map((r) => r.id);
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, workspace]);

  const currentRights = (employeeId: string, resourceId: string): PluginRights => {
    const res = resources.find((r) => r.id === resourceId);
    return (
      access?.grants.find((g) => g.employeeId === employeeId && g.resourceId === resourceId) ??
      access?.grants.find((g) => g.employeeId === employeeId && g.resourceId === res?.inheritFrom) ?? {
        read: false,
        write: false,
        create: false,
      }
    );
  };

  const supported = (right: 'read' | 'write' | 'create') =>
    selected.length > 0 &&
    selected.every((id) => (resources.find((r) => r.id === id)?.capabilities ?? RIGHTS).includes(right));

  const valuesFor = (employeeId: string, right: 'read' | 'write' | 'create') =>
    selected.map((id) => edits[employeeId]?.[right] ?? currentRights(employeeId, id)[right]);

  const filteredResources = useMemo(
    () =>
      resources.filter(
        (r) =>
          !filter.trim() ||
          r.title.toLowerCase().includes(filter.trim().toLowerCase()) ||
          r.id.toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [resources, filter],
  );

  const filteredEmployees = useMemo(
    () =>
      (access?.employees ?? []).filter(
        (emp) =>
          !personFilter.trim() ||
          `${emp.title} ${emp.team}`.toLowerCase().includes(personFilter.trim().toLowerCase()),
      ),
    [access?.employees, personFilter],
  );

  const save = async () => {
    if (!access || busy) return;
    setBusy(true);
    setError('');
    try {
      const updates = selected.flatMap((resourceId) =>
        access.employees
          .filter((p) => p.role !== 'secretary' && Object.keys(edits[p.id] ?? {}).length > 0)
          .map((p) => ({
            employeeId: p.id,
            resourceId,
            ...currentRights(p.id, resourceId),
            ...edits[p.id],
          })),
      );
      await api.call(accessCmd, {
        ...scopeArgs,
        updates,
        expectedRevision: access.revision,
      });
      onSaved?.();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const titleText = uiText(target === 'reader' ? 'Study Reader' : 'Cloud Hosts');
  const subtitleText = uiText(
    target === 'reader'
      ? 'Manage per-employee access for Study Reader'
      : 'Manage per-employee access for Cloud Hosts',
  );

  return createPortal(
    <div className="library-modal-backdrop" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={uiText('Authorized people')}
        className="library-access-dialog"
      >
        <header className="library-access-header">
          <div>
            <small>{uiText('Authorized people')}</small>
            <h2>{titleText}</h2>
            <p>{subtitleText}</p>
          </div>
          <button
            type="button"
            className="library-icon-btn"
            aria-label={uiText('Close authorization')}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="library-access-columns">
          <section className="library-access-pane">
            <div className="library-access-pane-head">
              <h3>
                {uiText('Resources')} <small>({selected.length})</small>
              </h3>
              <div className="library-access-bulk-actions">
                <button
                  type="button"
                  disabled={busy || !filteredResources.length}
                  onClick={() => {
                    setSelected(filteredResources.slice(0, limit).map((r) => r.id));
                    setEdits({});
                  }}
                >
                  {uiText('Select all resources')}
                </button>
                <button
                  type="button"
                  disabled={busy || !selected.length}
                  onClick={() => {
                    setSelected([]);
                    setEdits({});
                  }}
                >
                  {uiText('Clear selection')}
                </button>
              </div>
            </div>
            <input
              type="search"
              aria-label={uiText('Search assets')}
              placeholder={uiText('Search…')}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="library-access-list">
              {filteredResources.slice(0, limit).map((resource) => {
                const isSelected = selected.includes(resource.id);
                return (
                  <label key={resource.id} className={isSelected ? 'is-selected' : ''}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={isSelected}
                      onChange={() => {
                        setSelected((old) =>
                          old.includes(resource.id)
                            ? old.filter((id) => id !== resource.id)
                            : [...old, resource.id],
                        );
                        setEdits({});
                      }}
                    />
                    <span>
                      <strong>{resource.title}</strong>
                      <small>{uiText(KIND_LABELS[resource.kind] ?? resource.kind)}</small>
                    </span>
                  </label>
                );
              })}
              {filteredResources.length > limit && (
                <button
                  type="button"
                  className="library-subtle-btn"
                  onClick={() => setLimit((old) => old + 250)}
                >
                  {uiText('Load more')}
                </button>
              )}
              {!filteredResources.length && !busy && (
                <p className="library-empty-note">{uiText('No results found')}</p>
              )}
            </div>
          </section>

          <section className="library-access-pane">
            <div className="library-access-pane-head">
              <h3>{uiText('Employee permissions')}</h3>
            </div>
            <input
              type="search"
              aria-label={uiText('Search employees')}
              placeholder={uiText('Search employees…')}
              value={personFilter}
              onChange={(event) => setPersonFilter(event.target.value)}
            />
            <div className="library-access-list">
              <div className="library-access-matrix-row is-header">
                <span>{uiText('Employee')}</span>
                {RIGHTS.map((right) => (
                  <span key={right}>{uiText(RIGHT_LABELS[right])}</span>
                ))}
              </div>
              {filteredEmployees.map((emp) => (
                <div key={emp.id} className="library-access-matrix-row">
                  <span>
                    <strong>{emp.title}</strong>
                    <small>
                      {emp.role === 'secretary'
                        ? uiText('Secretary · Full access')
                        : emp.team || uiText('Employee')}
                    </small>
                  </span>
                  {RIGHTS.map((right) => {
                    const vals = valuesFor(emp.id, right);
                    const automatic = emp.role === 'secretary';
                    const mixed = !automatic && vals.some(Boolean) && !vals.every(Boolean);
                    return (
                      <input
                        key={right}
                        type="checkbox"
                        aria-label={`${emp.title} ${uiText(RIGHT_LABELS[right])}`}
                        disabled={busy || automatic || !supported(right)}
                        checked={automatic || (vals.length > 0 && vals.every(Boolean))}
                        ref={(el) => {
                          if (el) el.indeterminate = mixed;
                        }}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setEdits((old) => ({
                            ...old,
                            [emp.id]: {
                              ...old[emp.id],
                              [right]: checked,
                              ...(checked && (right === 'write' || right === 'create') ? { read: true } : {}),
                              ...(!checked && right === 'read' ? { write: false, create: false } : {}),
                            },
                          }));
                        }}
                      />
                    );
                  })}
                </div>
              ))}
              {!filteredEmployees.length && !busy && (
                <p className="library-empty-note">{uiText('Add an employee in Message to assign access.')}</p>
              )}
            </div>
          </section>
        </div>

        <p className="library-access-hint">
          {uiText(
            'Only selected items are updated. Secretary is always authorized. Write or create permission automatically includes read.',
          )}
        </p>

        {error && (
          <div role="alert" className="library-error-banner">
            <span>{error}</span>
            <button type="button" disabled={busy} onClick={() => void load()}>
              {uiText('Retry')}
            </button>
          </div>
        )}

        <footer className="library-access-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {uiText('Cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !selected.length || !Object.keys(edits).length}
            onClick={() => void save()}
          >
            {uiText(busy ? 'Saving authorization…' : 'Save access')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
