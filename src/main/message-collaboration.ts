import {requireGroupExport} from './group-history'
import {botGroup} from './bot-workers'
import {MESSAGE_COLLABORATION_COMMANDS} from '../shared/message-collaboration'
import {workspaceCatalog} from './workspace-catalog'
import {conversationEntry,downloadAttachment,downloadStatus,downloadAttachmentLocal} from './conversation-attachments'
import {postTriggerRequest} from './channel-post-triggers'
import {uploadSharedFile,sharedUploadStatus} from './conversation-uploads'
import type {FileLocation} from '../shared/transfers'
import type {FileEndpoint} from './transfers'

/** Shared dispatch for the GUI, CLI and authenticated employee tools. */
export function messageCollaborationRequest(command:string,args:Record<string,any>,resolve:(ref:FileLocation,destination:boolean)=>FileEndpoint){
 if(typeof args.conversation==='string'&&args.conversation.startsWith('employee:')&&botGroup(args.conversation.slice(9)))args={...args,conversation:'group:'+args.conversation.slice(9)}
 const schema=MESSAGE_COLLABORATION_COMMANDS.find(c=>c.name===command)?.inputSchema
 if(!schema)throw Error('Unknown Message collaboration API')
 for(const key of Object.keys(args))if(args[key]!==undefined&&!Object.hasOwn(schema.properties,key))throw Error('Unknown Message collaboration field: '+key)
 for(const key of schema.required??[])if(args[key]===undefined)throw Error('Missing required field: '+key)
 if(command==='workspace.catalog')return workspaceCatalog(args)
 if(command==='conversation.upload')return uploadSharedFile(args,resolve)
 if(command==='conversation.upload-status')return sharedUploadStatus(args as any)
 if(['conversation.download','conversation.download-local'].includes(command))requireGroupExport(args.conversation)
 if(command==='conversation.entry')return conversationEntry(args)
 if(command==='conversation.download')return downloadAttachment(args,resolve)
 if(command==='conversation.download-local')return downloadAttachmentLocal(args)
 if(command==='conversation.download-status')return downloadStatus(args)
 return postTriggerRequest(command,args)
}
