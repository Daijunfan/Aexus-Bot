import type {ChannelFetchPage} from '../shared/channel-fetch'

/** MCP and Pi use the same native text/image blocks; base64 never becomes model-visible prose. */
export function nativeToolResult(value:unknown){
 const result=value as {ok?:boolean;data?:ChannelFetchPage;nativeMetadata?:unknown},page=result?.data
 if(result?.ok!==true||page?.kind!=='channel-messages'||page.mode!=='images')return {content:[{type:'text' as const,text:JSON.stringify(value)}]}
 const metadata=result.nativeMetadata??{...result,data:{...page,messages:page.messages.map(message=>({...message,images:message.images?.map(({data,...image})=>image)}))}}
 const content:({type:'text';text:string}|{type:'image';data:string;mimeType:string})[]=[{type:'text',text:JSON.stringify(metadata)}]
 for(const message of page.messages)for(const image of message.images??[])content.push({type:'text',text:`Message ${message.id}, image ${image.id}`},{type:'image',data:image.data,mimeType:image.mimeType})
 return {content}
}
