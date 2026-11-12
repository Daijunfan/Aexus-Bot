import {SOURCE_VIEW_LABELS,type MessageSourceView} from '../shared/message-source'

/** Only this message's routing facts; stable rules are delivered by employee-context. */
export function messageSourcePrompt(sourceView:MessageSourceView|undefined,text:string){
 const source=sourceView??'company'
 return '[Aexus message source]\n'+JSON.stringify({view:SOURCE_VIEW_LABELS[source],conversationType:source==='messages'?'private':'native',replyVia:source==='messages'?'direct.post':'native'})+'\n\n'+text
}
