import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import type {ChatQuestion} from '../../../shared/chat-questions'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {Icon} from './Icon'
import {useDialogFocus} from '../office/useDialogFocus'

type Summary={employees:Record<string,{open:number;failed:number;supervisedOpen:number;supervisedFailed:number}>}
type State={missions:Summary['employees'];pending:Record<string,number>;refresh:()=>void;error:string}
const Context=createContext<State>({missions:{},pending:{},refresh:()=>{},error:''})
export const useCollaborationStatus=()=>useContext(Context)
export function CollaborationProvider({children}:{children:ReactNode}){
 const [missions,setMissions]=useState<Summary['employees']>({}),[pending,setPending]=useState<Record<string,number>>({}),[error,setError]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{let alive=true,timer:ReturnType<typeof setTimeout>|undefined;const load=()=>void Promise.allSettled([api.call<Summary>('mission.summary'),api.call<{pendingCounts:Record<string,number>}>('question.list',{status:'pending',limit:1})]).then(([missions,questions])=>{if(alive){const failures:string[]=[];if(missions.status==='fulfilled')setMissions(missions.value.employees);else failures.push(missions.reason.message);if(questions.status==='fulfilled')setPending(questions.value.pendingCounts);else failures.push(questions.reason.message);setError(failures.join('; '))}}).catch(cause=>{if(alive)setError(cause.message)});load();const off=api.onEvent(event=>{if(['mission:changed','question:changed','client:connected','store:changed'].includes(event.channel)&&!timer)timer=setTimeout(()=>{timer=undefined;load()},100)});return()=>{alive=false;off();clearTimeout(timer)}},[reload])
 return <Context.Provider value={{missions,pending,error,refresh:()=>setReload(value=>value+1)}}>{children}</Context.Provider>
}
export function MissionStatus({employee}:{employee:string}){
 const {missions}=useCollaborationStatus(),value=missions[employee]
 if(!value||!value.supervisedOpen&&!value.supervisedFailed)return null
 return <span className="mission-thread-status" aria-label={uiText('Supervised missions')}>
  {value.supervisedOpen>0&&<span className="mission-count pending" title={uiText('Unfinished missions')}><i/>{value.supervisedOpen}<span>{uiText('unfinished')}</span></span>}
  {value.supervisedFailed>0&&<span className="mission-count failed" title={uiText('Failed missions still need follow-up')}><i/>{value.supervisedFailed}<span>{uiText('need attention')}</span></span>}
 </span>
}
export function QuestionPendingBadge({conversation}:{conversation:string}){
 const count=useCollaborationStatus().pending[conversation]??0
 return count?<span className="question-pending-badge" aria-label={uiText('{0} pending decisions',[count])}><i/>{uiText('Pending')}{count>1&&<b>{count}</b>}</span>:null
}
export function ChatQuestionCard({id,fallback}:{id:string;fallback?:string}){
 const [question,setQuestion]=useState<ChatQuestion>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),[clock,setClock]=useState(Date.now()),guard=useRef(false)
 const key='aexus-question-draft:'+id,[draft,setDraft]=useState<{optionId:string;text:string}>(()=>{try{return JSON.parse(localStorage.getItem(key)||'null')??{optionId:'',text:''}}catch{return {optionId:'',text:''}}})
 useEffect(()=>{let alive=true;const load=()=>void api.call<ChatQuestion>('question.get',{id}).then(value=>{if(alive){setQuestion(value);setError('')}}).catch(cause=>{if(alive)setError(cause.message)});load();const off=api.onEvent(event=>{if(event.channel==='client:connected'||event.channel==='question:changed'&&(event.payload as any)?.id===id)load()});return()=>{alive=false;off()}},[id,reload])
 useEffect(()=>{if(question?.status!=='pending')return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[question?.status])
 useEffect(()=>{try{if(question&&question.status!=='pending'&&(!draft.text.trim()||draft.text.trim()===question.answer?.text))localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(draft))}catch{}},[key,draft,question?.status])
 const send=async()=>{if(!question||guard.current||!draft.optionId||draft.optionId==='other'&&!draft.text.trim())return;guard.current=true;setBusy(true);setError('');try{setQuestion(await api.call<ChatQuestion>('question.answer',{id,optionId:draft.optionId,...(draft.optionId==='other'&&draft.text.trim()?{text:draft.text.trim()}:{}),expectedRevision:question.revision}));if(draft.optionId!=='other')setDraft({optionId:draft.optionId,text:''})}catch(cause){setError((cause as Error).message);void api.call<ChatQuestion>('question.get',{id}).then(setQuestion).catch(()=>{})}finally{guard.current=false;setBusy(false)}}
 if(!question)return <section className="chat-question" data-question-id={id}><p>{fallback??uiText('Loading question…')}</p>{error&&<div role="alert">{error}<button onClick={()=>setReload(value=>value+1)}>{uiText('Retry')}</button></div>}</section>
 const pending=question.status==='pending',answer=question.answer,label=answer?.optionId==='other'?uiText('Other'):question.options.find(option=>option.id===answer?.optionId)?.label
 return <section className="chat-question" data-question-id={id} data-status={question.status} aria-busy={busy}>
  <header><span><Icon name={pending?'question':'check'}/>{uiText(pending?'Your decision is needed':question.status==='cancelled'?(question.closedReason==='mission-completed'?'Question no longer needed':'Question withdrawn'):question.status==='decided'?'Decided after timeout':'Your decision')}</span><small>{pending?question.deadline===null?uiText('Waiting for you'):uiText('{0}s remaining',[Math.max(0,Math.ceil((question.deadline-clock)/1000))]):new Date(answer?.at??question.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></header>
  <p className="question-prompt">{question.question}</p>
  {pending?<>
   <fieldset disabled={busy} aria-label={uiText('Answer options')}>
    {[...question.options,{id:'other',label:uiText('Other · write your answer')}].map(option=><label key={option.id} data-selected={draft.optionId===option.id}><input type="radio" name={'question-'+id} value={option.id} checked={draft.optionId===option.id} onChange={()=>setDraft(value=>({...value,optionId:option.id}))}/><span>{option.label}</span><Icon name={draft.optionId===option.id?'check':'circle-outline'}/></label>)}
   </fieldset>
   {draft.optionId==='other'&&<textarea aria-label={uiText('Your written answer')} placeholder={uiText('Describe what you want…')} value={draft.text} disabled={busy} onChange={event=>setDraft(value=>({...value,text:event.target.value}))} rows={3} maxLength={16000}/>}
   <footer><small>{question.deadline===null?uiText('This question waits for your explicit answer.'):uiText('If time runs out: {0}',[question.fallback?.optionId==='other'?question.fallback.text??uiText('Other'):question.options.find(option=>option.id===question.fallback?.optionId)?.label??''])}</small><button className="primary" disabled={busy||!draft.optionId||draft.optionId==='other'&&!draft.text.trim()} onClick={()=>void send()}><Icon name={busy?'loading':'check'}/>{uiText('Submit decision')}</button></footer>
  </>:answer?<div className="question-decision"><Icon name="check"/><span><strong>{label}</strong>{answer.text&&<p>{answer.text}</p>}</span></div>:null}
  {!pending&&draft.text.trim()&&draft.text.trim()!==question.answer?.text&&<div className="question-unsent-draft"><strong>{uiText('Unsubmitted text')}</strong><p>{uiText('This text was not submitted. You can copy it or discard it.')}</p><textarea aria-label={uiText('Retained written answer')} readOnly value={draft.text} rows={3}/><button onClick={()=>setDraft({optionId:'',text:''})}>{uiText('Discard draft')}</button></div>}
  {question.closedReason==='mission-completed'&&<p className="question-delivery-note">{uiText('The linked mission was completed. This question no longer needs an answer.')}</p>}
  {question.deliveryError&&<p className="question-delivery-note" role="status"><Icon name="info"/>{question.deliveryError}</p>}
  {error&&<div className="question-error" role="alert">{error}</div>}
 </section>
}
export function PendingQuestions({conversation}:{conversation:string}){
 const {pending}=useCollaborationStatus(),count=pending[conversation]??0,[open,setOpen]=useState(false),[questions,setQuestions]=useState<ChatQuestion[]>([]),[more,setMore]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useDialogFocus('.question-inbox',open)
 const load=async(append=false)=>{setBusy(true);setError('');try{const result=await api.call<{questions:ChatQuestion[];hasMore:boolean}>('question.list',{conversation,status:'pending',offset:append?questions.length:0,limit:50});setQuestions(previous=>append?[...previous,...result.questions]:result.questions);setMore(result.hasMore)}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{if(!open)return;void load();const off=api.onEvent(event=>{if(event.channel==='question:changed'&&(event.payload as any)?.conversation===conversation)void load()});const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false)}};window.addEventListener('keydown',key);return()=>{off();window.removeEventListener('keydown',key)}},[open,conversation])
 return <>
  {count>0&&<button className="question-pending-banner" onClick={()=>setOpen(true)}><span className="question-pending-icon"><Icon name="question"/></span><strong>{uiText('{0} pending decisions',[count])}</strong><span>{uiText('Review and choose')}</span><Icon name="chevron-right"/></button>}
  {open&&createPortal(<div className="question-inbox-overlay"><div className="question-inbox-backdrop" onClick={()=>setOpen(false)}/><section className="question-inbox" role="dialog" aria-modal="true" aria-label={uiText('Pending decisions')}><header><div><Icon name="question"/><h2>{uiText('Pending decisions')}</h2></div><button aria-label={uiText('Close pending decisions')} onClick={()=>setOpen(false)}><Icon name="close"/></button></header><div className="question-inbox-scroll">{questions.map(question=><ChatQuestionCard key={question.id} id={question.id}/>)}{!busy&&!questions.length&&!error&&<p className="question-inbox-empty"><Icon name="check-all"/>{uiText('All decisions handled')}</p>}{error&&<p role="alert">{error}<button onClick={()=>void load()}>{uiText('Retry')}</button></p>}{more&&<button disabled={busy} onClick={()=>void load(true)}>{uiText('Load more')}</button>}</div></section></div>,document.body)}
 </>
}

export function CollaborationHealth(){const {error,refresh}=useCollaborationStatus();return error?<button className="collaboration-health" aria-label={uiText('Collaboration status could not be synced. Retry.')} title={error} onClick={refresh}><Icon name="warning"/></button>:null}
