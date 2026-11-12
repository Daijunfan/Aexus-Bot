import {clientStore} from './client-state'
import {resolveTeamView} from '../shared/team-views'
import {readStore} from './store'

/** Capture at request acceptance, before session startup or queueing can await anything. */
export function taskViewId(employeeId:string,viewId?:string,scheduled=false){
  const store=readStore(),card=store.sessions.find(card=>card.id===employeeId)
  if(card?.managementRole!=='governor'){
    if(viewId!==undefined)throw Error('任务视图仅用于 Governor')
    return undefined
  }
  if(scheduled&&viewId===undefined)throw Error('Governor 定时任务必须指定 viewId / --view；不能使用执行时的当前视图')
  if(viewId!==undefined&&(typeof viewId!=='string'||!viewId))throw Error('viewId 必须是视图 ID')
  return resolveTeamView(clientStore(store),viewId).id
}
export function taskViewPrompt(viewId:string|undefined,text:string){
  if(viewId===undefined)return text
  const view=resolveTeamView(readStore(),viewId)
  return `[Aexus target view]\n${JSON.stringify({viewId:view.id,name:view.name,teams:view.teams,fixed:true})}\n\n${text}`
}
