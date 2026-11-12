import {unified} from 'unified'
import remarkParse from 'remark-parse'

type Node={type:string;url?:string;alt?:string;identifier?:string;children?:Node[];position?:{start:{offset?:number};end:{offset?:number}}}
const parser=unified().use(remarkParse)
export function messageImageIndex(url:string){const match=/^attachment:([1-9]\d*)$/i.exec(url);if(!match)return;const index=Number(match[1])-1;return Number.isSafeInteger(index)?index:undefined}
function imageNodes(text:string,strict=false){
 if(!/attachment:/i.test(text))return []
 const root=parser.parse(text) as Node,definitions=new Map<string,string>(),images:Node[]=[]
 const visit=(node:Node)=>{if(node.type==='definition'&&node.identifier&&node.url)definitions.set(node.identifier,node.url);if(node.type==='image'||node.type==='imageReference')images.push(node);node.children?.forEach(visit)};visit(root)
 return images.map(node=>{const url=node.url??definitions.get(node.identifier??'')??'',index=messageImageIndex(url);if(strict&&/^attachment:/i.test(url)&&index===undefined)throw Error('Use attachment:1, attachment:2 and so on; image numbering starts at 1');return {node,index}}).filter((item):item is {node:Node;index:number}=>item.index!==undefined)
}
export const messageImageIndices=(text:string)=>new Set(imageNodes(text).map(item=>item.index))
export function messageImageLabels(text:string,count:number){const captions=new Map<number,string>();for(const {node,index} of imageNodes(text))if(!captions.has(index))captions.set(index,node.alt??'');return Array.from({length:count},(_,index)=>captions.size?captions.get(index)??'':text)}
export function validateMessageImages(text:string,count:number){for(const {index} of imageNodes(text,true))if(index>=count)throw Error('Inline image attachment:'+(index+1)+' has no matching images entry; use the distinct published image order, starting at 1')}
/** Forwarded images keep their positions; text-only forwards retain the image caption. */
export function remapMessageImages(text:string,offset:number|null){
 const edits=imageNodes(text).map(({node,index})=>{const start=node.position?.start.offset,end=node.position?.end.offset;if(start===undefined||end===undefined)return;return {start,end,value:offset===null?(node.alt??''):'!['+(node.alt??'').replace(/[\[\]\\]/g,'\\$&')+'](attachment:'+(index+offset+1)+')'}}).filter((value):value is {start:number;end:number;value:string}=>!!value)
 for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.value+text.slice(edit.end)
 return text
}
