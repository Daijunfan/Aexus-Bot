import {APP_VIEWS,type AppViewId} from './app-views.ts'

/** The sender's presentation at send time; independent of Governor's target team-view scope. */
export type MessageSourceView=AppViewId
/** Exact application-owned input shown only in the full Team conversation. */
export type NativeInputContext={origin:{kind:'direct'|'group'|'channel'|'company'|'plan'|'unknown';name:string;id?:string;messageId?:string};phase:'work'|'read';prompt:string;executionInstructions?:string}
export const SOURCE_VIEW_LABELS:Record<MessageSourceView,string>={company:'Team',messages:'Message',plan:'Mission'}
export const AGENT_CONTEXT_REVISION='aexus-context-1'
export const SOURCE_VIEW_SCHEMA={type:'string',enum:APP_VIEWS.map(view=>view.id),description:'Sender-declared origin for this input. company or omitted: native Team reply, without private/group tags. messages: tagged private input, reply via direct.post. plan: native task result unless publication is requested. Not an execution target or permission. Preserve on unchanged retries.'}
export function messageSourceView(value:unknown):MessageSourceView|undefined{
 if(value===undefined)return undefined
 if(!APP_VIEWS.some(view=>view.id===value))throw Error('sourceView must be company, messages or plan')
 return value as MessageSourceView
}

export const MESSAGE_REPLY_GUIDANCE='回复按本条来源和用户明确要求决定，不继承上一条来源。Team、CLI 和普通 Mission 工作使用原生正文；Message 私聊使用 direct.post；群聊使用 chat.post 或 agents_company_discussion_post。跨会话发送仅按用户明确要求；静默阅读不发言、不派生工作。不要将内部路由或消息 ID 当作答复。图文与附件按需查 core/magazine-reading。'
