import {ChatQuestionCard} from '../components/ChatQuestions'
import {formatMessageClock,formatMessageDateTime} from '../message-time'
import {NativeMessageContext} from '../components/NativeInputContext'
import {MessageFile} from './MessageAttachments'
import {SOURCE_VIEW_LABELS} from '../../../shared/message-source'
import {ReplyPreview} from './ReplyPreview'
import {translate as uiText,useI18n,interfaceLanguage} from '../i18n'
// Rendering one conversation: turns, and the blocks inside them.

import {emojiCount,type BubbleGroup} from './messagePresentation'
import {MessageImages} from './MessageImage'
import {MessageCheckbox} from '../components/MessageSelectionBar'
import {useMessenger} from '../components/useMessenger'
import {conversationKey,messageKey} from '../../../shared/messenger'
import {MessageActions} from './MessageActions'
import {MessageReceipt} from './MessageReceipt'
import { memo } from 'react'
import {RichMessageText} from './RichMessageText'
import {useMessageRowState} from './MessageViewport'
import {Icon} from '../components/Icon'
import {EngineData,RawData} from '../components/EngineData'
import {api} from '../api'
import type { Block, Item } from '../../../shared/types'
import { format, summarize, truncate } from '../../../shared/transcript'

export const Turn=memo(function Turn({ item,replyId,messageEmployee,messageAuthor,timestamp,onReply,bubbleGroup,conversationEmployee,replyAuthor,requestAuthor }: { item: Item;conversationEmployee?:string;replyAuthor?:string;requestAuthor?:string;bubbleGroup?:BubbleGroup;replyId?:string;messageEmployee?:string;messageAuthor?:string;timestamp?:number|null;onReply?:(item:Item)=>void }) {
  useI18n()


  const messenger=useMessenger(),conversation=messageEmployee?conversationKey('employee',messageEmployee):undefined
  const selecting=!!conversation&&messenger?.selection?.conversation===conversation,selected=selecting&&messenger!.selection!.ids.includes(item.id)
  const select=(event:React.MouseEvent)=>{if(selecting&&!(event.target as Element).closest('.message-select-toggle')){event.preventDefault();event.stopPropagation();messenger!.toggleSelection(conversation!,item.id)}}
  if(conversation&&messenger?.state.messages[messageKey(conversation,item.id)]?.hidden)return <div className="message-hidden" data-chat-item={item.id}><Icon name="eye-closed"/>{uiText("Message hidden for you")}<button onClick={()=>void messenger.message(conversation,item.id,{hidden:false})}>{uiText("Show message")}</button></div>
  const clock=timestamp?{dateTime:new Date(timestamp).toISOString(),title:formatMessageDateTime(timestamp,true),label:formatMessageClock(timestamp)}:null
  const time=clock?<time className="message-time" dateTime={clock.dateTime} title={clock.title}>{clock.label}</time>:null
  if (item.role === 'user') {
    return (
      <div className="turn user" data-source-view={item.sourceView} title={item.sourceView?uiText('Sent from {0} view',[uiText(SOURCE_VIEW_LABELS[item.sourceView])]):undefined} data-emoji-count={messageEmployee&&!item.reply&&!item.images?.length&&!item.files?.length?emojiCount(item.text):undefined} data-bubble-group={bubbleGroup} data-selecting={selecting||undefined} data-selected={selected||undefined} onClickCapture={select} data-chat-item={item.id}>
        <div className="bubble">{messageEmployee&&!requestAuthor&&<div className="message-row-heading">{uiText('You')}</div>}{!messageEmployee&&item.context&&<NativeMessageContext context={item.context}/>}<MessageCheckbox conversation={conversation} id={item.id}/>{requestAuthor&&<span className="message-request-author">{uiText('From {0}',[requestAuthor])}</span>}{item.reply&&<ReplyPreview reply={item.reply} author={replyAuthor??uiText('Original message')} onNavigate={()=>conversationEmployee&&messenger?.navigate({conversation:item.reply!.conversation??conversationKey('employee',conversationEmployee),id:item.reply!.id,quote:item.reply!.quote},{conversation:conversationKey('employee',conversationEmployee),id:item.id})}/>}{messageEmployee?<BlockView block={{kind:'text',text:item.text}} english plainText/>:<span data-quote-text>{item.text}</span>}{messageEmployee?<MessageImages employee={messageEmployee} paths={item.images??[]} messageId={item.id} caption={item.text}/>:item.images?.map(path=><div className="message-image-label" key={path}>🖼 {path}</div>)}{conversationEmployee&&item.files?.map(file=><MessageFile messageId={item.id} key={file.path} conversation={conversationKey('employee',conversationEmployee)} file={file}/>)}{messageEmployee&&item.delivery&&['preparing','queued','failed','interrupted'].includes(item.delivery.state)&&<small className="direct-delivery" data-state={item.delivery.state} role={['failed','interrupted'].includes(item.delivery.state)?'alert':undefined}>{uiText(item.delivery.state==='preparing'?'Sending…':item.delivery.state==='queued'?'Queued':item.delivery.state==='failed'?'Send failed':'Interrupted')}{item.delivery.error&&<span>{item.delivery.error}</span>}</small>}{messageEmployee&&item.outbound?<span className="message-time message-time-with-receipt">{clock&&<time dateTime={clock.dateTime} title={clock.title}>{clock.label}</time>}<MessageReceipt outbound={item.outbound}/></span>:time}{messageEmployee&&<MessageActions conversation={conversation} id={item.id} images={(item.images?.length??0)+(item.files?.length??0)} text={item.text} onReply={onReply?()=>onReply(item):undefined}/>}</div>
      </div>
    )
  }
  if (item.role === 'notice') {
    return <div className={`turn notice ${item.tone}`}>{item.text}</div>
  }
  const blocks=messageEmployee?item.blocks.filter(block=>block.kind==='text'&&block.text.trim()):item.blocks
  if(messageEmployee&&!blocks.length&&!item.images?.length&&!item.files?.length)return null
  return (
    <div className="turn assistant" data-emoji-count={messageEmployee&&item.blocks.length===1&&item.blocks[0].kind==='text'?emojiCount(item.blocks[0].text):undefined} data-bubble-group={bubbleGroup} data-selecting={selecting||undefined} data-selected={selected||undefined} onClickCapture={select} data-chat-item={item.id}><MessageCheckbox conversation={conversation} id={item.id}/>{messageEmployee&&<div className="message-row-heading">{messageAuthor??uiText('Teammate')}</div>}
      {messageEmployee&&item.questionId?<ChatQuestionCard id={item.questionId} fallback={blocks.filter(block=>block.kind==='text').map(block=>block.text).join('\n')}/>:blocks.map((b, i) => (
        <BlockView key={i} block={b} english={!!messageEmployee} plainText={!!messageEmployee} stateKey={b.id??String(i)}/>
      ))}
      {messageEmployee&&<MessageImages employee={messageEmployee} paths={item.images??[]} messageId={item.id} caption={item.blocks.filter(b=>b.kind==='text').map(b=>b.text).join('\n')}/>}
      {messageEmployee&&item.files?.map(file=><MessageFile key={file.path} messageId={item.id} conversation={conversationKey('employee',messageEmployee)} file={file}/>)}
      {replyId&&<span className="reply-seen-marker" data-reply-id={replyId} aria-hidden="true"/>}{time}
      {messageEmployee&&<MessageActions conversation={conversation} id={item.id} images={(item.images?.length??0)+(item.files?.length??0)} text={item.blocks.filter(block=>block.kind==='text').map(block=>block.text).join('\n\n')} onReply={onReply&&(item.blocks.some(block=>block.kind==='text'&&block.text.trim())||!!item.images?.length||!!item.files?.length)?()=>onReply(item):undefined}/>}
    </div>
  )
})

export const BlockView=memo(function BlockView({ block,english=false,plainText=false,stateKey='body' }: { block: Block;english?:boolean;plainText?:boolean;stateKey?:string }) {
  useI18n()

  if (block.kind === 'text') {
    // JSON replies remain intact in the CLI transcript; the UI adds a readable view.
    let data:unknown
    try { if(!plainText&&block.text.trim().startsWith('{'))data=JSON.parse(block.text) } catch {}
    if(data&&typeof data==='object')return <details className="command-data" open><summary>{english?uiText("Result"):uiText("Result")}</summary><EngineData data={data}/><RawData data={data}/></details>
    return <RichMessageText className="text" text={block.text} quoteText stateKey={stateKey}/>
  }
  if (block.kind === 'thinking') return <Thinking text={block.text} done={block.done} stateKey={stateKey}/>
  return <ToolCall block={block} />
})

export function Thinking({ text, done,stateKey='thinking' }: { text: string; done: boolean;stateKey?:string }) {
  useI18n()

  const [open, setOpen] = useMessageRowState('thinking:'+stateKey,false)
  const streaming = !done
  return (
    <div className={`thinking ${streaming ? 'streaming' : ''}`}>
      <button className="thinking-head" onClick={() => setOpen((v) => !v)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <span className="thinking-label">
          {streaming ? uiText("Thinking…") : uiText("Thought")}
          {streaming && <span className="ellipsis" />}
        </span>
      </button>
      {(open || streaming) && <div className="thinking-body">{text}</div>}
    </div>
  )
}

export function ToolCall({ block }: { block: Block }) {
  useI18n()

  if (block.kind !== 'tool') return null
  const [open, setOpen] = useMessageRowState('tool:'+block.id,false)
  const detail = summarize(block.input)
  return (
    <div className={`tool ${block.running ? 'running' : ''} ${block.isError ? 'errored' : ''}`}>
      <button className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className={`status ${block.running ? 'spin' : block.isError ? 'bad' : 'good'}`}>
          {block.running ? '◐' : block.isError ? '✕' : '✓'}
        </span>
        <span className="tool-name">{block.name}</span>
        <span className="tool-arg">{detail}</span>
        {block.running && block.elapsed !== undefined && (
          <span className="tool-elapsed">{block.elapsed}{uiText("s")}</span>
        )}
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tool-detail">
          {block.input && Object.keys(block.input).length > 0 && (
            <pre className="tool-io">{format(block.input)}</pre>
          )}
          {block.result !== undefined && (
            <pre className={`tool-io result ${block.isError ? 'bad' : ''}`}>
              {truncate(block.result)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
