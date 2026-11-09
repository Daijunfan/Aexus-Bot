import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {WORKSPACE_FILE_PREFIX} from '../shared/conversation-workspaces'
import type {FileLocation,TransferJob} from '../shared/transfers'
import type {FileEndpoint} from './transfers'
import {startTransfer,getTransfer,cancelTransfer} from './transfers'
import {conversationFileEndpoint,workspaceForMember,sharedFileIO} from './conversation-workspaces'
import {workspaceFiles,workspacePath} from './files'
import {fileVersion} from './read-cache'
import {authorize,isAppAdministrator,requestContext,withCaller} from './authorization'
import {atomicJson,readJson} from './atomic-file'
import {downloadInfo} from './uploads'

type Receipt={id:string;owner:string;fingerprint:string;conversation:string;source:FileLocation;path:string;publishedPath:string;name:string;transferId?:string;state:TransferJob['state']|'preparing'|'interrupted';bytes:number;totalBytes:number;version?:string;error?:string;createdAt:number}
const directory=path.join(APP_HOME,'conversation-uploads'),owner=()=>{const p=requestContext().principal;return p.kind==='operator'?'operator':p.employeeId}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const location=(id:string)=>{if(!/^cu_[a-f0-9]{64}$/.test(id))throw Error('Invalid shared upload ID');return path.join(directory,id+'.json')}
const save=(job:Receipt)=>atomicJson(location(job.id),job,true)
const publicJob=({owner:_,fingerprint:__,transferId:___,...job}:Receipt)=>job
function refresh(job:Receipt){
 if(!['preparing','queued','running'].includes(job.state))return job
 try{if(!job.transferId)throw Error('No accepted transfer');const live=getTransfer(job.transferId);job.state=live.state;job.bytes=live.bytes;job.totalBytes=live.totalBytes;job.error=live.error}
 catch{job.state='interrupted';job.error='Core restarted; this upload was not replayed. Inspect the shared file before starting a new request.'}
 save(job);return job
}
export function sharedUploadStatus(args:{id:string;cancel?:boolean}){
 const job=readJson<Receipt|undefined>(location(args.id),()=>undefined)
 if(!job||!isAppAdministrator()&&job.owner!==owner())throw Error('Unknown shared upload for this caller')
 conversationFileEndpoint(job.conversation,job.path,true)
 if(args.cancel&&job.transferId&&['queued','running'].includes(job.state))cancelTransfer(job.transferId)
 return publicJob(refresh(job))
}

/** Stream an own-workspace file to the shared folder; an update commits only its expected version. */
export async function uploadSharedFile(args:Record<string,any>,resolve:(ref:FileLocation,destination:boolean)=>FileEndpoint){
 authorize('conversation.upload',args)
 if(typeof args.conversation!=='string'||!args.conversation.startsWith('group:'))throw Error('Choose a group shared workspace')
 if(typeof args.path!=='string'||!args.path||args.path.startsWith(WORKSPACE_FILE_PREFIX))throw Error('Choose a relative destination file path')
 if(typeof args.clientRequestId!=='string'||!args.clientRequestId.trim()||args.clientRequestId.length>160)throw Error('Provide a stable clientRequestId')
 if(args.expectedVersion!==undefined&&(typeof args.expectedVersion!=='string'||!args.expectedVersion))throw Error('expectedVersion must be a shared file version')
 if(!args.from||typeof args.from.path!=='string'||Object.keys(args.from).some(key=>!['employee','path'].includes(key)))throw Error('from requires your employee and a personal workspace file path')
 const principal=requestContext().principal,employee=args.from.employee===undefined||args.from.employee==='self'?(principal.kind==='agent'?principal.employeeId:undefined):args.from.employee
 if(!employee||!isAppAdministrator()&&principal.kind==='agent'&&employee!==principal.employeeId)throw Error('Uploads may read only your own personal workspace')
 const target=conversationFileEndpoint(args.conversation,args.path,true),workspace=workspaceForMember(args.conversation),relative=target.path,parts=relative.split('/')
 if(!relative||parts.some(p=>p==='.agents-company'||p.startsWith('.agents-transfer-'))||workspace.members.some(member=>member.directory===relative))throw Error('Choose a file, not a managed member workspace')
 const id='cu_'+hash([owner(),args.clientRequestId]),fingerprint=hash([args.conversation,employee,args.from.path,relative,args.expectedVersion??null]),previous=readJson<Receipt|undefined>(location(id),()=>undefined)
 if(previous){if(previous.fingerprint!==fingerprint)throw Error('Upload request ID already used with different arguments');return publicJob(refresh(previous))}
 const existing=await sharedFileIO(target,'copy-info',{path:relative}),version=existing.version??'missing'
 if(existing.exists&&(!existing.regular||existing.symlink))throw Error('Only a regular shared file can be replaced')
 if(args.expectedVersion!==undefined?version!==args.expectedVersion:existing.exists)throw Error('Shared file changed or already exists; read conversation.file info and supply expectedVersion to update')
 const from:FileLocation={employee,path:args.from.path},source=resolve(from,false),context=requestContext(),sourceRoot=source.root,sourceRemote=JSON.stringify(source.remote),validateSource=source.validate
 source.name=path.basename(relative)
 source.validate=async(operation,input)=>withCaller(context,async()=>{authorize('conversation.upload',args);const current=resolve(from,false);if(current.root!==sourceRoot||JSON.stringify(current.remote)!==sourceRemote)throw Error('Source workspace or execution host changed during upload');await validateSource?.(operation,input)})
 const sourceInfo=await downloadInfo(source)
 if(sourceInfo.bytes>2*1024*1024*1024)throw Error('Files must be at most 2 GiB')
 // A remote preflight yields; a concurrent retry may already have accepted this key.
 const accepted=readJson<Receipt|undefined>(location(id),()=>undefined)
 if(accepted){if(accepted.fingerprint!==fingerprint)throw Error('Upload request ID already used with different arguments');return publicJob(refresh(accepted))}
 conversationFileEndpoint(args.conversation,relative,true)
 if(((await sharedFileIO(conversationFileEndpoint(args.conversation,relative,true),'copy-info',{path:relative})).version??'missing')!==version)throw Error('Shared file changed during upload preflight')
 const parent=path.dirname(relative),destination=conversationFileEndpoint(args.conversation,parent==='.'?'.':parent,true),validateDestination=destination.validate
 const job:Receipt={id,owner:owner(),fingerprint,conversation:args.conversation,source:from,path:relative.split(path.sep).join('/'),publishedPath:WORKSPACE_FILE_PREFIX+relative.split(path.sep).join('/'),name:source.name,state:'preparing',bytes:0,totalBytes:0,createdAt:Date.now()}
 destination.replace=args.expectedVersion!==undefined
 destination.commit=input=>withCaller(context,async()=>{
  authorize('conversation.upload',args);await validateDestination?.('copy-commit',input)
  const current=conversationFileEndpoint(args.conversation,relative,true);if(current.root!==target.root)throw Error('Shared workspace identity changed')
  const stat=await sharedFileIO(current,'copy-info',{path:current.path}),stamp=stat.version??'missing'
  if(args.expectedVersion!==undefined?stamp!==args.expectedVersion:stamp!=='missing')throw Error('Shared file changed while uploading; the newer file was not overwritten')
  const staged=await sharedFileIO(current,'copy-info',{path:String(input.path)});if(!staged.regular||staged.symlink)throw Error('Choose a regular source file to upload')
  await sharedFileIO(current,args.expectedVersion!==undefined?'copy-replace':'copy-commit',{path:String(input.path),to:relative,...(args.expectedVersion!==undefined?{expectedVersion:args.expectedVersion}:{})})
  job.version=(await sharedFileIO(current,'copy-info',{path:current.path})).version;save(job);return {path:relative}
 })
 save(job)
 try{const transfer=startTransfer(from,{conversation:args.conversation,path:parent},source,destination);job.transferId=transfer.id;job.state=transfer.state;save(job)}
 catch(error){job.state='failed';job.error=(error as Error).message;save(job);throw error}
 void (async()=>{while(['queued','running'].includes(job.state)){await new Promise(r=>setTimeout(r,100));const current=getTransfer(job.transferId!);job.totalBytes=current.totalBytes;refresh(job)}})().catch(error=>console.error('[Shared upload receipt]',error.message))
 return publicJob(job)
}
