import {useMessenger} from './useMessenger'
import {useEffect,useRef,useState} from 'react'
import type {NoticeReceipt} from '../../../shared/conversation-controls'
import {api} from '../api'
import {Icon} from './Icon'
import {translate as t,useI18n} from '../i18n'
import '../styles/conversation-controls.css'

export function ConversationNoticeBadge({notice}:{notice?:NoticeReceipt}){
 useI18n();return notice?<span className="conversation-notice-badge" data-static-notice={notice.noticeId} title={t('Automatic publication of saved text. No Agent task was executed.')}><Icon name={notice.silent?'bell-slash':'bell'}/>{t('Scheduled notice')}{notice.silent?' · '+t('Quiet'):''}</span>:null
}
/** Attention only. It never marks a message read or triggers work; silent notices raise no event. */
export function ConversationNoticeToast({currentConversation}:{currentConversation?:string}){
 useI18n();const messenger=useMessenger(),latest=useRef({messenger,currentConversation});latest.current={messenger,currentConversation};const [notice,setNotice]=useState<{conversation:string;name:string;messageId:string;text?:string;directedToUser?:boolean}|null>(null)
 useEffect(()=>api.onEvent(event=>{if(event.channel==='conversation:notification'){const value=event.payload,preferences=latest.current.messenger?.state.conversations[value.conversation]?.notifications??'all';if(value.conversation===latest.current.currentConversation||preferences==='off'||preferences==='direct'&&!value.directedToUser)return;setNotice(value)}}),[])
 useEffect(()=>{if(notice&&(notice.conversation===currentConversation||messenger?.state.conversations[notice.conversation]?.notifications==='off'))setNotice(null)},[currentConversation,messenger?.state.revision])
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),8000);return()=>clearTimeout(timer)},[notice])
 return notice?<aside className="conversation-notice-toast" role="status"><Icon name="bell"/><span><strong>{notice.name}</strong><small>{notice.text||t('A scheduled notice was posted.')}</small></span><button onClick={()=>{const current=notice;void api.call('view.open',{kind:'messages',chatId:current.conversation.slice(6)}).then(()=>{messenger?.setJump({conversation:current.conversation,id:current.messageId});setNotice(null)}).catch(cause=>setNotice({...current,text:t(cause.message)}))}}>{t('View message')}</button><button aria-label={t('Dismiss notification')} onClick={()=>setNotice(null)}><Icon name="close"/></button></aside>:null
}
