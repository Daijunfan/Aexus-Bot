import {APP_VIEWS,type AppViewId} from './app-views.ts'

/** The sender's presentation at send time; independent of Governor's target team-view scope. */
export type MessageSourceView=AppViewId
/** Exact application-owned input shown only in the full Company conversation. */
export type NativeInputContext={origin:{kind:'direct'|'group'|'channel'|'company'|'plan'|'unknown';name:string;id?:string;messageId?:string};phase:'work'|'read';prompt:string;executionInstructions?:string}
export const SOURCE_VIEW_LABELS:Record<MessageSourceView,string>={company:'Team',messages:'Message',plan:'Mission'}
export const SOURCE_VIEW_SCHEMA={type:'string',enum:APP_VIEWS.map(view=>view.id),description:'Sender-declared origin for this input. company or omitted: native Team reply, without private/group tags. messages: tagged private input, reply via direct.post. plan: native task result unless publication is requested. Not an execution target or permission. Preserve on unchanged retries.'}
export function messageSourceView(value:unknown):MessageSourceView|undefined{
 if(value===undefined)return undefined
 if(!APP_VIEWS.some(view=>view.id===value))throw Error('sourceView must be company, messages or plan')
 return value as MessageSourceView
}

export const MESSAGE_REPLY_GUIDANCE='回复位置以本条消息的来源标签和用户明确要求为准，不沿用历史来源。没有私聊或群聊来源标签时（包括 Team、CLI 和普通 Mission 工作），直接用原生 Coding Agent 正文回复，不调用发消息 API。带 Message 私聊来源标签时，使用 direct.post 回复；带群聊来源标签时，使用 chat.post 或 agents_company_discussion_post 回复该群。用户明确要求跨会话发送时才切换目标，例如在 Team 或群聊要求发私聊。direct.post 只发布本人给用户的私聊，支持 text/images/files；不同 clientMessageId 可连续发多条，原样重试复用原 ID。不要给自己调用 session.send/enqueue 来回复。旁观消息只静默阅读，不自动接话或派生工作。不要把 API 名称、消息 ID 或投递过程当作答复正文。'
export const MESSAGE_DELIVERY_CONTRACT='[Current message delivery contract]\n本条规则替代历史中的旧路由：无私聊/群聊来源标签，默认原生正文回复，留在 Team；有私聊标签才用 direct.post，有群聊标签才向该群显式发布。用户本条明确指定其他目标时按要求发送。不能把 Team 中的普通对话自动搬到私聊。思考与工具过程始终只在 Team 完整会话中展示。'
