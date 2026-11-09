import {useEffect,useRef,useState} from 'react'
import type {PlanRow} from '../../../shared/plan'
import {api} from '../api'
import {translate as t} from '../i18n'
import {Icon} from './Icon'

/** Use the existing revision-checked operations; a partial batch is never reported as atomic. */
export function PlanBatchActions({rows,selected,onSelect,onClose,onRefresh,onBusy}:{rows:PlanRow[];selected:PlanRow[];onSelect:(rows:PlanRow[])=>void;onClose:()=>void;onRefresh:()=>void;onBusy:(busy:boolean)=>void}){
 const [progress,setProgress]=useState<number|null>(null),[report,setReport]=useState<{done:number;errors:{id:string;name:string;error:string}[]}|null>(null),alive=useRef(true),running=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;onBusy(false)}},[onBusy])
 const allowed=(operation:'pause'|'resume'|'archive'|'restore')=>selected.length>0&&selected.every(row=>operation==='archive'||operation==='restore'?(!!row.archivedAt===(operation==='restore'))&&row.allowedActions?.includes(row.mission?'mission.archive':'schedule.pause'):!row.mission&&row.enabled===(operation==='pause')&&row.status!=='completed'&&row.allowedActions?.includes('schedule.'+operation))
 const run=async(operation:'pause'|'resume'|'archive'|'restore')=>{
  if(running.current||!allowed(operation))return
  running.current=true;onBusy(true);setProgress(0);setReport(null)
  const errors:{id:string;name:string;error:string}[]=[],snapshot=[...selected];let done=0
  for(const row of snapshot){if(!alive.current)break;try{await api.call(operation==='archive'||operation==='restore'?'plan.archive':'schedule.'+operation,{id:row.id,expectedRevision:row.revision??0,...(operation==='archive'||operation==='restore'?{archived:operation==='archive'}:{})});done++}catch(cause){errors.push({id:row.id,name:row.name,error:(cause as Error).message})}if(alive.current)setProgress(done+errors.length)}
  running.current=false
  if(alive.current){onBusy(false);setProgress(null);setReport({done,errors});onSelect(snapshot.filter(row=>errors.some(error=>error.id===row.id)));onRefresh()}
 }
 const busy=progress!==null,pageSelected=rows.length>0&&rows.every(row=>selected.some(item=>item.id===row.id))
 return <section className="plan-batch" aria-label={t('Selected tasks')} aria-busy={busy}>
  <div className="plan-batch-toolbar"><div className="plan-batch-summary"><strong>{t('{0} selected',[selected.length])}</strong><span>{t('Current page')}</span></div><button type="button" disabled={busy||!rows.length} onClick={()=>{setReport(null);onSelect(pageSelected?[]:rows)}}><Icon name="check-all"/>{t(pageSelected?'Deselect page':'Select page')}</button><div className="plan-batch-actions">{([['pause','debug-pause','Pause schedules'],['resume','play','Resume schedules'],['archive','archive','Archive tasks'],['restore','history','Restore tasks']] as const).map(([operation,icon,label])=><button type="button" key={operation} disabled={busy||!allowed(operation)} title={t(operation==='pause'||operation==='resume'?'Select schedules with the same enabled state. Missions require explicit success.':'Archiving changes visibility. Work and reminders continue.')} onClick={()=>void run(operation)}><Icon name={icon}/>{t(label)}</button>)}</div><button type="button" className="plan-batch-close" disabled={busy} aria-label={t('Finish selecting tasks')} onClick={onClose}><Icon name="close"/></button></div>
  <p>{t('Pausing affects future occurrences. Archiving keeps work and reminders running.')}</p>
  {busy&&<div role="status">{t('Applying {0} of {1} tasks…',[progress,selected.length])}</div>}
  {report&&<div className="plan-batch-report" role={report.errors.length?'alert':'status'}><strong>{t('{0} updated · {1} failed',[report.done,report.errors.length])}</strong>{report.errors.length>0&&<><p>{t('Successful changes are kept. Select changed tasks again after reviewing their latest details.')}</p><ul tabIndex={0} aria-label={t('Failed task changes')}>{report.errors.map(error=><li key={error.id}><b>{error.name}</b><span>{t(error.error)}</span></li>)}</ul></>}</div>}
 </section>
}
