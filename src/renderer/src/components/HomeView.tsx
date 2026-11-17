import { onPluginFlush } from '../plugins'
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard'
import '../styles/team-navigation.css'
import { translate as uiText, useI18n } from '../i18n'
import { retainEqual } from '../snapshot'
import { EmployeeInitialization } from './EmployeeInitialization'
import { CloneEmployeeForm } from './CloneEmployeeForm'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { employeeReady, type Store, type StoredSession } from '../../../shared/types'
import type { PluginDescriptor } from '../../../shared/plugins'
import { api } from '../api'
import type { ViewState } from '../../../shared/view'
import { SettingsPanel } from './SettingsPanel'
import { mergePreferences, presentationForView } from '../../../shared/preferences'
import { ApplicationLauncher } from './ApplicationLauncher'
import { useDialogFocus } from '../office/useDialogFocus'
import { EmployeeForm } from '../office/OfficeForms'
import { SharedDrawer } from './SharedDrawer'
import { TeamViews } from './TeamViews'
import { EmployeeProfile } from './EmployeeProfile'
import { BackButton } from './BackButton'

type Action = (cmd: string, args?: Record<string, unknown>, propagateError?: boolean) => Promise<any>

export const HomeView = memo(function HomeView({
  groupUnread = 0,
  store,
  view,
  act,
  assetWidth,
  onAssetResize,
  children,
  underHeader,
}: {
  groupUnread?: number
  children?: ReactNode
  underHeader?: ReactNode
  store: Store
  view: ViewState
  act: Action
  assetWidth: number
  onAssetResize: (width: number | undefined) => void
}) {
  useI18n()

  const creationAttempt = useRef({ panel: '', signature: '', id: crypto.randomUUID() })
  const formIdentity = JSON.stringify([view.kind, view.employee])
  if (creationAttempt.current.panel !== formIdentity)
    creationAttempt.current = { panel: formIdentity, signature: '', id: crypto.randomUUID() }

  const panel: { kind: 'employee'; card?: StoredSession } | null =
    view.kind === 'employee'
      ? { kind: 'employee' as const, card: store.sessions.find((c) => c.id === view.employee) }
      : null
  const editablePanel = !!panel && !panel.card
  const formExit = useRef({ dirty: false, saving: false, done: false })
  const panelActive = useRef(editablePanel)
  panelActive.current = editablePanel
  const [discardForm, setDiscardForm] = useState(false)

  useBeforeUnloadGuard(() => panelActive.current && !formExit.current.done && (formExit.current.dirty || formExit.current.saving))
  useEffect(() => {
    if (!editablePanel) {
      formExit.current = { dirty: false, saving: false, done: false }
      setDiscardForm(false)
    }
  }, [editablePanel])
  useEffect(
    () =>
      onPluginFlush(async () => {
        if (!panelActive.current || formExit.current.done) return
        if (formExit.current.saving) throw Error('Wait for this form to finish saving.')
        if (formExit.current.dirty) {
          setDiscardForm(true)
          throw Error('Save or discard this form before leaving.')
        }
      }),
    [],
  )

  const initializing = view.kind === 'initialization' ? store.sessions.find((card) => card.id === view.employee) : undefined
  const cloning = view.kind === 'clone' ? store.sessions.find((c) => c.id === view.employee) : undefined
  const setPanel = (value: typeof panel) =>
    value ? act('view.open', { kind: 'employee', employee: value.card?.id }) : act('view.close')
  const pluginId = view.pluginId ?? null

  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  useEffect(() => {
    const load = () =>
      void api
        .call<PluginDescriptor[]>('plugin.list')
        .then((value) => setPlugins((previous) => retainEqual(previous, value)))
        .catch(() => {})
    load()
    return api.onEvent((e) => {
      if (e.channel === 'store:changed') load()
    })
  }, [])

  const [checkingHosts, setCheckingHosts] = useState(false)
  const checkingHostsRef = useRef(false)
  const refreshHosts = async () => {
    if (checkingHostsRef.current) return
    checkingHostsRef.current = true
    setCheckingHosts(true)
    try {
      const hosts = await api.call<Array<{ id: string }>>('host.list')
      await Promise.all(hosts.map((host) => api.call('host.check', { id: host.id }).catch(() => {})))
    } finally {
      checkingHostsRef.current = false
      setCheckingHosts(false)
    }
  }

  const returnLabel =
    view.returnTo?.kind === 'library'
      ? 'Back to Library'
      : view.returnTo?.kind === 'plan'
        ? 'Back to Mission'
        : 'Back to Message'

  useDialogFocus('.office-panel', !!panel || !!cloning || view.kind === 'settings')
  const lastEmployee =
    store.lastEmployeeTemplate ??
    store.sessions.reduce<StoredSession | undefined>(
      (latest, card) => (!latest || card.createdAt > latest.createdAt ? card : latest),
      undefined,
    )

  return (
    <div className="home office-home">
      <header className="company-header">
        <ApplicationLauncher
          settingsOpen={view.kind === 'settings'}
          checkingHosts={checkingHosts}
          onRefreshHosts={() => void refreshHosts()}
          plugins={plugins}
          active={pluginId}
          sharedOpen={!!view.shared}
          onOpen={(id) => void act('plugin.open', { id })}
          onSettings={() => void act('view.open', { kind: 'settings' })}
          act={act}
        />
        <TeamViews store={store} view={view} act={act} groupUnread={groupUnread} />
      </header>
      {underHeader}
      <div className={'office-layout ' + (view.shared ? 'shared-open' : '')}>
        {view.shared && (
          <SharedDrawer
            width={assetWidth}
            savedWidth={store.preferences?.assetDrawerWidth ?? 320}
            settingsRevision={store.revision}
            onResize={onAssetResize}
            onClose={() => void act('view.shared', { enabled: false })}
          />
        )}
        {children}
      </div>

      {initializing && <EmployeeInitialization employee={initializing} onClose={() => void act('view.close')} />}
      {view.kind === 'settings' && (
        <SettingsPanel
          backLabel={returnLabel}
          initialView={presentationForView(view)}
          value={mergePreferences(store.preferences)}
          onSave={(value) => act('settings.set', value, true)}
          onClose={() => void act('view.close')}
        />
      )}
      {cloning && (
        <div
          className="office-panel-wrap"
          onKeyDown={(e) => {
            if (e.key === 'Escape') void act('view.close')
          }}
        >
          <div className="panel-backdrop" onClick={() => void act('view.close')} />
          <section className="office-panel employee-clone-panel" role="dialog" aria-modal="true" aria-label={uiText('Clone employee')}>
            <header className="employee-subpage-header">
              <BackButton ariaLabel="Close panel" onClick={() => void act('view.close')} />
              <h2>{uiText('Clone employee')}</h2>
              <span />
            </header>
            <div className="profile-scroll profile-edit">
              <CloneEmployeeForm source={cloning} onCreated={() => void act('view.close')} />
            </div>
          </section>
        </div>
      )}
      {panel?.card && (
        <div className="office-panel-wrap">
          <div className="panel-backdrop" />
          <section className="office-panel employee-profile-panel" role="dialog" aria-modal="true" aria-label={uiText('Employee details')}>
            <EmployeeProfile
              key={panel.card.id}
              employee={panel.card}
              store={store}
              onBack={() => void act('view.close')}
              backLabel={returnLabel}
              onWorkspace={() => void act('view.open', { kind: 'conversation', employee: panel.card!.id })}
            />
          </section>
        </div>
      )}
      {panel && !panel.card && (
        <div
          className="office-panel-wrap"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation()
              void setPanel(null)
            }
          }}
        >
          <div className="panel-backdrop" onClick={() => void setPanel(null)} />
          <section className="office-panel creation-panel" role="dialog" aria-modal="true" aria-label={uiText('Create employee')}>
            <header className="panel-header">
              <div>
                <h2>{uiText('Create employee')}</h2>
              </div>
              <button className="panel-close" onClick={() => void setPanel(null)} aria-label={uiText('Close panel')}>
                ×
              </button>
            </header>
            {discardForm && (
              <div className="creation-discard" role="alert">
                <p>{uiText('Discard unsaved form changes?')}</p>
                <button type="button" onClick={() => setDiscardForm(false)}>
                  {uiText('Keep editing')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    formExit.current.done = true
                    setDiscardForm(false)
                    void setPanel(null)
                  }}
                >
                  {uiText('Discard changes')}
                </button>
              </div>
            )}
            <EmployeeForm
              inert={discardForm}
              onDirtyChange={(value) => {
                formExit.current.dirty = value
              }}
              onSavingChange={(value) => {
                formExit.current.saving = value
              }}
              onCancel={() => {
                formExit.current.done = true
                void setPanel(null)
              }}
              template={lastEmployee}
              onSave={async (fields) => {
                const patch = { ...fields, title: fields.title.trim() }
                const signature = JSON.stringify(patch)
                if (signature !== creationAttempt.current.signature)
                  creationAttempt.current = { ...creationAttempt.current, signature, id: crypto.randomUUID() }
                const created = await api.call<StoredSession>('card.create', {
                  ...patch,
                  clientRequestId: creationAttempt.current.id,
                })
                if (created) {
                  formExit.current.done = true
                  await act(
                    'view.open',
                    employeeReady(created)
                      ? { kind: 'messages', employee: created.id }
                      : { kind: 'initialization', employee: created.id },
                  )
                }
                return !!created
              }}
            />
          </section>
        </div>
      )}
    </div>
  )
})
