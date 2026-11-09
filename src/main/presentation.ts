import {join} from 'node:path'
import {APP_HOME} from '../shared/protocol'
import type {ViewState} from '../shared/view'
import {atomicJson,readJson} from './atomic-file'
import {currentClientId} from './request-context'
type MessageLocation=Pick<ViewState,'employee'|'chatId'|'channelId'|'sourceId'>&{kind:'messages'}
const views=new Map<string,ViewState>(),messageFile=join(APP_HOME,'message-navigation.json'),teamFile=join(APP_HOME,'team-navigation.json')
const teamTabs=()=>readJson<Record<string,ViewState['teamTab']>>(teamFile,()=>({}),value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(tab=>tab==='characters'||tab==='board'||tab==='workers'))
const messages=()=>readJson<Record<string,MessageLocation>>(messageFile,()=>({}),value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(view=>view?.kind==='messages'&&['employee','chatId','channelId','sourceId'].every(key=>view[key]===undefined||typeof view[key]==='string')))
const listeners=new Set<(state:ViewState,clientId:string)=>void>()
export const getView=()=>views.get(currentClientId()??'desktop')??{kind:'home' as const,teamTab:teamTabs()[currentClientId()??'desktop']??'characters',revision:0}
export const getMessagesView=():Omit<ViewState,'revision'>=>messages()[currentClientId()??'desktop']??{kind:'messages'}
export function setView(next:Omit<ViewState,'revision'>):ViewState{
  const id=currentClientId()??'desktop',before=getView(),value={shared:before.shared,teamTab:before.teamTab,...next,revision:before.revision+1}
  if(value.teamTab!==before.teamTab)atomicJson(teamFile,{...teamTabs(),[id]:value.teamTab},true)
  if(value.kind==='messages'){
    const saved=messages();saved[id]={kind:'messages',employee:value.employee,chatId:value.chatId,channelId:value.channelId,sourceId:value.sourceId};atomicJson(messageFile,saved,true)
  }
  views.set(id,value)
  for(const listener of listeners)listener(value,id)
  return value
}
export function onViewChange(listener:(state:ViewState,clientId:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
