import {randomUUID} from 'node:crypto'
import type {RequestContext} from '../shared/management'
import type {ChannelFetchPage} from '../shared/channel-fetch'
import {apiError,API_REVISION} from './api-contract'

// Continuations of an already delivered, authenticated response; never a public resource cache.
const results=new Map<string,{owner:string;text:string;bytes:number;expires:number;command:string}>()
const TTL=15*60_000,MAX_BYTES=64*1024*1024,PAGE=12_000
const owner=(context:RequestContext)=>JSON.stringify([context.principal,context.credentialHash??null,context.clientId??null])
function prune(){for(const [id,result] of results)if(result.expires<=Date.now())results.delete(id)}
function page(id:string,result:{text:string;command:string},offset:number,limit:number,path?:unknown){
 let end=Math.min(result.text.length,offset+limit)
 const makePage=()=>({kind:'api-result-page',id,sourceCommand:result.command,apiRevision:API_REVISION,totalCharacters:result.text.length,offset,nextOffset:end<result.text.length?end:null,content:result.text.slice(offset,end),...(path===undefined?{}:{path}),
  guidance:'The source operation already completed. Read this response; do not repeat a write. Concatenate content pages to recover the complete JSON. path selects a JSON Pointer from the original response.',
  ...(end>=result.text.length?{}:{nextCall:{command:'api.result',args:{id,offset:end,...(path===undefined?{}:{path})}}})})
 // Account for JSON escaping too: tool outputs can contain dense quotes/backslashes.
 let value=makePage()
 while(JSON.stringify({ok:true,data:value}).length>18_000){end=offset+Math.floor((end-offset)*0.75);value=makePage()}
 return value
}
export function boundedApiResult(context:RequestContext,command:string,value:unknown):unknown{
 const result=value as {data?:ChannelFetchPage},channel=result?.data
 if(channel?.kind==='channel-messages'&&channel.mode==='images'){
  // Page the text metadata separately while nativeToolResult still emits every original image.
  const metadata={...result,data:{...channel,messages:channel.messages.map(message=>({...message,images:message.images?.map(({data,...image})=>image)}))}}
  const bounded=boundTextResult(context,command,metadata)
  return bounded===metadata?value:{...result,nativeMetadata:bounded}
 }
 return boundTextResult(context,command,value)
}
function boundTextResult(context:RequestContext,command:string,value:unknown){
 const text=JSON.stringify(value)
 if(text.length<=18_000)return value
 prune()
 const bytes=Buffer.byteLength(text),id=randomUUID()
 let total=[...results.values()].reduce((n,value)=>n+value.bytes,0)
 for(const [key,result] of results){if(total+bytes<=MAX_BYTES&&results.size<32)break;results.delete(key);total-=result.bytes}
 // A completed write must still be reported as completed even if its exceptionally large reply cannot be retained.
 if(bytes>MAX_BYTES)return {ok:true,data:{kind:'api-result-too-large',sourceCommand:command,apiRevision:API_REVISION,totalCharacters:text.length,guidance:'The operation completed. Its response exceeds 64 MiB; inspect with a narrower read query. Do not repeat the write.'}}
 const result={owner:owner(context),text,bytes,expires:Date.now()+TTL,command};results.set(id,result)
 return {ok:true,data:page(id,result,0,PAGE)}
}
export function readApiResult(context:RequestContext,args:Record<string,unknown>){
 prune()
 const result=results.get(String(args.id))
 if(!result||result.owner!==owner(context))throw apiError('RESULT_UNAVAILABLE','api.result','Result expired, belongs to another caller or was cleared by restart. Repeat a read query if needed; inspect receipts before retrying a write.')
 let text=result.text
 if(args.path!==undefined){
  const pointer=String(args.path)
  if(pointer!==''&&!pointer.startsWith('/'))throw Error('path must be a JSON Pointer, e.g. /data/items')
  let value=JSON.parse(text)
  for(const key of pointer===''?[]:pointer.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'))){
   if(!value||typeof value!=='object'||!Object.hasOwn(value,key))throw Error('Result path does not exist; inspect its parent first')
   value=value[key]
  }
  text=JSON.stringify(value)
 }
 const offset=args.offset===undefined?0:Number(args.offset),limit=args.limit===undefined?PAGE:Number(args.limit)
 if(!Number.isInteger(offset)||offset<0||offset>text.length||!Number.isInteger(limit)||limit<1||limit>PAGE)throw Error('Choose offset 0..totalCharacters and limit 1..12000')
 return page(String(args.id),{text,command:result.command},offset,limit,args.path)
}
