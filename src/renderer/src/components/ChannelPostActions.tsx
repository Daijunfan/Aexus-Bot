import {useEffect,useRef,useState} from 'react'
import type {ChannelPost,ChannelSaveResult} from '../../../shared/channels'
import type {FileLocation} from '../../../shared/transfers'
import {MESSAGE_REACTIONS,messageKey} from '../../../shared/messenger'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {downloadBrowserFile} from '../web/files'
import {useMessageOwner} from '../chat/MessageViewport'
import {useMessageCopy} from '../chat/useMessageCopy'
import {MessageMenu,messageContextAnchor,selectedMessageText} from './MessageMenu'
import {useMessenger} from './useMessenger'
import {postPhotos} from './channel-post-model'
import {Icon} from './Icon'
import {useMessageExpression,type ReactionAcknowledgement} from '../chat/messageExpressionMotion'

/** Cards and full articles share the same context actions and canonical content. */
export function ChannelPostActions({post,onChanged,onAuthor,onReply,onReveal}:{post:ChannelPost;onChanged:(post:ChannelPost|null)=>void;onAuthor:(sourceId:string)=>void;onReply?:()=>void;onReveal?:()=>void}){
 const root=useRef<HTMLDivElement>(null),alive=useRef(true),messenger=useMessenger(),clipboard=useMessageCopy('')
 const [menu,setMenu]=useState<ReturnType<typeof messageContextAnchor>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selectedCopy,setSelectedCopy]=useState<string|undefined>(),[acknowledgement,setAcknowledgement]=useState<ReactionAcknowledgement|null>(null)
 const conversation='channel:'+post.channelId,reaction=messenger?.state.messages[messageKey(conversation,post.id)]?.reaction,owner=menu?root.current?.closest<HTMLElement>('article'):null
 const hasText=!!(post.title?.trim()||post.body.trim()||post.bodyTruncated),hasAttachments=!!(post.files?.length||postPhotos(post).length)
 useMessageExpression(root,reaction,acknowledgement)
 useMessageOwner(!!menu)
 useEffect(()=>{alive.current=true;const owner=root.current?.closest('article');if(!owner)return;const open=(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();setSelectedCopy(selectedMessageText(owner));setError('');setMenu(messageContextAnchor(event))};owner.addEventListener('contextmenu',open);return()=>{alive.current=false;owner.removeEventListener('contextmenu',open)}},[])
 const run=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await work();if(alive.current)setMenu(current=>current===menu?null:current)}catch(cause){if(alive.current)setError((cause as Error).message)}finally{if(alive.current)setBusy(false)}}
 const complete=()=>post.bodyTruncated?api.call<ChannelPost>('channel.post',{id:post.id}):Promise.resolve(post)
 const copy=()=>run(async()=>{const value=selectedCopy===undefined?await complete():undefined,text=value?[value.title,value.body].filter(Boolean).join('\n\n'):'';const content=selectedCopy??(text.trim()?text:[...(value!.files??[]).map(file=>file.name),...postPhotos(value!).map(photo=>photo.name)].join('\n'));if(!content||!await clipboard.copy(content))throw Error('Could not copy')})
 const forward=()=>run(async()=>{const value=await complete();messenger?.setForward({messages:[{conversation:'channel:'+post.channelId,id:post.id}],text:[value.title,value.body,value.url].filter(Boolean).join('\n\n'),images:postPhotos(value).length})})
 const save=()=>run(async()=>{const value=await api.call<ChannelSaveResult>('channel.save',{id:post.id,saved:!post.saved});onChanged('expired' in value?null:value)})
 const download=()=>run(async()=>{const value=await api.call<{download:FileLocation}>('channel.export',{id:post.id});if(api.mode==='web')downloadBrowserFile(value.download);else await api.call('transfer.download-save',{from:value.download})})
 const react=(emoji:string,from?:DOMRect)=>run(async()=>{const next=reaction===emoji?'':emoji;if(!await messenger?.message(conversation,post.id,{reaction:next}))throw Error('Update not confirmed. Check the current state before retrying.');if(next&&from&&alive.current)setAcknowledgement({emoji:next,from})})
 return <><div ref={root} hidden/>{reaction&&<div className="message-annotations channel-personal-reaction"><button disabled={busy} className="message-reaction" data-emoji={reaction} aria-label={uiText('Remove reaction {0}',[reaction])} title={uiText('Personal reaction in Aexus')} onClick={()=>void react(reaction)}>{reaction}<span>{uiText('Your reaction')}</span></button></div>}{error&&!menu&&<p className="channel-inline-error" role="alert">{uiText(error)}</p>}
  {menu&&<MessageMenu anchor={menu} owner={owner} busy={busy} label={uiText('Article actions')} onClose={()=>setMenu(null)}>
   {messenger&&<div className="message-reaction-picker" role="group" aria-label={uiText('Your reaction')} title={uiText('Personal reaction in Aexus')}>{MESSAGE_REACTIONS.map(emoji=><button key={emoji} disabled={busy} role="menuitemradio" aria-checked={reaction===emoji} aria-label={uiText('React {0}',[emoji])} onClick={event=>void react(emoji,event.currentTarget.getBoundingClientRect())}><span aria-hidden="true">{emoji}</span></button>)}</div>}
   {error&&<p className="message-menu-error" role="alert">{uiText(error)}</p>}
   {onReply&&<button role="menuitem" disabled={busy} onClick={()=>{setMenu(null);onReply()}}><Icon name="reply"/>{uiText('Reply')}</button>}
   {(selectedCopy||hasText||hasAttachments)&&<button role="menuitem" disabled={busy} onClick={()=>void copy()}><Icon name="copy"/>{uiText(selectedCopy?'Copy selected text':hasText?'Copy text':'Copy attachment names')}</button>}
   <button role="menuitem" disabled={!messenger||busy} onClick={()=>void forward()}><Icon name="arrow-right"/>{uiText('Forward message')}</button>
   <button role="menuitem" disabled={busy} onClick={()=>void save()}><Icon name="bookmark"/>{uiText(post.saved?'Remove from saved':'Save article')}</button>
   <button role="menuitem" disabled={busy} onClick={()=>void download()}><Icon name="desktop-download"/>{uiText('Download article and images')}</button>
   {post.url&&<button role="menuitem" disabled={busy} onClick={()=>void run(()=>api.call('external.open',{url:post.url}))}><Icon name="link"/>{uiText('Original')}</button>}
   {onReveal&&<button role="menuitem" disabled={busy} onClick={()=>{setMenu(null);onReveal()}}><Icon name="go-to-file"/>{uiText('Go to channel')}</button>}
   <button role="menuitem" disabled={busy} onClick={()=>{setMenu(null);onAuthor(post.sourceId)}}><Icon name="person"/>{uiText('Author information')}</button>
   <hr/><button role="menuitem" disabled={busy} onClick={()=>void run(async()=>{await api.call('channel.delete',{id:post.id});onChanged(null)})}><Icon name="trash"/>{uiText('Delete article')}</button>
  </MessageMenu>}
 </>
}
