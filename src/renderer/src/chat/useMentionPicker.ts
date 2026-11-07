import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react'

export type MentionRange={start:number;end:number;query:string}
type MentionMember={id:string;title:string}
export const mentionLabels=(targets:string[]|'all',members:readonly MentionMember[])=>targets==='all'?['all',...members.map(member=>member.title)]:members.filter(member=>targets.includes(member.id)).map(member=>member.title)
/** Visible tags retain the already selected stable IDs; deleting a tag removes its target. */
export function mentionTargets(text:string,targets:string[]|'all',members:readonly MentionMember[]):string[]|'all'{
 const present=new Set<string>()
 for(const match of text.matchAll(/[@＠]/g)){
  const tail=text.slice(match.index!+1)
  if(/^all(?:$|[\s,.!?，。！？、:：;；])/i.test(tail))return 'all'
  const matches=members.filter(member=>tail.startsWith(member.title)),length=Math.max(0,...matches.map(member=>member.title.length))
  for(const member of matches)if(member.title.length===length)present.add(member.id)
 }
 return (targets==='all'?members.map(member=>member.id):targets).filter(id=>present.has(id))
}
/** Match only the text before the caret; the rest of a draft is never part of the query. */
export function mentionAt(value:string,start:number,end=start):MentionRange|null{
 if(start!==end||start<0||start>value.length)return null
 const before=value.slice(0,start),at=Math.max(before.lastIndexOf('@'),before.lastIndexOf('＠'))
 if(at<0)return null
 const query=before.slice(at+1)
 return /[\r\n\t@＠]/.test(query)?null:{start:at,end:start,query}
}

/** Mentions are inserted at the caret; routing keeps its separate stable employee IDs. */
export function useMentionPicker(input:RefObject<HTMLTextAreaElement|null>,value:string,completedLabels:readonly string[]=[]){
 const [range,setRange]=useState<MentionRange|null>(null),[manual,setManual]=useState(false),[index,setIndex]=useState(0)
 const observed=useRef(''),composing=useRef(false),restore=useRef<number|null>(null),completed=useRef(completedLabels);completed.current=completedLabels
 const signature=(el:HTMLTextAreaElement)=>JSON.stringify([el.value,el.selectionStart,el.selectionEnd])
 const close=()=>{if(input.current)observed.current=signature(input.current);setRange(null);setManual(false);setIndex(0)}
 const sync=(el:HTMLTextAreaElement)=>{
  if(composing.current)return
  const next=signature(el);if(observed.current===next)return
  observed.current=next;setManual(false);setIndex(0)
  const range=mentionAt(el.value,el.selectionStart,el.selectionEnd)
  setRange(range&&completed.current.some(label=>range.query===label||range.query.startsWith(label)&&/^[\s,.!?，。！？、:：;；]/.test(range.query.slice(label.length)))?null:range)
 }
 useEffect(()=>{
  const el=input.current;if(!el)return
  const selected=()=>{if(document.activeElement===el)sync(el)}
  el.addEventListener('select',selected);document.addEventListener('selectionchange',selected)
  return()=>{el.removeEventListener('select',selected);document.removeEventListener('selectionchange',selected)}
 },[input])
 const consume=(label='')=>{
  const start=range?.start??input.current?.selectionStart??value.length,end=range?.end??input.current?.selectionEnd??start,tag=label?'@'+label+' ':''
  const next=value.slice(0,start)+tag+value.slice(end)
  restore.current=start+tag.length
  close();return next
 }
 useLayoutEffect(()=>{
  if(restore.current===null||!input.current)return
  const caret=restore.current;restore.current=null;input.current.focus();input.current.setSelectionRange(caret,caret)
  observed.current=signature(input.current)
 },[value,range,manual])
 const toggle=()=>{
  if(range||manual){close();return}
  input.current?.focus();setIndex(0);setRange(null);setManual(true)
  if(input.current)observed.current=signature(input.current)
 }
 return {open:!!range||manual,active:!!range,query:range?.query.toLocaleLowerCase()??'',index,setIndex,close,sync,consume,toggle,
  inputProps:{
   onSelect:(event:{currentTarget:HTMLTextAreaElement})=>sync(event.currentTarget),
   onCompositionStart:()=>{composing.current=true;close()},
   onCompositionEnd:(event:{currentTarget:HTMLTextAreaElement})=>{composing.current=false;observed.current='';sync(event.currentTarget)}
  }
 }
}
