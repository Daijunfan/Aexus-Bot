import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {useEffect,useState} from 'react'
import {api} from '../api'
import {createRefreshQueue} from '../snapshot'
import {useMessenger} from './useMessenger'
import {Icon} from './Icon'
import {plainMessagePreview,type MessengerResults} from '../../../shared/messenger'

export function PinnedMessages({conversation}:{conversation:string}){return <MessageCollectionStrip key={conversation} conversation={conversation} filter="pinned"/>}
export function SavedMessages({conversation}:{conversation:string}){return <MessageCollectionStrip key={conversation} conversation={conversation} filter="saved"/>}

function MessageCollectionStrip({conversation,filter}:{conversation:string;filter:'pinned'|'saved'}){
  useI18n()

 const messenger=useMessenger()!,[result,setResult]=useState<MessengerResults|null>(null),[error,setError]=useState('')
 const sharedGroup=filter==='pinned'&&conversation.startsWith('group:')
 const pins=Object.entries(messenger.state.messages).filter(([key,value])=>key.startsWith(conversation+'/')&&value[filter]&&!value.hidden).map(([key])=>key).join('\n')
 useEffect(()=>{let alive=true,version=0;if(!pins&&!sharedGroup){setResult(null);return}
  const refresh=createRefreshQueue(async()=>{if(!alive)return;const current=version;try{const value=await api.call<MessengerResults>('messenger.search',{conversation,filter,limit:1});if(alive&&current===version){setResult(value);setError('')}}catch(cause){if(alive&&current===version)setError((cause as Error).message)}})
  void refresh();const off=api.onEvent(event=>{if(event.channel==='chat:changed'&&conversation==='group:'+event.payload.id&&event.payload.editedMessageId||event.channel==='direct:changed'&&conversation==='employee:'+event.payload.employee){version++;void refresh()}})
  return()=>{alive=false;off()}
 },[conversation,pins,filter])
 if(!pins&&!sharedGroup)return null
 if(error)return <div className="message-pin-strip" data-message-collection={filter} role="alert">{error}</div>
 const message=result?.messages[0];if(!message)return null
 return <div className="message-pin-strip" data-message-collection={filter}><Icon name={filter==='saved'?'bookmark':'pinned'}/><button className="message-pin-preview" aria-label={uiText(filter==='saved'?"Go to saved message":"Go to pinned message")} onClick={()=>messenger.setJump({conversation,id:message.id})}><strong>{uiText(filter==='saved'?"Saved message":"Pinned message")}{result!.total>1?` · ${result!.total}`:''}</strong><span>{plainMessagePreview(message.text)||uiText("Photo")}</span></button><button className="message-pin-all" aria-label={uiText(filter==='saved'?"Show saved messages":"Show pinned messages")} title={uiText(filter==='saved'?"Show saved messages":"Show pinned messages")} onClick={()=>messenger.setLibrary({conversation,filter})}><Icon name="list-selection"/></button></div>
}
