import {useId,useState} from 'react'
import type {Session} from '../../../shared/types'
import {SOURCE_VIEW_LABELS} from '../../../shared/message-source'
import {translate as uiText} from '../i18n'
import {Icon} from './Icon'
import {ScrollArea} from './ScrollArea'

type QueuedMessage=NonNullable<Session['pendingMessages']>[number]

/** One employee has one ordered queue, shared by its Message and Team surfaces. */
export function TaskQueue({messages=[],onRemove,replyLabel}:{messages?:QueuedMessage[];onRemove:(id:string)=>Promise<unknown>;replyLabel?:(message:QueuedMessage)=>string}){
 const listId=useId(),[open,setOpen]=useState(true),[expanded,setExpanded]=useState<string>(),[removing,setRemoving]=useState<string>(),[error,setError]=useState<{id:string;message:string}>()
 if(!messages.length)return null
 const remove=async(id:string)=>{
  if(removing)return
  setRemoving(id);setError(undefined)
  try{await onRemove(id)}catch(cause){setError({id,message:(cause as Error).message??String(cause)})}finally{setRemoving(undefined)}
 }
 return <section className="task-queue" aria-label={uiText('Queued messages')}>
  <button className="task-queue-heading" aria-expanded={open} aria-controls={listId} onClick={()=>setOpen(!open)}>
   <Icon name="list-ordered"/><strong>{uiText('Up next')}</strong><span className="task-queue-count">{messages.length}</span><span className="task-queue-hint">{uiText('Runs in order after this task')}</span><Icon name={open?'chevron-up':'chevron-down'}/>
  </button>
  {open&&<ScrollArea id={listId} className="task-queue-list" tabIndex={0} aria-label={uiText('Queued messages in execution order')}><ol>{messages.map((message,index)=>{
   const attachments=(message.images?.length??0)+(message.files?.length??0),full=expanded===message.id,canExpand=message.text.length>100||message.text.includes('\n'),names=[...(message.images??[]),...(message.files??[])].map(path=>path.split(/[\\/]/).pop()).join(', ')
   return <li key={message.id} data-queue-id={message.id}>
    <span className="task-queue-order" aria-label={uiText('Queue position {0}',[index+1])}>{index+1}</span>
    <div className="task-queue-content">
     <div className="task-queue-meta">{index===0&&<span className="task-queue-next">{uiText('Next task')}</span>}{message.sourceView&&<span>{uiText(SOURCE_VIEW_LABELS[message.sourceView])}</span>}{message.replyTo&&<span><Icon name="reply"/>{replyLabel?.(message)??uiText('Reply attached')}</span>}{attachments>0&&<button className="task-queue-attachments" title={names} aria-expanded={full} onClick={()=>setExpanded(full?undefined:message.id)}><Icon name="attach"/>{uiText(attachments===1?'1 attachment':'{0} attachments',[attachments])}</button>}</div>
     {message.text&&(canExpand?<button className="task-queue-preview" aria-expanded={full} onClick={()=>setExpanded(full?undefined:message.id)} title={uiText(full?'Collapse message':'Read full message')}><span>{message.text}</span><Icon name={full?'chevron-up':'chevron-down'}/></button>:<p className="task-queue-text">{message.text}</p>)}
     {!message.text&&!full&&<p className="task-queue-text task-queue-files">{names}</p>}
     {full&&attachments>0&&<div className="task-queue-file-list">{[...(message.images??[]),...(message.files??[])].map((path,index)=><span key={index}><Icon name="file"/>{path.split(/[\\/]/).pop()}</span>)}</div>}
    </div>
    <button className="task-queue-remove" disabled={!!removing} aria-label={uiText('Remove queued message')} title={uiText('Remove this message from the queue')} onClick={()=>void remove(message.id)}>{removing===message.id?<span className="spinner"/>:<Icon name="close"/>}</button>
   </li>
  })}</ol></ScrollArea>}
  {error&&messages.some(message=>message.id===error.id)&&<p className="task-queue-error" role="alert"><Icon name="warning"/>{uiText(error.message)}<button aria-label={uiText('Dismiss error')} onClick={()=>setError(undefined)}><Icon name="close"/></button></p>}
 </section>
}
