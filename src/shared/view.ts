/** Navigation belongs to the CLI service, even when no desktop is attached. */
export type ViewState = {
  kind: 'library' | 'messages' | 'plan' | 'employee' | 'conversation' | 'initialization' | 'settings' | 'plugin' | 'clone'
  revision: number
  librarySection?: 'overview' | 'files' | 'search' | 'reader' | 'hosts'
  readerWorkspace?: string
  readerDocumentId?: string
  libraryHostId?: string
  libraryQuery?: string
  /** Legacy alias: Mission now opens its database directly. */
  missionTab?: 'plan'
  /** Legacy compatibility fields; Mission layouts are always visible. */
  missionNavigationOpen?: boolean
  planNavigationOpen?: boolean
  name?: string
  pluginId?: string
  employee?: string
  chatId?: string
  channelId?: string
  sourceId?: string
  planViewId?: string
  tools?:'skills'|'mcp'|'account'|'usage'|'config'|'export'|'background'
  settings?: string
  details?: boolean
  shared?: boolean
  /** Return from an existing workbench or editor to its originating view. */
  returnTo?: {kind:'library';librarySection?:ViewState['librarySection']}|{kind:'messages';employee?:string;chatId?:string;channelId?:string;sourceId?:string}|{kind:'plan';planViewId?:string;missionTab?:ViewState['missionTab']}
}
