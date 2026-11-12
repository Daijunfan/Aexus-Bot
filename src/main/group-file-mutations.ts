import path from 'node:path'
import fs from 'node:fs'
import {atomicJson,readJson} from './atomic-file'
import {catalog,directory,historyFile,indexFile,messages,emitChatChange} from './chat-group-store'
import type {ChatMessage} from '../shared/chat-groups'

const pending=new Map<string,Promise<unknown>>()
/** Serialize only attachment publication and file moves in the same group. Native work stays concurrent. */
export function withGroupFileMutation<T>(conversation:string,work:()=>Promise<T>):Promise<T>{
 const prior=pending.get(conversation)??Promise.resolve(),next=prior.catch(()=>{}).then(work)
 pending.set(conversation,next);void next.finally(()=>{if(pending.get(conversation)===next)pending.delete(conversation)}).catch(()=>{})
 return next
}

/** A rename changes attachment locations, never authors, text, tasks, message IDs or read receipts. */
export function moveGroupFileReferences(id:string,from:string,to:string,resolve:(value:string)=>string=value=>value){
 const changed=new Set<string>(),rebase=(message:ChatMessage):ChatMessage=>{
  let updated=false
  const attachments=message.attachments?.map(file=>{
   if(!file.path.startsWith('@workspace/'))return file
   const current=resolve(file.path.slice(11))
   if(current!==from&&!current.startsWith(from+'/'))return file
   const next=to+current.slice(from.length);updated=true
   return {...file,path:'@workspace/'+next,name:path.posix.basename(next)}
  })
  if(!updated)return message
  changed.add(message.id);return {...message,attachments}
 }
 const original=messages(id),next=original.map(rebase),removedFile=path.join(directory,id+'-removed.json')
 const removed=readJson<Record<string,{message:ChatMessage}>>(removedFile,()=>({})),nextRemoved=Object.fromEntries(Object.entries(removed).map(([key,value])=>[key,{...value,message:rebase(value.message)}]))
 if(!changed.size)return
 const store=catalog(),nextStore={...store,groups:store.groups.map(group=>{
  const last=next.at(-1);if(group.id!==id||!last||!changed.has(last.id)||last.text||last.deletedAt)return group
  return {...group,revision:group.revision+1,updatedAt:Date.now(),lastMessage:{...group.lastMessage!,text:(last.attachments??[]).map(file=>file.name).join(', ').slice(0,240)}}
 })}
 const files:[string,unknown,unknown][]=[]
 if(next.some((message,index)=>message!==original[index]))files.push([historyFile(id),original,next])
 if(fs.existsSync(removedFile)&&JSON.stringify(removed)!==JSON.stringify(nextRemoved))files.push([removedFile,removed,nextRemoved])
 if(nextStore.groups.some((group,index)=>group!==store.groups[index]))files.push([indexFile,store,nextStore])
 const written:typeof files=[]
 try{for(const item of files){atomicJson(item[0],item[2],true);written.push(item)}}catch(error){for(const [file,previous]of written.reverse())atomicJson(file,previous,true);throw error}
 for(const messageId of changed)emitChatChange(id,messageId,undefined,'metadata')
}
