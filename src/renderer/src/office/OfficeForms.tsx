import { AvatarPicker } from '../components/AvatarPicker'
import { useEnabledAvatars } from '../components/AvatarCatalog'
import { directoryName } from '../../../shared/directory-names'
import { displayAvatar, randomAvatar } from '../../../shared/avatars'
import { translate as uiText, useI18n } from '../i18n'
import { ENGINE_DEFINITIONS, assertEngineWorkspace } from '../../../shared/engines'
import { managementRoles, rolePolicy, type ManagementRole } from '../../../shared/roles'
import { Icon } from '../components/Icon'
import { ModelSelect } from '../components/ModelSelect'
import { AppSelect } from '../components/AppSelect'
import { EmployeeFolderPicker } from './EmployeeFolderPicker'
import { RemoteConnectionFields } from './RemoteConnectionFields'
import { useEffect, useState, useRef } from 'react'
import { EmployeePortrait } from '../components/EmployeePortrait'
import { api } from '../api'
import { currentAvatar, SPRITE_COLORS } from '../../../shared/office'
import { ENGINES, canBindNativeSession, type Engine, type EmployeeKind, type StoredSession } from '../../../shared/types'
import type { CloudHost } from '../../../shared/remote'
import { useCatalog } from '../components/useCatalog'
import { Mascot } from './Mascot'
import { EngineMark } from '../components/EngineMark'

export type EmployeeFields = Partial<StoredSession> & {
  title: string
  engine: Engine
  directoryMode?: 'default' | 'bind'
  folderName?: string
  hostId?: string
  remoteDir?: string
}

export function EmployeeForm({
  employee,
  template,
  onSave,
  onBound,
  appearanceInitiallyOpen = false,
  onDirtyChange,
  onSavingChange,
  onConfigure,
  onCancel,
  inert = false,
}: {
  inert?: boolean
  onCancel?: () => void
  onConfigure?: () => void
  appearanceInitiallyOpen?: boolean
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
  employee?: StoredSession
  template?: Partial<StoredSession>
  onSave: (fields: EmployeeFields) => Promise<boolean>
  onBound?: (card: StoredSession) => Promise<void> | void
}) {
  useI18n()

  const availableAvatars = useEnabledAvatars()
  const [templateAvatar] = useState(() => randomAvatar(availableAvatars))
  const [fields, setFields] = useState<EmployeeFields>({
    title: '',
    engine: template?.engine ?? 'codex',
    kind: 'worker',
    workspaceMode: 'local',
    avatar: templateAvatar,
    accessory: template?.accessory ?? 'none',
    color: SPRITE_COLORS[currentAvatar(templateAvatar)],
    role: template?.role ?? '',
    model: template?.model,
    effort: template?.effort,
    permissionMode: template?.permissionMode,
    thinking: template?.thinking,
    planMode: template?.planMode,
    fastMode: template?.fastMode,
    managementRole: 'employee',
    ...employee,
  })
  const [saving, setSaving] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(appearanceInitiallyOpen)
  const editBaseline = useRef(fields)

  useEffect(() => {
    if (availableAvatars.includes(currentAvatar(fields.avatar ?? templateAvatar)) || (employee && fields.avatar === employee.avatar))
      return
    const avatar = displayAvatar(fields.avatar ?? templateAvatar, availableAvatars)
    setFields((previous) => ({ ...previous, avatar, color: SPRITE_COLORS[currentAvatar(avatar)] }))
  }, [availableAvatars, fields.avatar, employee?.avatar, templateAvatar])

  useEffect(() => {
    onSavingChange?.(saving)
    return () => onSavingChange?.(false)
  }, [saving, onSavingChange])

  const [workspaceLocation, setWorkspaceLocation] = useState<'local' | 'cloud'>(
    employee?.workspaceMode === 'cloud' || employee?.hostId || employee?.kind === 'cloud-native-worker' ? 'cloud' : 'local',
  )
  const cloudSelected = fields.kind === 'cloud-native-worker' || workspaceLocation === 'cloud'
  const [directoryMode, setDirectoryMode] = useState<'default' | 'bind'>(employee?.directoryMode ?? 'default')
  const [suggested, setSuggested] = useState('')
  const [unifiedRoot, setUnifiedRoot] = useState('')
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [engineCheck, setEngineCheck] = useState<{ state: 'idle' | 'checking' | 'ready' | 'error'; message: string }>({
    state: 'idle',
    message: '',
  })
  const [nativeSessions, setNativeSessions] = useState<{ id: string; cwd: string; preview: string }[]>([])
  const [nativeId, setNativeId] = useState('')
  const [nativeBusy, setNativeBusy] = useState(false)
  const creationTouched = useRef(false)
  const submitActive = useRef(false)

  const { value: hosts } = useCatalog<CloudHost>('host.list', !employee && cloudSelected, (e) => e.channel === 'store:changed')
  const selectedHost = hosts.find((host) => host.id === fields.hostId)

  useEffect(() => {
    onDirtyChange?.(
      employee
        ? (['title', 'avatar', 'color', 'accessory', 'role'] as const).some(
            (key) => fields[key] !== editBaseline.current[key],
          )
        : creationTouched.current || !!fields.title.trim(),
    )
  }, [fields, workspaceLocation, directoryMode, nativeId, employee, onDirtyChange])

  const report = (cause: unknown) =>
    setError(String((cause as Error).message || cause).replace(/^Error invoking remote method '[^']+': Error: /, ''))

  useEffect(() => {
    if (employee) return
    let active = true
    void api
      .call<{ workspacesRoot?: string }>('status')
      .then((info) => {
        if (active && info.workspacesRoot) setUnifiedRoot(info.workspacesRoot)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [employee])

  useEffect(() => {
    if (employee) return
    if (cloudSelected && !fields.hostId) {
      setSuggested('')
      return
    }
    let active = true
    void api
      .call<{ path: string }>('workspace.suggest', {
        title: fields.title.trim() || 'employee',
        ...(fields.folderName?.trim() ? { folderName: fields.folderName.trim() } : {}),
        ...(cloudSelected && fields.hostId
          ? {
              hostId: fields.hostId,
              ...(fields.remoteDir?.trim() ? { remoteDir: fields.remoteDir.trim() } : {}),
            }
          : {}),
        directoryMode,
        ...(directoryMode === 'bind' && fields.cwd?.trim() ? { path: fields.cwd.trim() } : {}),
      })
      .then((result) => {
        if (active) setSuggested(result.path)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [employee, cloudSelected, fields.hostId, fields.remoteDir, fields.title, fields.folderName, fields.cwd, directoryMode])

  useEffect(() => {
    setPickerOpen(false)
  }, [fields.hostId, workspaceLocation])

  useEffect(() => {
    if (fields.kind !== 'cloud-native-worker' || (employee && fields.engine === employee.engine)) {
      setEngineCheck({ state: 'ready', message: '' })
      return
    }
    if (!fields.hostId) {
      setEngineCheck({ state: 'error', message: uiText('Choose a cloud host first') })
      return
    }
    try {
      assertEngineWorkspace(fields.engine, 'cloud', fields.kind)
    } catch (cause) {
      setEngineCheck({ state: 'error', message: (cause as Error).message })
      return
    }
    let active = true
    setEngineCheck({ state: 'checking', message: uiText('Checking cloud Coding Agent…') })
    void api
      .call<{ version: string; authentication: string }>('engine.remote-check', {
        hostId: fields.hostId,
        ...(fields.remoteDir?.trim() ? { directory: fields.remoteDir.trim() } : {}),
        engine: fields.engine,
      })
      .then((result) => {
        if (active) setEngineCheck({ state: 'ready', message: `${result.version} · ${uiText('Auth')} ${result.authentication}` })
      })
      .catch((cause) => {
        if (active) setEngineCheck({ state: 'error', message: (cause as Error).message })
      })
    return () => {
      active = false
    }
  }, [fields.kind, fields.hostId, fields.remoteDir, fields.engine, employee?.engine])

  const patch = (next: Partial<EmployeeFields>) => {
    creationTouched.current = true
    setFields((prev) => ({ ...prev, ...next }))
  }

  const engineWorkspaceError = (engine: Engine) => {
    try {
      assertEngineWorkspace(
        engine,
        employee?.workspaceMode === 'work' ? 'work' : cloudSelected ? 'cloud' : 'build',
        fields.kind ?? 'worker',
      )
      return ''
    } catch (cause) {
      return (cause as Error).message
    }
  }

  const choose = async () => {
    try {
      const result = await api.call<{ path: string | null }>('workspace.choose', {
        path: fields.cwd || unifiedRoot || undefined,
      })
      if (result.path) {
        patch({ cwd: result.path })
        setDirectoryMode('bind')
        setError('')
      }
    } catch (e) {
      report(e)
    }
  }

  const defaultFolderPlaceholder = directoryName(fields.title.trim() || 'employee', 'employee')

  const nameField = (
    <label>
      {uiText('Employee name')}
      <input
        name="title"
        autoFocus={!employee}
        required
        value={fields.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder={uiText('e.g. Codey')}
      />
      {employee && (
        <small className="name-lock-note">
          {uiText('Only changes the display name; the working folder keeps its original name')}
        </small>
      )}
    </label>
  )

  return (
    <form
      inert={inert}
      onChangeCapture={() => {
        creationTouched.current = true
      }}
      className={'employee-form' + (!employee ? ' creation-form' : '')}
      onSubmit={async (e) => {
        e.preventDefault()
        if (submitActive.current) return
        if (!employee && cloudSelected && !fields.hostId) {
          setError(uiText('Choose a cloud host first'))
          return
        }
        submitActive.current = true
        setSaving(true)
        setError('')
        try {
          const payload: EmployeeFields = employee
            ? {
                title: fields.title,
                engine: fields.engine,
                avatar: fields.avatar,
                accessory: fields.accessory,
                color: fields.color,
                role: fields.role,
              }
            : {
                ...fields,
                managementRole: fields.managementRole ?? 'employee',
                accessMode: 'trusted',
                remote: undefined,
                workspaceMode: cloudSelected ? 'cloud' : 'local',
                ...(cloudSelected
                  ? {
                      hostId: fields.hostId,
                      ...(fields.remoteDir?.trim() ? { remoteDir: fields.remoteDir.trim() } : {}),
                    }
                  : { hostId: undefined, remoteDir: undefined }),
                directoryMode,
                folderName:
                  directoryMode === 'default' && fields.folderName?.trim()
                    ? fields.folderName.trim()
                    : undefined,
                cwd: directoryMode === 'default' ? undefined : fields.cwd?.trim(),
              }
          const saved = await onSave(payload)
          if (!saved) setError(uiText('Save did not complete; check your directory settings.'))
        } catch (cause) {
          report(cause)
        } finally {
          submitActive.current = false
          setSaving(false)
        }
      }}
    >
      <div className="creation-identity">
        <div className="employee-preview">
          <div className="preview-halo" />
          {employee ? (
            <EmployeePortrait avatar={fields.avatar} color={fields.color} large />
          ) : (
            <Mascot kind={fields.avatar} accessory={fields.accessory} color={fields.color} />
          )}
        </div>
        <div className="creation-identity-fields">
          {!employee && nameField}
          <div className="appearance-actions">
            {!employee && (
              <button
                type="button"
                className="profile-change-character random-appearance"
                title={uiText('Random appearance')}
                aria-label={uiText('Random appearance')}
                onClick={() => {
                  const avatar = randomAvatar(availableAvatars)
                  patch({ avatar, color: SPRITE_COLORS[currentAvatar(avatar)], accessory: 'none' })
                  setAppearanceOpen(false)
                }}
              >
                <Icon name="refresh" />
              </button>
            )}
            <button
              type="button"
              className="profile-change-character"
              aria-expanded={appearanceOpen}
              onClick={() => setAppearanceOpen(true)}
            >
              <Icon name="edit" />
              {uiText('Change character')}
            </button>
          </div>
        </div>
      </div>
      {appearanceOpen && (
        <AvatarPicker
          value={fields.avatar ?? templateAvatar}
          onApply={(avatar) => patch({ avatar, color: SPRITE_COLORS[currentAvatar(avatar)], accessory: 'none' })}
          onClose={() => setAppearanceOpen(false)}
        />
      )}
      {employee && nameField}
      {!employee ? (
        <div className="form-row">
          <label>
            {uiText('Role')}
            <AppSelect
              name="managementRole"
              value={fields.managementRole ?? 'employee'}
              onChange={(event) => {
                const managementRole = event.target.value as ManagementRole
                patch({ managementRole })
              }}
            >
              {managementRoles().map((role) => (
                <option
                  key={role.value}
                  value={role.value}
                  disabled={role.requiresLocal && (cloudSelected || fields.kind === 'cloud-native-worker')}
                >
                  {uiText(role.label)}
                </option>
              ))}
            </AppSelect>
          </label>
          <label>
            {uiText('Execution location')}
            <AppSelect
              name="kind"
              value={fields.kind ?? 'worker'}
              onChange={(e) => {
                const kind = e.target.value as EmployeeKind
                if (kind === 'cloud-native-worker') setWorkspaceLocation('cloud')
                patch({
                  kind,
                  model: undefined,
                  cwd: '',
                  ...(kind === 'cloud-native-worker' && fields.managementRole === 'secretary'
                    ? { managementRole: 'employee' }
                    : {}),
                })
                setDirectoryMode('default')
              }}
            >
              <option value="worker">{uiText('Local engine')}</option>
              <option value="cloud-native-worker">{uiText('Cloud engine')}</option>
            </AppSelect>
          </label>
        </div>
      ) : null}

      <section className="creation-section creation-engine">
        <h3>
          {uiText('Coding engine')}
          <button
            type="button"
            className="creation-engine-settings"
            aria-label={uiText('Configure engines')}
            title={uiText('Configure engines')}
            onClick={() => (onConfigure ? onConfigure() : void api.call('view.open', { kind: 'settings' }))}
          >
            <Icon name="settings-gear" />
          </button>
        </h3>
        {employee ? (
          <div className="employee-engine-fixed">
            <EngineMark engine={employee.engine} size={22} />
            <span>
              {ENGINE_DEFINITIONS[employee.engine].label}
              <small>{uiText('The engine is fixed at creation. To change it, delete the employee and create a new one.')}</small>
            </span>
          </div>
        ) : (
          <div className="engine-choices" role="group" aria-label={uiText('Coding engine')}>
            {ENGINES.map(({ value: engine }) => (
              <button
                type="button"
                key={engine}
                aria-label={ENGINE_DEFINITIONS[engine].label}
                data-engine={engine}
                aria-pressed={engine === fields.engine}
                disabled={!!engineWorkspaceError(engine)}
                title={engineWorkspaceError(engine) || undefined}
                className={engine === fields.engine ? 'selected' : ''}
                onClick={() =>
                  patch({
                    engine,
                    model: undefined,
                    thinking: false,
                    effort: undefined,
                    planMode: ENGINE_DEFINITIONS[engine].capabilities.plan ? fields.planMode : false,
                    fastMode: false,
                  })
                }
              >
                <EngineMark engine={engine} size={22} />
                <span>{ENGINE_DEFINITIONS[engine].label}</span>
              </button>
            ))}
          </div>
        )}
        {!employee && (
          <ModelSelect
            engine={fields.engine}
            kind={fields.kind}
            hostId={fields.kind === 'cloud-native-worker' ? fields.hostId : undefined}
            value={fields.model}
            onChange={(model) => patch({ model: model || undefined })}
          />
        )}
      </section>

      <section className="creation-section creation-workspace">
        <h3>
          <Icon name={cloudSelected ? 'server' : 'folder-opened'} />
          {uiText('Employee workspace')}
        </h3>
        {employee ? (
          <div className="workspace-contract">
            <span>{uiText(cloudSelected ? 'Cloud workspace' : 'Local workspace')}</span>
            {employee.remote && <small>{employee.remote.host}</small>}
            <label>
              {uiText('Fixed working directory')}
              <code className="default-employee-path">{employee.cwd}</code>
            </label>
          </div>
        ) : (
          <div className="workspace-contract">
            <div className="directory-mode-options" role="group" aria-label={uiText('Workspace location')}>
              <button
                type="button"
                data-workspace-location="local"
                aria-pressed={!cloudSelected}
                disabled={fields.kind === 'cloud-native-worker'}
                className={!cloudSelected ? 'selected' : ''}
                onClick={() => {
                  setWorkspaceLocation('local')
                  patch({ hostId: undefined, remoteDir: undefined, cwd: '' })
                  setError('')
                }}
              >
                <Icon name="device-desktop" />
                {uiText('Local unified folder')}
              </button>
              <button
                type="button"
                data-workspace-location="cloud"
                aria-pressed={cloudSelected}
                className={cloudSelected ? 'selected' : ''}
                onClick={() => {
                  setWorkspaceLocation('cloud')
                  patch({ cwd: '' })
                  if (fields.managementRole === 'secretary') patch({ managementRole: 'employee' })
                  setError('')
                }}
              >
                <Icon name="server" />
                {uiText('Cloud host')}
              </button>
            </div>

            {!cloudSelected && unifiedRoot && (
              <div className="workspace-unified-root">
                <small>{uiText('Unified workspaces root')}</small>
                <code>{unifiedRoot}</code>
              </div>
            )}

            {cloudSelected && (
              <RemoteConnectionFields
                directoryLabel={directoryMode === 'default' ? 'Remote parent folder' : 'Remote working folder'}
                value={{ mode: 'cloud', hostId: fields.hostId, directory: fields.remoteDir }}
                onChange={(next) => {
                  patch({
                    hostId: next.hostId,
                    remoteDir: next.directory,
                    ...(directoryMode === 'bind' ? { cwd: next.directory } : {}),
                  })
                  setError('')
                }}
              />
            )}

            <div className="directory-mode-options" role="group" aria-label={uiText('Employee directory mode')}>
              {(['default', 'bind'] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  data-directory-mode={mode}
                  aria-pressed={directoryMode === mode}
                  className={directoryMode === mode ? 'selected' : ''}
                  onClick={() => {
                    setDirectoryMode(mode)
                    setPickerOpen(mode === 'bind' && cloudSelected)
                    if (mode === 'bind') {
                      patch({ cwd: cloudSelected ? fields.remoteDir ?? '' : '' })
                      if (!cloudSelected) void choose()
                    }
                    setError('')
                  }}
                >
                  {mode === 'default'
                    ? uiText(cloudSelected ? 'Create employee subfolder' : 'Create automatically')
                    : uiText('Bind an existing folder')}
                </button>
              ))}
            </div>

            {directoryMode === 'default' ? (
              <>
                <label>
                  {uiText('Folder name (optional)')}
                  <input
                    name="folderName"
                    value={fields.folderName ?? ''}
                    placeholder={defaultFolderPlaceholder}
                    onChange={(e) => patch({ folderName: e.target.value })}
                  />
                </label>
                <label>
                  {uiText('Default working directory')}
                  <code className="default-employee-path" data-default-cwd>
                    {suggested ||
                      (unifiedRoot
                        ? `${unifiedRoot}/${fields.folderName?.trim() || defaultFolderPlaceholder}`
                        : uiText('Choose a cloud host first'))}
                  </code>
                </label>
              </>
            ) : (
              <>
                <label>
                  {uiText('Folder')}
                  <div className="folder-input">
                    <input
                      name="cwd"
                      required
                      readOnly={!cloudSelected}
                      value={fields.cwd ?? ''}
                      placeholder={uiText('Choose an existing folder')}
                      onChange={(e) => patch({ cwd: e.target.value })}
                    />
                    <button type="button" onClick={() => (cloudSelected ? setPickerOpen(true) : void choose())}>
                      {uiText('Browse')}
                    </button>
                  </div>
                </label>
                {pickerOpen && cloudSelected && fields.hostId && (
                  <EmployeeFolderPicker
                    hostId={fields.hostId}
                    initialPath={fields.remoteDir || selectedHost?.defaultDirectory}
                    windows={selectedHost?.os === 'windows'}
                    selected={fields.cwd ?? ''}
                    onSelect={(cwd) => {
                      patch({ cwd, remoteDir: cwd })
                      setError('')
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </>
            )}
          </div>
        )}
      </section>

      <details className="employee-advanced-settings" open={employee ? true : undefined}>
        <summary>
          <Icon name="settings-gear" />
          {uiText('Permissions and native session')}
          <Icon name="chevron-down" />
        </summary>
        {employee && (
          <div className="profile-fixed-role" aria-label={uiText('Employee role')}>
            <Icon name="lock" />
            <span>
              <small>{uiText('Role')}</small>
              <strong>{uiText(rolePolicy(employee.managementRole).label)}</strong>
            </span>
            <small>{uiText('Read-only in employee details')}</small>
          </div>
        )}
        {!employee && engineWorkspaceError(fields.engine) && (
          <p className="employee-form-error" role="alert">
            {engineWorkspaceError(fields.engine)}
          </p>
        )}
        {!employee && (
          <label>
            {uiText('Execution permissions')}
            <AppSelect
              name="permissionMode"
              value={fields.permissionMode ?? 'default'}
              onChange={(e) => patch({ permissionMode: e.target.value as StoredSession['permissionMode'] })}
            >
              <option value="default">
                {uiText(fields.engine === 'deepseek' ? 'Read only · Inspect without file changes' : 'Ask · Approve when needed')}
              </option>
              <option value="acceptEdits">{uiText('Workspace write · Workspace edits')}</option>
              <option value="bypassPermissions">{uiText('Full access · Trust the host account')}</option>
            </AppSelect>
          </label>
        )}
        {fields.kind === 'cloud-native-worker' && (
          <p className={`native-engine-check ${engineCheck.state}`} role="status">
            {engineCheck.message}
          </p>
        )}
        {employee?.kind === 'cloud-native-worker' && (
          <section className="native-session-bind">
            <strong>{uiText('Remote native session')}</strong>
            {(employee.threadId || employee.claudeSessionId) && (
              <p>
                {uiText('Linked')} {employee.engine === 'codex' ? 'Codex' : 'Claude Agent'} {uiText('Conversations')}{' '}
                <code>{employee.threadId ?? employee.claudeSessionId}</code>
                {employee.nativeOwnership === 'external' ? uiText(' · 外部会话，移除员工不会删除远端原件') : ''}
              </p>
            )}
            {canBindNativeSession(employee) && (
              <>
                <p>{uiText('Start a new conversation, or bind an existing session on this cloud host in the same working directory.')}</p>
                <button
                  type="button"
                  className="btn"
                  disabled={nativeBusy || fields.engine !== employee.engine || !employee.hostId}
                  onClick={async () => {
                    setNativeBusy(true)
                    try {
                      const result = await api.call<{ sessions: { id: string; cwd: string; preview: string }[] }>(
                        'engine.remote-sessions',
                        { hostId: employee.hostId, directory: employee.cwd, engine: employee.engine },
                      )
                      setNativeSessions(
                        result.sessions.filter(
                          (value) => value.cwd === employee.cwd && value.id !== (employee.threadId ?? employee.claudeSessionId),
                        ),
                      )
                      setError('')
                    } catch (cause) {
                      report(cause)
                    } finally {
                      setNativeBusy(false)
                    }
                  }}
                >
                  {nativeBusy ? uiText('Reading sessions…') : uiText('Read existing sessions')}
                </button>
                {!!nativeSessions.length && (
                  <>
                    <AppSelect name="nativeSession" value={nativeId} onChange={(e) => setNativeId(e.target.value)}>
                      <option value="" disabled>
                        {uiText('Choose a session in the same directory')}
                      </option>
                      {nativeSessions.map((value) => (
                        <option key={value.id} value={value.id}>
                          {value.preview || value.id}
                        </option>
                      ))}
                    </AppSelect>
                    <button
                      type="button"
                      className="btn"
                      disabled={!nativeId || nativeBusy}
                      onClick={async () => {
                        setNativeBusy(true)
                        try {
                          const result = await api.call<{ card: StoredSession }>('card.native-bind', {
                            id: employee.id,
                            sessionId: nativeId,
                          })
                          await onBound?.(result.card)
                          setError('')
                        } catch (cause) {
                          report(cause)
                        } finally {
                          setNativeBusy(false)
                        }
                      }}
                    >
                      {uiText('Bind selected session')}
                    </button>
                  </>
                )}
                {!nativeBusy && nativeSessions.length === 0 && (
                  <small>{uiText('Only sessions in the current working directory are shown.')}</small>
                )}
              </>
            )}
          </section>
        )}
      </details>

      {error && (
        <p className="employee-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        {onCancel && (
          <button type="button" className="btn creation-cancel" onClick={onCancel} disabled={saving}>
            {uiText('Cancel')}
          </button>
        )}
        <button
          className="btn primary save-employee"
          disabled={
            saving ||
            !fields.title.trim() ||
            (!employee && !!engineWorkspaceError(fields.engine)) ||
            (!employee && cloudSelected && !fields.hostId) ||
            (!employee && directoryMode === 'bind' && !fields.cwd?.trim()) ||
            (fields.kind === 'cloud-native-worker' && engineCheck.state !== 'ready')
          }
        >
          {saving ? uiText('Saving…') : employee ? uiText('Save changes') : uiText('Create employee')}
        </button>
      </div>
    </form>
  )
}
