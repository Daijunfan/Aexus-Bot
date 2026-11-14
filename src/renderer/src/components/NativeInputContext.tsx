import {SOURCE_VIEW_LABELS,type NativeInputContext as NativeInputContextData} from '../../../shared/message-source'
import {SCHEDULE_EVENT_REFERENCE_LABEL} from '../../../shared/scheduler'
import {useMessageRowState} from '../chat/MessageViewport'
import {translate as uiText,useI18n} from '../i18n'
import '../styles/native-input-context.css'

function sourceLabel(origin:NativeInputContextData['origin']){
 const {kind,name}=origin
 if(kind==='group')return name?`[${name}]`:`[${uiText('Group')}]`
 if(kind==='direct')return name?`[${uiText('Private')} · ${name}]`:`[${uiText('Private')}]`
 if(kind==='channel')return name?`[${uiText('Channel')} · ${name}]`:`[${uiText('Channel')}]`
 if(kind==='company')return `[${SOURCE_VIEW_LABELS.company}]`
 if(kind==='plan')return `[${SOURCE_VIEW_LABELS.plan}]`
 return name?`[${uiText('Unknown')} · ${name}]`:`[${uiText('Unknown')}]`
}

/** Compact provenance for the exact native input shown only in the full Team conversation. */
const scheduledInput=(text:string,context?:NativeInputContextData)=>context?.origin.kind==='plan'||context?.phase==='work'&&context.origin.kind==='company'&&(text.includes('\n\n'+SCHEDULE_EVENT_REFERENCE_LABEL)&&text.endsWith('Do not delete a persistent reply watch just because the bot acknowledged your request.')||text.includes('\n\nCore Plan publishing destination: ')&&text.endsWith('Private replies are not automatically published.'))
export function NativeMessageContext({context,text=''}:{context:NativeInputContextData;text?:string}){
 useI18n()
 const [open,setOpen]=useMessageRowState('native-wrapper-prompt',false)
 const scheduled=scheduledInput(text,context)
 const source=sourceLabel(context.origin)
 return <section className="native-input-context" data-origin-kind={context.origin.kind} data-phase={context.phase}>
  <div className="native-input-context-head">
   <span className="native-input-context-source" title={source}>from {source}</span>
   {context.phase==='read'&&<span className="native-input-context-read">{uiText('Read silently')}</span>}
  </div>
  <details className={'native-input-context-prompt'+(scheduled?' native-task-input':'')} data-native-task-input={scheduled||undefined} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
   <summary>{uiText(scheduled?'Task instructions and triggering events':'Sent input')}</summary>
   {open&&<pre className="native-input-context-code">{context.prompt}</pre>}
   {open&&context.executionInstructions&&<>
    <span className="native-input-context-label">{uiText('Execution instructions')}</span>
    <pre className="native-input-context-code">{context.executionInstructions}</pre>
   </>}
  </details>
 </section>
}

/** Historical Core event envelopes remain inspectable without filling the chat. */
export function NativeInputBody({text,context}:{text:string;context?:NativeInputContextData}){
 return scheduledInput(text,context)?null:<span data-quote-text>{text}</span>
}
