import { isEngine } from '../shared/engines'
import { storeChanges, type StoreChanges } from '../shared/store-changes'
import { hasGlobalRole, managementRelations, assertManagementKind } from '../shared/management'
import { cloudHostTarget } from './cloud-hosts'
import { remoteTarget } from '../shared/remote'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { validateMessageWallpaper } from '../shared/message-wallpaper'
import { DEFAULT_PREFERENCES, THEMES, LANGUAGES, SIDEBAR_MIN, SIDEBAR_MAX, normalizedSidebarWidth, mergePreferences, PRESENTATION_VIEWS, type Preferences, type PreferencesPatch } from '../shared/preferences'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { employeeSettings, nativeSessionRefs, type Store, type StoredSession, type TeamSettings } from '../shared/types'
import { AVATARS, ACCESSORIES } from '../shared/office'
import { APP_HOME } from '../shared/protocol'
import { applicationRoot } from './resources'
import { inside } from './workspaces'

// The app's own record of which sessions it created and their centralized workspaces.
// Kept separate from anything the engines persist, so sessions started in an editor
// never show up here.

const ROOT = process.env.AGENTS_COMPANY_HOME || join(homedir(), 'AgentsCompany')
const FILE = join(ROOT, 'sessions.json')

export type { Engine, StoredSession, Store } from '../shared/types'

function canonicalPath(value: string): string {
  return existsSync(value) ? realpathSync(value) : resolve(value)
}

function hydrateSession(rawCard: Record<string, any>, rawTeamSettings: Record<string, TeamSettings>): StoredSession {
  const legacy = typeof rawCard?.group === 'string' ? rawTeamSettings[rawCard.group] : undefined
  const mode: 'local' | 'cloud' | 'work' =
    rawCard?.workspaceMode ??
    (rawCard?.hostId || rawCard?.remote || rawCard?.kind === 'cloud-native-worker' || (legacy?.mode === 'cloud' && rawCard?.workEnvironment !== 'local')
      ? 'cloud'
      : legacy?.mode === 'work'
        ? 'work'
        : 'local')
  const hostId: string | undefined = rawCard?.hostId ?? (mode === 'cloud' ? legacy?.hostId : undefined)
  const remoteRoot: string | undefined =
    rawCard?.remoteRoot ??
    (mode === 'cloud' ? (rawCard?.remote?.directory ?? legacy?.directory ?? legacy?.remote?.directory ?? rawCard?.cwd) : undefined)
  const pluginId: string | undefined = rawCard?.pluginId ?? (mode === 'work' ? legacy?.pluginId : undefined)
  let remote = rawCard?.remote
  if (mode === 'cloud') {
    if (hostId) {
      try {
        remote = cloudHostTarget(hostId, remoteRoot ?? rawCard?.cwd)
      } catch {
        remote = undefined
      }
    } else if (remote) {
      try {
        remote = remoteTarget(remote)
      } catch {
        remote = undefined
      }
    }
  } else {
    remote = undefined
  }
  const {
    group: _group,
    workEnvironment: _workEnvironment,
    localWorkspaceRoot: _localWorkspaceRoot,
    seat: _seat,
    seatNumber: _seatNumber,
    position: _position,
    orderIndex: _orderIndex,
    ...rest
  } = rawCard
  return {
    ...(rest as StoredSession),
    workspaceMode: mode,
    ...(hostId ? { hostId } : {}),
    ...(remoteRoot ? { remoteRoot } : {}),
    ...(pluginId ? { pluginId } : {}),
    ...(remote ? { remote } : { remote: undefined }),
  }
}

export function readStore(): Store {
  try {
    if (!existsSync(FILE)) return { sessions: [] }
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    const rawTeamSettings =
      raw.teamSettings && typeof raw.teamSettings === 'object' ? (raw.teamSettings as Record<string, TeamSettings>) : {}
    const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).map((card: Record<string, any>) =>
      hydrateSession(card, rawTeamSettings),
    )
    const rawTemplate =
      raw.lastEmployeeTemplate && typeof raw.lastEmployeeTemplate === 'object'
        ? (() => {
            const { group: _g, workEnvironment: _w, ...templateRest } = raw.lastEmployeeTemplate
            return templateRest as Partial<StoredSession>
          })()
        : undefined
    return {
      revision: raw.revision ?? 0,
      avatarCatalog: raw.avatarCatalog,
      fullAccessDefaultApplied: raw.fullAccessDefaultApplied,
      access: raw.access,
      lastEmployeeTemplate: rawTemplate,
      employeeCreations: raw.employeeCreations,
      sessions,
      preferences: {
        ...mergePreferences(raw.preferences),
        defaultPermissionMode:
          raw.preferences?.defaultPermissionMode ?? (raw.fullAccessDefaultApplied ? 'bypassPermissions' : 'default'),
        sidebarWidth: normalizedSidebarWidth(raw.preferences?.sidebarWidth),
      },
    }
  } catch (error) {
    throw new Error('Store is unreadable; operations stopped: ' + (error as Error).message)
  }
}

/**
 * Observers are told whenever the store changes. The GUI relies on this: a
 * session created by the CLI must appear without a reload.
 */
type StoreListener = (store: Store, changes: StoreChanges) => void
const listeners = new Set<StoreListener>()

export function onStoreChange(fn: StoreListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function writeStore(store: Store): void {
  mkdirSync(ROOT, { recursive: true })
  const current = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : undefined
  if ((current?.revision ?? 0) !== (store.revision ?? 0))
    throw new Error('State changed during operation; retry against the current state')
  for (const card of store.sessions) {
    assertManagementKind(card, hasGlobalRole(store.access, card), employeeSettings(store, card).mode === 'cloud')
  }
  if (store.access) {
    const cards = new Map(store.sessions.map((card) => [card.id, card]))
    if (store.access.bindings)
      store.access.bindings = store.access.bindings.filter(
        (edge) => cards.has(edge.managerId) && cards.has(edge.employeeId),
      )
    store.access.relations = managementRelations(store.sessions, store.access.bindings)
    if (store.access.version === 2) {
      delete store.access.managerTeam
      store.access.globalManagerIds = []
    } else store.access.globalManagerIds = store.access.globalManagerIds.filter((id) => cards.has(id) && !cards.get(id)!.deleting)
    const principals = (cards: StoredSession[]) =>
      cards.map((card) => ({ id: card.id, role: card.managementRole ?? 'employee', deleting: card.deleting ?? false }))
    if (store.access.version === 2) {
      const globalIds = new Set(store.sessions.filter((card) => hasGlobalRole(store.access, card)).map((card) => card.id))
      store.access.globalGrants = Object.fromEntries(
        Object.entries(store.access.globalGrants ?? {}).filter(([id]) => globalIds.has(id)),
      )
      for (const id of globalIds) store.access.globalGrants[id] ??= randomUUID()
    }
    const before = { ...current?.access, revision: 0, principals: principals(current?.sessions ?? []) }
    const after = { ...store.access, revision: 0, principals: principals(store.sessions) }
    store.access.revision = (current?.access?.revision ?? 0) + (JSON.stringify(before) !== JSON.stringify(after) ? 1 : 0)
  }
  if (store.employeeCreations) {
    const ids = new Set(store.sessions.map((card) => card.id))
    store.employeeCreations = Object.fromEntries(Object.entries(store.employeeCreations).filter(([id]) => ids.has(id)))
  }
  store.revision = (current?.revision ?? 0) + 1
  const saved: Store = {
    ...store,
    sessions: store.sessions.map((card) => (card.hostId ? { ...card, remote: undefined } : card)),
  }
  const temporary = FILE + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, FILE)
  const changes = storeChanges(current, saved)
  for (const listener of listeners) {
    try {
      listener(store, changes)
    } catch (error) {
      console.error('Store listener:', error)
    }
  }
}

export function updateStore(change: (store: Store) => void): Store {
  const store = readStore()
  change(store)
  writeStore(store)
  return store
}

/** Retain the legacy marker without rewriting any employee permission. */
export function migrateEmployeePermissionDefaults() {
  const store = readStore()
  if (store.fullAccessDefaultApplied) return
  store.preferences = {
    ...getPreferences(),
    defaultPermissionMode: store.sessions.length
      ? (store.preferences?.defaultPermissionMode ?? 'bypassPermissions')
      : 'default',
  }
  store.fullAccessDefaultApplied = true
  writeStore(store)
}

export function storePath(): string {
  return FILE
}

export function patchSession(
  id: string,
  patch: Partial<StoredSession>,
  creation?: NonNullable<Store['employeeCreations']>[string],
): Store {
  const store = readStore()
  const at = store.sessions.findIndex((s) => s.id === id)
  if (at < 0) {
    const card = { ...(patch as StoredSession), id }
    store.sessions.push(card)
    store.lastEmployeeTemplate = {
      engine: card.engine,
      kind: card.kind,
      workspaceMode: card.workspaceMode,
      hostId: card.hostId,
      remoteRoot: card.remoteRoot,
      folderName: card.folderName,
      directoryMode: card.directoryMode,
      avatar: card.avatar,
      accessory: card.accessory,
      color: card.color,
      role: card.role,
      model: card.model,
      effort: card.effort,
      permissionMode: card.permissionMode,
      thinking: card.thinking,
      planMode: card.planMode,
      fastMode: card.fastMode,
      managementRole: card.managementRole,
    }
  } else {
    const previous = store.sessions[at]
    employeeFields(patch, previous)
    const next = {
      ...previous,
      ...patch,
      managementRole: previous.managementRole,
      createdBy: previous.createdBy,
      accessMode: previous.accessMode,
      deleting: previous.deleting,
    }
    next.nativeSessions = nativeSessionRefs({
      ...next,
      nativeSessions: [...nativeSessionRefs(previous), ...(patch.nativeSessions ?? [])],
    })
    store.sessions[at] = next
  }
  if (creation) store.employeeCreations = { ...store.employeeCreations, [id]: creation }
  writeStore(store)
  return store
}

export function removeSession(id: string | string[]): Store {
  const store = readStore()
  const ids = new Set(Array.isArray(id) ? id : [id])
  store.sessions = store.sessions.filter((s) => !ids.has(s.id))
  writeStore(store)
  return store
}

export function employeeFields(patch: Partial<StoredSession>, employee?: StoredSession): Partial<StoredSession> {
  if (patch.engine !== undefined && !isEngine(patch.engine)) throw new Error('Unknown engine')
  if (employee && patch.engine !== undefined && patch.engine !== employee.engine)
    throw new Error('员工引擎创建后固定；如需使用其他引擎，请删除员工后重新添加')
  if (patch.avatar !== undefined && !AVATARS.includes(patch.avatar)) throw new Error('Unknown avatar')
  if (patch.accessory !== undefined && !ACCESSORIES.includes(patch.accessory)) throw new Error('Unknown accessory')
  if (patch.color !== undefined && !/^#[\da-f]{6}$/i.test(patch.color)) throw new Error('Color must be a hex color')
  if (patch.title !== undefined && !String(patch.title).trim()) throw new Error('会话名称不能为空')
  const fields: Partial<StoredSession> = {}
  for (const key of ['title', 'role', 'avatar', 'accessory', 'color'] as const) {
    if (patch[key] !== undefined) Object.assign(fields, { [key]: patch[key] })
  }
  if (fields.title !== undefined) fields.title = String(fields.title).trim()
  return fields
}

export function updateEmployee(id: string, patch: Partial<StoredSession>): Store {
  const employee = readStore().sessions.find((c) => c.id === id)
  if (!employee) throw new Error(`no such card ${id}`)
  if (patch.cwd !== undefined && patch.cwd !== employee.cwd) throw new Error('员工工作目录创建后不能更换')
  if (patch.hostId !== undefined && patch.hostId !== employee.hostId) throw new Error('员工宿主创建后不能更换')
  if (patch.folderName !== undefined && patch.folderName !== employee.folderName)
    throw new Error('员工工作目录名创建后不能更换')
  const fields = employeeFields(patch, employee)
  return patchSession(id, fields)
}

export function getPreferences(): Preferences {
  return readStore().preferences ?? mergePreferences()
}

export function setPreferences(patch: PreferencesPatch): Preferences {
  for (const key of Object.keys(patch)) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) throw Error('Unknown preference: ' + key)
  }
  if (patch.messageWallpaper !== undefined) validateMessageWallpaper(patch.messageWallpaper)
  const appearance = patch.viewAppearance
  if (appearance !== undefined) {
    if (
      !appearance ||
      typeof appearance !== 'object' ||
      Array.isArray(appearance) ||
      Object.keys(appearance).some((view) => !PRESENTATION_VIEWS.includes(view as any))
    )
      throw Error('Choose Library, Messages or Plan appearance')
    for (const change of Object.values(appearance)) {
      if (
        !change ||
        typeof change !== 'object' ||
        Array.isArray(change) ||
        Object.keys(change).some((key) => !['theme', 'themeColor'].includes(key))
      )
        throw Error('View appearance accepts theme and themeColor')
    }
  }
  const value = mergePreferences(getPreferences(), patch)
  if (!['default', 'acceptEdits', 'bypassPermissions'].includes(value.defaultPermissionMode))
    throw Error('Invalid default engine permission')
  if (typeof value.employeeWorkspacesRoot !== 'string')
    throw new Error('Unified workspaces root must be a path string')
  value.employeeWorkspacesRoot = value.employeeWorkspacesRoot.trim()
  if (value.employeeWorkspacesRoot) {
    if (!isAbsolute(value.employeeWorkspacesRoot))
      throw new Error('统一工作空间根目录必须是绝对路径')
    const candidate = canonicalPath(value.employeeWorkspacesRoot)
    const appHome = canonicalPath(APP_HOME)
    const sourceRoot = canonicalPath(applicationRoot())
    if (candidate === appHome || inside(appHome, candidate))
      throw new Error('统一工作空间根目录不能设在系统数据目录中')
    if (candidate === sourceRoot || inside(sourceRoot, candidate))
      throw new Error('统一工作空间根目录不能设在程序安装目录中')
  }
  if (!LANGUAGES.includes(value.language)) throw new Error('Interface language must be en or zh-CN')
  for (const chosen of [patch, ...Object.values(appearance ?? {}), ...Object.values(value.viewAppearance)]) {
    if (chosen.theme !== undefined && !THEMES.includes(chosen.theme)) throw Error('Unknown theme')
    if (
      chosen.themeColor !== undefined &&
      (typeof chosen.themeColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(chosen.themeColor))
    )
      throw Error('Theme color must be a six-digit hex color')
  }
  if (!Number.isFinite(value.sidebarWidth) || value.sidebarWidth < SIDEBAR_MIN || value.sidebarWidth > SIDEBAR_MAX)
    throw new Error('Icon sidebar width must be between 56 and 96')
  if (!Number.isFinite(value.pageZoom) || value.pageZoom < 0.75 || value.pageZoom > 1.5)
    throw new Error('Page zoom must be between 0.75 and 1.5')
  if (!Number.isFinite(value.explorerWidth) || value.explorerWidth < 140 || value.explorerWidth > 520)
    throw new Error('Explorer width must be between 140 and 520')
  if (!Number.isFinite(value.assetDrawerWidth) || value.assetDrawerWidth < 260 || value.assetDrawerWidth > 600)
    throw new Error('Files drawer width must be between 260 and 600')
  if (!Number.isFinite(value.terminalHeight) || value.terminalHeight < 120 || value.terminalHeight > 600)
    throw new Error('Terminal height must be between 120 and 600')
  for (const key of ['explorerCollapsed', 'explorerTreeCollapsed'] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(key + ' must be boolean')
  }
  for (const key of ['defaultCodexModel', 'defaultClaudeModel', 'defaultClineModel', 'defaultPiModel'] as const) {
    if (typeof value[key] !== 'string') throw new Error(key + ' must be a model ID')
    value[key] = value[key].trim()
  }
  const store = readStore()
  store.preferences = value
  writeStore(store)
  return value
}
