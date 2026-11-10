import {join} from 'node:path'
import {APP_HOME} from '../shared/protocol'
import type {ViewState} from '../shared/view'
import {atomicJson,readJson} from './atomic-file'
import {currentClientId} from './request-context'
type MessageLocation=Pick<ViewState,'employee'|'chatId'|'channelId'|'sourceId'>&{kind:'messages'}
const views=new Map<string,ViewState>(),messageFile=join(APP_HOME,'message-navigation.json'),teamFile=join(APP_HOME,'team-navigation.json'),missionFile=join(APP_HOME,'mission-navigation.json')
type MissionLocation=Pick<ViewState,'planViewId'>
// Old Engineering/Research selections are ignored; their saved database layout remains usable.
const missions=()=>readJson<Record<string,MissionLocation>>(missionFile,()=>({}),value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every((view:any)=>view&&typeof view==='object'&&!Array.isArray(view)&&(view.planViewId===undefined||typeof view.planViewId==='string')))
const teamTabs=()=>readJson<Record<string,ViewState['teamTab']>>(teamFile,()=>({}),value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(tab=>tab==='characters'||tab==='board'||tab==='workers'))
const messages=()=>readJson<Record<string,MessageLocation>>(messageFile,()=>({}),value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(view=>view?.kind==='messages'&&['employee','chatId','channelId','sourceId'].every(key=>view[key]===undefined||typeof view[key]==='string')))
const listeners=new Set<(state:ViewState,clientId:string)=>void>()
export const getView=():ViewState=>{const id=currentClientId()??'desktop';return views.get(id)??{kind:'home',teamTab:teamTabs()[id]??'characters',...missions()[id],missionTab:'plan',missionNavigationOpen:false,planNavigationOpen:false,revision:0}}
export const getMessagesView=():Omit<ViewState,'revision'>=>messages()[currentClientId()??'desktop']??{kind:'messages'}
export function setView(next:Omit<ViewState,'revision'>):ViewState{
  const id=currentClientId()??'desktop',before=getView(),value:ViewState={shared:before.shared,teamTab:before.teamTab,missionTab:before.missionTab,planViewId:before.planViewId,teamNavigationOpen:before.teamNavigationOpen,missionNavigationOpen:before.missionNavigationOpen,planNavigationOpen:before.planNavigationOpen,...next,revision:before.revision+1}
  if(next.kind!==before.kind){value.teamNavigationOpen=false;value.missionNavigationOpen=false;value.planNavigationOpen=false}
  value.missionTab='plan';value.missionNavigationOpen=false;value.planNavigationOpen=false
  if(value.teamTab!==before.teamTab)atomicJson(teamFile,{...teamTabs(),[id]:value.teamTab},true)
  if(value.planViewId!==before.planViewId)atomicJson(missionFile,{...missions(),[id]:{planViewId:value.planViewId}},true)
  if(value.kind==='messages'){
    const saved=messages();saved[id]={kind:'messages',employee:value.employee,chatId:value.chatId,channelId:value.channelId,sourceId:value.sourceId};atomicJson(messageFile,saved,true)
  }
  views.set(id,value)
  for(const listener of listeners)listener(value,id)
  return value
}
export function onViewChange(listener:(state:ViewState,clientId:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
