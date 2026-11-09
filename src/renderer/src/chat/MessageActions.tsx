import {api} from '../api'
import {EmojiPicker} from './EmojiPicker'
import {translate as uiText,useI18n,interfaceLocale} from '../i18n'
import {useEffect,useMemo,useRef,useState} from 'react'
import {useMessageOwner} from './MessageViewport'
import {MessageMenu,messageContextAnchor} from '../components/MessageMenu'
import {useMessenger} from '../components/useMessenger'
import {messageKey,MESSAGE_REACTIONS,type MessagePreferences} from '../../../shared/messenger'
import {Icon} from '../components/Icon'
import {emojiCount} from './messagePresentation'
import {useMessageExpression,type ReactionAcknowledgement} from './messageExpressionMotion'
import {useMessageCopy} from './useMessageCopy'

export function MessageActions({text,onReply,onEdit,onPrivate,onThread,onRemove,protectedContent=false,sharedGroup,reactions=[],sharedPinned,conversation,id,images=0}:{images?:number;text:string;onReply?:()=>void;onEdit?:()=>void;onPrivate?:()=>void;onThread?:()=>void;onRemove?:()=>void;protectedContent?:boolean;sharedGroup?:string;sharedPinned?:boolean;reactions?:{emoji:string;count:number;names:string[];my:boolean}[];conversation?:string;id?:string}){
  useI18n()

  const [reactionError,setReactionError]=useState(''),[emojiMenu,setEmojiMenu]=useState<{x:number;y:number}|null>(null)
  const messenger=useMessenger(),root=useRef<HTMLDivElement>(null),clipboard=useMessageCopy(text),status=clipboard.status,[menu,setMenu]=useState<{x:number;y:number;originX?:number;originY?:number}|null>(null),[acknowledgement,setAcknowledgement]=useState<ReactionAcknowledgement|null>(null)
  useMessageOwner(!!menu)
  const preferences=conversation&&id?messenger?.state.messages[messageKey(conversation,id)]??{}:{}
  const currentReaction=sharedGroup?reactions.find(reaction=>reaction.my)?.emoji:preferences.reaction,pinned=sharedPinned||preferences.pinned
  const replay=useMessageExpression(root,currentReaction,acknowledgement),isEmoji=useMemo(()=>images===0&&!!emojiCount(text),[text,images])
  useEffect(()=>{const el=root.current?.closest('.bubble,[data-chat-item]');if(!conversation||!id||!el)return;const open=(event:Event)=>{event.preventDefault();event.stopPropagation();setMenu(messageContextAnchor(event as MouseEvent))};el.addEventListener('contextmenu',open);return()=>el.removeEventListener('contextmenu',open)},[conversation,id])
  const change=(patch:MessagePreferences,from?:DOMRect)=>{if(conversation&&id)void (async()=>{if(sharedGroup&&patch.pinned!==undefined)await api.call('chat.pin',{id:sharedGroup,messageId:id,pinned:patch.pinned});return messenger?.message(conversation,id,patch)})().then(ok=>{if(!ok||!root.current?.isConnected)return;setMenu(null);if(patch.reaction&&from)setAcknowledgement({emoji:patch.reaction,from})}).catch(cause=>setReactionError(cause.message))}
  const react=(emoji:string,from?:DOMRect)=>{if(!sharedGroup){change({reaction:preferences.reaction===emoji?'':emoji},from);return}void api.call('chat.react',{id:sharedGroup,messageId:id,emoji,selected:!reactions.some(value=>value.emoji===emoji&&value.my)}).then(()=>{setMenu(null);setEmojiMenu(null);setReactionError('');if(from)setAcknowledgement({emoji,from})}).catch(cause=>setReactionError(cause.message))}
  const copy=async()=>{if(await clipboard.copy())setMenu(null)}
  const forward=()=>{if(conversation&&id)messenger?.setForward({messages:[{conversation,id}],text,images});setMenu(null)}
  if(!text.trim()&&!conversation)return null
  return <>
    <div ref={root} className="message-actions"><button className="message-options-trigger" aria-label={uiText('Message options')} title={uiText('Message options')} aria-haspopup="menu" aria-expanded={!!menu} onClick={event=>{event.stopPropagation();const bounds=event.currentTarget.getBoundingClientRect();setMenu({x:bounds.right,y:bounds.bottom})}}><Icon name="ellipsis"/></button></div>
    {(reactions.length||preferences.reaction||preferences.saved||pinned)&&<div className="message-annotations">{sharedGroup?reactions.map(reaction=><button key={reaction.emoji} className="message-reaction" data-selected={reaction.my} aria-pressed={reaction.my} title={reaction.names.join(' · ')} aria-label={uiText("React {0}",[reaction.emoji])} onClick={event=>react(reaction.emoji,event.currentTarget.getBoundingClientRect())}>{reaction.emoji}<span>{reaction.count}</span></button>):preferences.reaction&&<button className="message-reaction" aria-label={uiText("Remove reaction {0}",[preferences.reaction])} onClick={()=>change({reaction:''})}>{preferences.reaction}<span>1</span></button>}{preferences.saved&&<span title={uiText("Saved message")}><Icon name="bookmark"/></span>}{pinned&&<button onClick={()=>messenger?.setLibrary({conversation,filter:'pinned'})}><Icon name="pinned"/>  {uiText("Pinned")}</button>}</div>}
    {reactionError&&<p className="group-card-error" role="alert">{uiText(reactionError)}<button onClick={()=>setReactionError('')}>{uiText('Dismiss')}</button></p>}
    {emojiMenu&&<EmojiPicker anchor={emojiMenu} onClose={()=>setEmojiMenu(null)} onSelect={emoji=>react(emoji)}/>}
    {menu&&<MessageMenu anchor={menu} label={uiText("Message options")} onClose={()=>setMenu(null)}>
      <div className="message-reaction-picker" aria-label={uiText("React to message")}>{MESSAGE_REACTIONS.map(reaction=><button key={reaction} role="menuitemradio" aria-checked={sharedGroup?reactions.some(value=>value.emoji===reaction&&value.my):preferences.reaction===reaction} aria-label={uiText("React {0}",[reaction])} onClick={event=>react(reaction,event.currentTarget.getBoundingClientRect())}>{reaction}</button>)}{sharedGroup&&<button role="menuitem" aria-label={uiText("More reactions")} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setEmojiMenu({x:rect.left,y:rect.top-494});setMenu(null)}}><Icon name="add"/></button>}</div>
      {isEmoji&&!!root.current?.closest('[data-chat-item][data-emoji-count]')&&<button role="menuitem" onClick={()=>{setMenu(null);replay()}}><Icon name="play"/>{uiText('Replay emoji animation')}</button>}
      {onThread&&<button role="menuitem" onClick={()=>{setMenu(null);onThread()}}><Icon name="comment-discussion"/>{uiText("Open thread")}</button>}
      {onReply&&<button role="menuitem" onClick={()=>{setMenu(null);onReply()}}><Icon name="reply"/>{uiText("Reply")}</button>}
      {!protectedContent&&text.trim()&&<button role="menuitem" onClick={()=>void copy()}><Icon name="copy"/>{uiText(status&&status!=='Copied'?status:"Copy text")}</button>}
      {onPrivate&&<button role="menuitem" onClick={()=>{setMenu(null);onPrivate()}}><Icon name="account"/>{uiText("Open private chat")}</button>}
      {onEdit&&<button role="menuitem" onClick={()=>{setMenu(null);onEdit()}}><Icon name="edit"/>{uiText('Edit message')}</button>}
      {!protectedContent&&conversation&&id&&<button role="menuitem" onClick={forward}><Icon name="arrow-right"/>{uiText("Forward message")}</button>}
      {!protectedContent&&conversation&&id&&<button role="menuitem" onClick={()=>{messenger?.setReplyTarget({conversation,id,text,images});setMenu(null)}}><Icon name="reply"/>{uiText('Reply in another conversation')}</button>}
      <button role="menuitem" onClick={()=>change({saved:!preferences.saved})}><Icon name="bookmark"/>{preferences.saved?uiText("Remove from saved"):uiText("Save message")}</button>
      <button role="menuitem" onClick={()=>change({pinned:!pinned})}><Icon name="pinned"/>{pinned?uiText("Unpin message"):uiText("Pin message")}</button>
      {conversation&&id&&<button role="menuitem" onClick={()=>{messenger?.setSelection({conversation,ids:[id]});setMenu(null)}}><Icon name="checklist"/>{uiText("Select message")}</button>}
      {onRemove&&<button role="menuitem" className="danger" onClick={()=>{setMenu(null);onRemove()}}><Icon name="trash"/>{uiText("Remove for everyone")}</button>}
      <hr/><button role="menuitem" onClick={()=>change({hidden:true})}><Icon name="eye-closed"/>{uiText("Hide for me")}</button>
    </MessageMenu>}
  </>
}

export function MessageDate({value}:{value:number}){
  useI18n()

  const date=new Date(value),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1)
  const label=date.toDateString()===today.toDateString()?'Today':date.toDateString()===yesterday.toDateString()?'Yesterday':date.toLocaleDateString(interfaceLocale(),{month:'long',day:'numeric',...(date.getFullYear()!==today.getFullYear()?{year:'numeric' as const}:{})})
  return <div className="message-date"><time dateTime={date.toISOString()}>{uiText(label)}</time></div>
}
