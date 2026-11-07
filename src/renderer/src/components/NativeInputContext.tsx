import type {NativeInputContext as NativeInputContextData} from '../../../shared/message-source'
import {translate as uiText,useI18n} from '../i18n'
import '../styles/native-input-context.css'

function sourceLabel(origin:NativeInputContextData['origin']){
 const {kind,name}=origin
 if(kind==='group')return name?`[${name}]`:`[${uiText('Group')}]`
 if(kind==='direct')return name?`[${uiText('Private')} · ${name}]`:`[${uiText('Private')}]`
 if(kind==='channel')return name?`[${uiText('Channel')} · ${name}]`:`[${uiText('Channel')}]`
 if(kind==='company')return `[${uiText('Company')}]`
 if(kind==='plan')return '[Mission]'
 return name?`[${uiText('Unknown')} · ${name}]`:`[${uiText('Unknown')}]`
}

/** Compact provenance for the exact native input shown only in the full Company conversation. */
export function NativeMessageContext({context}:{context:NativeInputContextData}){
 useI18n()
 const source=sourceLabel(context.origin)
 return <section className="native-input-context" data-origin-kind={context.origin.kind} data-phase={context.phase}>
  <div className="native-input-context-head">
   <span className="native-input-context-source" title={source}>from {source}</span>
   {context.phase==='read'&&<span className="native-input-context-read">{uiText('Read silently')}</span>}
  </div>
  <details className="native-input-context-prompt">
   <summary>{uiText('System wrapper prompt')}</summary>
   <pre className="native-input-context-code">{context.prompt}</pre>
   {context.executionInstructions&&<>
    <span className="native-input-context-label">{uiText('Execution instructions')}</span>
    <pre className="native-input-context-code">{context.executionInstructions}</pre>
   </>}
  </details>
 </section>
}
