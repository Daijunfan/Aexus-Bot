import {api} from '../api'
import {EmojiPicker} from './EmojiPicker'
import {translate as uiText,useI18n,interfaceLocale} from '../i18n'
import {useEffect,useMemo,useRef,useState} from 'react'
import {useMessageOwner} from './MessageViewport'
import {MessageMenu,messageContextAnchor,selectedMessageText} from '../components/MessageMenu'
import {useMessenger} from '../components/useMessenger'
import {messageKey,MESSAGE_REACTIONS,type MessagePreferences} from '../../../shared/messenger'
import {Icon} from '../components/Icon'
import {emojiCount} from './messagePresentation'
import {useMessageExpression,type ReactionAcknowledgement} from './messageExpressionMotion'
import {useMessageCopy} from './useMessageCopy'

export function MessageActions({text,onReply,onEdit,onPrivate,onThread,onRemove,protectedContent=false,sharedGroup,reactions=[],sharedPinned,conversation,id,images=0}:{images?:number;text:string;onReply?:()=>void;onEdit?:()=>void;onPrivate?:()=>void;onThread?:()=>void;onRemove?:()=>void;protectedContent?:boolean;sharedGroup?:string;sharedPinned?:boolean;reactions?:{emoji:string;count:number;names:string[];my:boolean}[];conversation?:string;id?:string}){
  useI18n()

  const [reactionError,setReactionError]=useState(''),[emojiMenu,setEmojiMenu]=useState<ReturnType<typeof messageContextAnchor>|null>(null),[busy,setBusy]=useState(false),[selectedCopy,setSelectedCopy]=useState<string|undefined>()
  const messenger=useMessenger(),root=useRef<HTMLDivElement>(null),pending=useRef(false),alive=useRef(true),clipboard=useMessageCopy(text),status=clipboard.status,[menu,setMenu]=useState<ReturnType<typeof messageContextAnchor>|null>(null),[acknowledgement,setAcknowledgement]=useState<ReactionAcknowledgement|null>(null)
  useMessageOwner(!!menu||!!emojiMenu)
  const preferences=conversation&&id?messenger?.state.messages[messageKey(conversation,id)]??{}:{}
  const currentReaction=sharedGroup?(reactions.find(reaction=>reaction.my&&reaction.emoji===acknowledgement?.emoji)??reactions.find(reaction=>reaction.my))?.emoji:preferences.reaction,pinned=sharedPinned||preferences.pinned
  const owner=(menu||emojiMenu)?root.current?.closest<HTMLElement>('.bubble,[data-chat-item]'):null,trigger=root.current?.querySelector<HTMLButtonElement>('.message-options-trigger'),canAnnotate=!!(messenger&&conversation&&id)
  const replay=useMessageExpression(root,currentReaction,acknowledgement),isEmoji=useMemo(()=>images===0&&!!emojiCount(text),[text,images])
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{const el=root.current?.closest('.bubble,[data-chat-item]');if(!conversation||!id||!el)return;const open=(event:Event)=>{event.preventDefault();event.stopPropagation();setSelectedCopy(selectedMessageText(el));setEmojiMenu(null);setReactionError('');setMenu(messageContextAnchor(event as MouseEvent))};el.addEventListener('contextmenu',open);return()=>el.removeEventListener('contextmenu',open)},[conversation,id])
  const perform=async(work:()=>Promise<unknown>,emoji?:string,from?:DOMRect)=>{if(pending.current)return;pending.current=true;setBusy(true);setReactionError('');try{const accepted=await work();if(!alive.current)return;if(accepted===false){setReactionError('Update not confirmed. Check the current state before retrying.');return}setMenu(current=>current===menu?null:current);setEmojiMenu(current=>current===emojiMenu?null:current);if(emoji&&from)setAcknowledgement({emoji,from})}catch(cause){if(alive.current)setReactionError((cause as Error).message)}finally{pending.current=false;if(alive.current)setBusy(false)}}
  const change=(patch:MessagePreferences,from?:DOMRect)=>{if(canAnnotate)void perform(async()=>{if(sharedGroup&&patch.pinned!==undefined)await api.call('chat.pin',{id:sharedGroup,messageId:id,pinned:patch.pinned});return messenger!.message(conversation!,id!,patch)},patch.reaction,from)}
  const react=(emoji:string,from?:DOMRect)=>{if(!sharedGroup){change({reaction:preferences.reaction===emoji?'':emoji},from);return}const selected=!reactions.some(value=>value.emoji===emoji&&value.my);void perform(()=>api.call('chat.react',{id:sharedGroup,messageId:id,emoji,selected}),selected?emoji:undefined,from)}
  const copy=async()=>{if(await clipboard.copy(selectedCopy??text))setMenu(null)}
  const forward=()=>{if(conversation&&id)messenger?.setForward({messages:[{conversation,id}],text,images});setMenu(null)}
  if(!text.trim()&&!conversation)return null
  return <>
    <div ref={root} className="message-actions"><button className="message-options-trigger" aria-label={uiText('Message options')} title={uiText('Message options')} aria-haspopup="menu" aria-expanded={!!menu||!!emojiMenu} onClick={event=>{event.stopPropagation();const bounds=event.currentTarget.getBoundingClientRect();setSelectedCopy(undefined);setEmojiMenu(null);setReactionError('');setMenu(previous=>previous?null:{x:bounds.right+4,y:bounds.bottom+4,originX:bounds.right,originY:bounds.bottom})}}><Icon name="ellipsis"/></button></div>
    {(reactions.length||preferences.reaction||preferences.saved||pinned)&&<div className="message-annotations">{sharedGroup?reactions.map(reaction=><button key={reaction.emoji} disabled={busy} className="message-reaction" data-emoji={reaction.emoji} data-selected={reaction.my} aria-pressed={reaction.my} title={reaction.names.join(' · ')} aria-label={uiText("React {0}",[reaction.emoji])} onClick={event=>react(reaction.emoji,event.currentTarget.getBoundingClientRect())}>{reaction.emoji}<span>{reaction.count}</span></button>):preferences.reaction&&<button disabled={busy} className="message-reaction" data-emoji={preferences.reaction} aria-label={uiText("Remove reaction {0}",[preferences.reaction])} onClick={()=>change({reaction:''})}>{preferences.reaction}<span>1</span></button>}{preferences.saved&&<span title={uiText("Saved message")}><Icon name="bookmark"/></span>}{pinned&&<button onClick={()=>messenger?.setLibrary({conversation,filter:'pinned'})}><Icon name="pinned"/>  {uiText("Pinned")}</button>}</div>}
    {reactionError&&!menu&&!emojiMenu&&<p className="group-card-error" role="alert">{uiText(reactionError)}<button onClick={()=>setReactionError('')}>{uiText('Dismiss')}</button></p>}
    {emojiMenu&&<EmojiPicker anchor={emojiMenu} owner={owner} trigger={trigger} busy={busy} error={reactionError} onClose={()=>setEmojiMenu(null)} onSelect={react}/>}
    {menu&&<MessageMenu anchor={menu} owner={owner} trigger={trigger} busy={busy} label={uiText("Message options")} onClose={()=>setMenu(null)}>
      {canAnnotate&&<div className="message-reaction-picker" role="group" aria-label={uiText("React to message")} aria-description={sharedGroup?uiText("Choose up to three reactions"):undefined}>{MESSAGE_REACTIONS.map(reaction=><button disabled={busy} key={reaction} role={sharedGroup?"menuitemcheckbox":"menuitemradio"} aria-checked={sharedGroup?reactions.some(value=>value.emoji===reaction&&value.my):preferences.reaction===reaction} aria-label={uiText("React {0}",[reaction])} onClick={event=>react(reaction,event.currentTarget.getBoundingClientRect())}><span aria-hidden="true">{reaction}</span></button>)}{sharedGroup&&<button disabled={busy} role="menuitem" aria-label={uiText("More reactions")} onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setEmojiMenu({...menu,originX:rect.left+rect.width/2,originY:rect.top+rect.height/2});setMenu(null)}}><Icon name="add"/></button>}</div>}
      {reactionError&&<p className="message-menu-error" role="alert">{uiText(reactionError)}</p>}
      {isEmoji&&!!root.current?.closest('[data-chat-item][data-emoji-count]')&&<button disabled={busy} role="menuitem" onClick={()=>{setMenu(null);replay()}}><Icon name="play"/>{uiText('Replay emoji animation')}</button>}
      {onThread&&<button disabled={busy} role="menuitem" onClick={()=>{setMenu(null);onThread()}}><Icon name="comment-discussion"/>{uiText("Open thread")}</button>}
      {onReply&&<button disabled={busy} role="menuitem" onClick={()=>{setMenu(null);onReply()}}><Icon name="reply"/>{uiText("Reply")}</button>}
      {!protectedContent&&text.trim()&&<button disabled={busy} role="menuitem" onClick={()=>void copy()}><Icon name="copy"/>{uiText(status&&status!=='Copied'?status:selectedCopy?'Copy selected text':'Copy text')}</button>}
      {onPrivate&&<button disabled={busy} role="menuitem" onClick={()=>{setMenu(null);onPrivate()}}><Icon name="account"/>{uiText("Open private chat")}</button>}
      {onEdit&&<button disabled={busy} role="menuitem" onClick={()=>{setMenu(null);onEdit()}}><Icon name="edit"/>{uiText('Edit message')}</button>}
      {!protectedContent&&conversation&&id&&<button disabled={busy} role="menuitem" onClick={forward}><Icon name="arrow-right"/>{uiText("Forward message")}</button>}
      {!protectedContent&&conversation&&id&&<button disabled={busy} role="menuitem" onClick={()=>{messenger?.setReplyTarget({conversation,id,text,images});setMenu(null)}}><Icon name="reply"/>{uiText('Reply in another conversation')}</button>}
      {canAnnotate&&<><button disabled={busy} role="menuitem" onClick={()=>change({saved:!preferences.saved})}><Icon name="bookmark"/>{preferences.saved?uiText("Remove from saved"):uiText("Save message")}</button>
      <button disabled={busy} role="menuitem" onClick={()=>change({pinned:!pinned})}><Icon name="pinned"/>{pinned?uiText("Unpin message"):uiText("Pin message")}</button></>}
      {conversation&&id&&<button disabled={busy} role="menuitem" onClick={()=>{messenger?.setSelection({conversation,ids:[id]});setMenu(null)}}><Icon name="checklist"/>{uiText("Select message")}</button>}
      {onRemove&&<button disabled={busy} role="menuitem" onClick={()=>{setMenu(null);onRemove()}}><Icon name="discard"/>{uiText("Withdraw message")}</button>}
      {canAnnotate&&<><hr/><button disabled={busy} role="menuitem" onClick={()=>change({hidden:true})}><Icon name="eye-closed"/>{uiText("Hide for me")}</button></>}
    </MessageMenu>}
  </>
}

export function MessageDate({value}:{value:number}){
  useI18n()

  const date=new Date(value),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1)
  const label=date.toDateString()===today.toDateString()?'Today':date.toDateString()===yesterday.toDateString()?'Yesterday':date.toLocaleDateString(interfaceLocale(),{month:'long',day:'numeric',...(date.getFullYear()!==today.getFullYear()?{year:'numeric' as const}:{})})
  return <div className="message-date"><time dateTime={date.toISOString()}>{uiText(label)}</time></div>
}
