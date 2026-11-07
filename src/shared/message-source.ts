import {APP_VIEWS,type AppViewId} from './app-views.ts'

/** The sender's presentation at send time; independent of Governor's target team-view scope. */
export type MessageSourceView=AppViewId
/** Exact application-owned input shown only in the full Company conversation. */
export type NativeInputContext={origin:{kind:'direct'|'group'|'channel'|'company'|'plan'|'unknown';name:string;id?:string;messageId?:string};phase:'work'|'read';prompt:string;executionInstructions?:string}
export const SOURCE_VIEW_LABELS:Record<MessageSourceView,string>={company:'Agents',messages:'Message',plan:'Plan'}
export const SOURCE_VIEW_SCHEMA={type:'string',enum:APP_VIEWS.map(view=>view.id),description:'Optional sender-declared presentation at send time (company/messages/plan). Context only: not a target, permission or current-screen lookup. Preserve on unchanged retries.'}
export function messageSourceView(value:unknown):MessageSourceView|undefined{
 if(value===undefined)return undefined
 if(!APP_VIEWS.some(view=>view.id===value))throw Error('sourceView must be company, messages or plan')
 return value as MessageSourceView
}

export const MESSAGE_REPLY_GUIDANCE='原生 Agent 的普通正文、思考和工具过程只属于 Agents 完整会话，不会发送到私聊或群聊。给用户发私聊必须显式调用 direct.post，可用 text、images、files；每个 clientMessageId 对应一条消息，不同 ID 可以连续发送多段文字、图片或文件。direct.post 只向用户发布你自己的私聊，不派发工作；用户要求私聊时使用它，不要给自己调用 session.send/enqueue。群聊发言仍必须显式调用 chat.post 或 agents_company_discussion_post。旁观消息只静默阅读，不自动接话、互相确认或派生工作。'
export const MESSAGE_DELIVERY_CONTRACT='[Current message delivery contract]\n以下规则替代历史中的旧消息路由：原生正文、思考和工具输出只在 Agents 显示。向用户发私聊必须显式调用 direct.post（text/images/files，不同 clientMessageId 可连续发多条）；群聊仍须显式 chat.post。不要把原生正文当作已发送私聊，也不要给自己派发任务来回复用户。'
