/** Presentation modes share the same employees, histories, receipts and Core APIs. */
export const APP_VIEWS = [
  {id:'company', label:'Team', icon:'organization', kind:'home', defaultTeamView:'all'},
  {id:'messages', label:'Message', icon:'comment-discussion', kind:'messages'},
  {id:'plan', label:'Mission', icon:'calendar', kind:'plan'}
] as const
export type AppViewId = typeof APP_VIEWS[number]['id']
export const appView = (id:unknown) => APP_VIEWS.find(view=>view.id===id)
