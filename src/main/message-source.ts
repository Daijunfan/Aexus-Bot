import type {MessageSourceView} from '../shared/message-source'

const guidance:Record<MessageSourceView,string>={
 company:'默认使用原生 Coding Agent 正文回复。',
 messages:'from [private]\n本条来自 Message 私聊，答复使用 direct.post；可按需要连续发送文字、图片和文件。不要仅因来源而建群或群发。',
 plan:'本条是 Mission 工作，默认用原生正文返回结果；只有任务或用户明确要求向私聊、群组发送时才调用相应发送 API。需要定时、重复或事件任务时使用 schedule.*；不要把 Mission 与 MiniNotion 插件混淆。'
}
/** Shared by all native adapters. Persist the original message separately from this task-only guidance. */
export function messageSourcePrompt(sourceView:MessageSourceView|undefined,text:string){
 if(sourceView===undefined||sourceView==='company')return text
 return '[Agents Company message source]\n'+JSON.stringify({sourceView,...(sourceView==='messages'?{conversationType:'private',replyVia:'direct.post'}:{replyVia:'native'})})+'\n'+guidance[sourceView]+'\n先遵循正文中的明确要求；来源不授予权限，不沿用上一条消息的来源。软件操作按需查询 api.list 和 api.describe。\n\n[Current message]\n'+text
}
