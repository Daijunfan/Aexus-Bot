import {GROUP_COLLABORATION_APIS} from '../../shared/group-collaboration'
import {groupCollaborationRequest} from '../group-collaboration'
import {requestContext} from '../request-context'
import {botGroup,sendBotMessage} from '../bot-workers'
import { listChatGroups,getChatGroup,createChatGroup,updateChatGroup,muteChatMember,deleteChatGroup,chatHistory,chatContext,sendChatMessage,retryChatMessage,editChatMessage,postChatMessage,acknowledgeChat,groupAttachment } from '../chat-groups'
import { getView,setView } from '../presentation'
export async function chatRequest(command:string,a:Record<string,any>){
 if(['chat.send','chat.post'].includes(command)&&botGroup(a.id))return (await sendBotMessage(a)).message
 if(GROUP_COLLABORATION_APIS.has(command))return groupCollaborationRequest(command,a,(args,card)=>requestContext().principal.kind==='operator'?sendChatMessage(args,undefined,undefined,card):postChatMessage({...args,kind:'question'},false,undefined,card))
 const s=(value:unknown)=>String(value)
 switch(command){
    case 'chat.list': return listChatGroups()
    case 'chat.create': return createChatGroup(a)
    case 'chat.update': return updateChatGroup(a)
    case 'chat.delete': {const result=deleteChatGroup(a.id);if(getView().chatId===a.id)setView({kind:'messages'});return result}
    case 'chat.get': return getChatGroup(a.id,a.topicId)
    case 'chat.history': return chatHistory(a)
    case 'chat.context': return chatContext(a)
    case 'chat.file': return groupAttachment(a)
    case 'chat.send': return sendChatMessage(a)
    case 'chat.retry': return retryChatMessage(a)
    case 'chat.edit': return editChatMessage(a)
    case 'chat.mute': return muteChatMember(a)
    case 'chat.post': return postChatMessage(a)
    case 'chat.acknowledge': return acknowledgeChat(a)
 default:throw Error('Unknown chat command')
 }
}
