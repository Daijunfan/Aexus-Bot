import type {Item,Block} from './types'

/** Private transport projection. Ordinary Core/CLI responses remain full snapshots. */
export const snapshotCommand=(command:string)=>command==='worker.snapshot'||command==='session.snapshot'
type BlockEdit={index:number;value:Block}|{index:number;append:{field:'text'|'result';text:string}}
type ItemEdit={index:number;value:Item}|{index:number;blocks:{length:number;edits:BlockEdit[]}}
export type SnapshotPacket={kind:'aexus-snapshot';version:1;token:string;data:Record<string,unknown>;full:Item[]}|{kind:'aexus-snapshot';version:1;token:string;data:Record<string,unknown>;base:string;length:number;edits:ItemEdit[]}
type Base={token:string;items:Item[];at:number}
const sameFields=(a:object,b:object,except:string)=>{const before=Object.keys(a).filter(key=>key!==except),after=Object.keys(b).filter(key=>key!==except);return before.length===after.length&&after.every(key=>Object.hasOwn(a,key)&&Object.is((a as any)[key],(b as any)[key]))}
function blockEdit(before:Block|undefined,next:Block,index:number):BlockEdit|undefined{
 if(before===next||before&&sameFields(before,next,''))return
 for(const field of ['text','result'] as const){const a=(before as any)?.[field],b=(next as any)[field];if(typeof a==='string'&&typeof b==='string'&&b.startsWith(a)&&before&&sameFields(before,next,field))return {index,append:{field,text:b.slice(a.length)}}}
 return {index,value:next}
}
function itemEdit(before:Item|undefined,next:Item,index:number):ItemEdit|undefined{
 if(before===next)return
 if(before?.role==='assistant'&&next.role==='assistant'&&sameFields(before,next,'blocks')){
  const edits=next.blocks.flatMap((block,index)=>{const edit=blockEdit(before.blocks[index],block,index);return edit?[edit]:[]})
  if(edits.length||before.blocks.length!==next.blocks.length)return {index,blocks:{length:next.blocks.length,edits}}
  return
 }
 return {index,value:next}
}

/** Bounded item references, scoped after authorization; metadata is never reused. */
export class SnapshotEncoder{
 private bases=new Map<string,Base>();private items=0
 constructor(private token:()=>string){}
 encode(scope:string,command:string,args:unknown,value:any,base?:string):unknown{
  if(!snapshotCommand(command)||!Array.isArray(value?.items))return value
  const key=JSON.stringify([scope,command,args]),now=Date.now(),previous=this.bases.get(key)
  this.prune()
  if(value.items.length===0||value.items.length>20000){this.remove(key);return value}
  const {items,...data}=value,token=this.token(),entry={token,items:items.slice(),at:now};this.remove(key);this.bases.set(key,entry);this.items+=entry.items.length
  while(this.bases.size>64||this.items>20000)this.remove(this.bases.keys().next().value!)
  if(previous&&now-previous.at<=60000&&previous.token===base)return {kind:'aexus-snapshot',version:1,token,data,base,length:items.length,edits:items.flatMap((item:Item,index:number)=>{const edit=itemEdit(previous.items[index],item,index);return edit?[edit]:[]})} satisfies SnapshotPacket
  return {kind:'aexus-snapshot',version:1,token,data,full:items} satisfies SnapshotPacket
 }
 private remove(key:string){const previous=this.bases.get(key);if(previous){this.items-=previous.items.length;this.bases.delete(key)}}
 prune(){const now=Date.now();for(const [key,entry] of this.bases)if(now-entry.at>60000)this.remove(key)}
 clear(){this.bases.clear();this.items=0}
}
const lostBase=()=>Object.assign(Error('Snapshot base is unavailable'),{code:'SNAPSHOT_BASE_MISSING'})
/** Internal consumers are immutable. Each read decodes against the base captured when it started. */
export class SnapshotDecoder{
 private bases=new Map<string,Base>()
 base(key:string){const value=this.bases.get(key);if(value&&Date.now()-value.at<=60000)return value;this.bases.delete(key)}
 decode<T>(key:string,value:any,base:Base|undefined,retain=true):T{
  if(value?.kind!=='aexus-snapshot'||value.version!==1){this.bases.delete(key);return value}
  const packet=value as SnapshotPacket;let items:Item[]
  if('full' in packet)items=packet.full
  else{
   if(!base||base.token!==packet.base)throw lostBase()
   items=packet.length===base.items.length&&!packet.edits.length?base.items:base.items.slice(0,packet.length)
   for(const edit of packet.edits){
    if('value' in edit)items[edit.index]=edit.value
    else{const previous=items[edit.index];if(previous?.role!=='assistant')throw lostBase();const blocks=previous.blocks.slice(0,edit.blocks.length);for(const change of edit.blocks.edits){if('value' in change)blocks[change.index]=change.value;else{const block=blocks[change.index],field=change.append.field;if(typeof (block as any)?.[field]!=='string')throw lostBase();blocks[change.index]={...block,[field]:(block as any)[field]+change.append.text} as Block}}blocks.length=edit.blocks.length;items[edit.index]={...previous,blocks}}
   }
   if(items!==base.items)items.length=packet.length
  }
  if(retain){this.prune();this.bases.delete(key);this.bases.set(key,{token:packet.token,items,at:Date.now()});while(this.bases.size>32)this.bases.delete(this.bases.keys().next().value!)}
  return {...packet.data,items} as T
 }
 clear(){this.bases.clear()}
 prune(){const now=Date.now();for(const [key,entry] of this.bases)if(now-entry.at>60000)this.bases.delete(key)}
}
