import {translate as uiText,useI18n} from '../i18n'
import type {Store} from '../../../shared/types'
import type {ViewState} from '../../../shared/view'
import {APP_VIEWS} from '../../../shared/app-views'
import {presentationForView} from '../../../shared/preferences'
import {Icon} from './Icon'
import {useCatalog} from './useCatalog'
import {affectsInbox} from '../../../shared/store-changes'
import type {InboxEntry} from '../../../shared/messages'

type Action=(cmd:string,args?:Record<string,unknown>)=>Promise<any>
export function TeamViews({store,view,act,groupUnread=0}:{store:Store;view:ViewState;act:Action;groupUnread?:number}){
  useI18n()

  const activeMode=presentationForView(view)
  const {value:inbox}=useCatalog<InboxEntry>('session.inbox',true,event=>event.channel==='direct:changed'||event.channel==='store:changed'&&affectsInbox(event.payload),80)
  const unread=inbox.filter(entry=>entry.unread&&store.sessions.some(card=>card.id===entry.employeeId&&!card.deleting)).length+groupUnread
  return <nav className="company-navigation" aria-label={uiText("Main views")}>
    <button className={`app-view-button company-view-trigger ${activeMode==='company'?'active':''}`} title={'Team'} aria-label={'Team'} aria-pressed={activeMode==='company'} onClick={()=>void act('view.select',{id:'company'})}>
      <Icon name={APP_VIEWS[0].icon}/><span>{'Team'}</span>
    </button>
    {APP_VIEWS.filter(mode=>mode.id!=='company').map(mode=>{
      const text=mode.label
      return <button key={mode.id} className={`app-view-button ${mode.id}-view-trigger ${activeMode===mode.id?'active':''}`} aria-label={text} aria-pressed={activeMode===mode.id} onClick={()=>void act('view.select',{id:mode.id})}><Icon name={mode.icon}/><span>{text}</span>{mode.id==='messages'&&unread>0&&<b className="nav-unread" aria-label={uiText("{0} unread conversations",[unread])}>{unread}</b>}</button>
    })}
  </nav>
}
