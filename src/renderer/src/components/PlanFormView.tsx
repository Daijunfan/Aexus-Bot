import {translate as uiText,useI18n,interfaceLocale} from '../i18n'
import {useEffect,useRef,useState} from 'react'
import type {Store} from '../../../shared/types'
import type {Mission} from '../../../shared/missions'
import type {ScheduledJob} from '../../../shared/scheduler'
import {PlanEditor} from './PlanEditor'
import {Icon} from './Icon'
import '../styles/plan-insights.css'

/** A real creation surface sharing the editor's validation, authority and retry key. */
export function PlanFormView({store,timezone,onOpen,onConversation,onDirtyChange}:{store:Store;timezone:string;onOpen:(id:string)=>void;onConversation:(id:string)=>void;onDirtyChange?:(dirty:boolean)=>void}){
  useI18n()
  const [revision,setRevision]=useState(0),[created,setCreated]=useState<ScheduledJob|null>(null),[createdMission,setCreatedMission]=useState<Mission|null>(null),success=useRef<HTMLDivElement>(null)
  const employees=store.sessions.filter(card=>!card.deleting).length
  useEffect(()=>{const node=success.current;if((created||createdMission)&&node&&!node.closest('[hidden]')){node.focus({preventScroll:true});node.scrollIntoView({block:'nearest',behavior:'instant'})}},[created,createdMission])
  return <section className="plan-form-view plan-insights" aria-label={uiText('Task intake form')}>
    <aside className="plan-form-intro"><span className="plan-form-symbol"><Icon name="calendar"/></span><h2>{uiText('New task')}</h2><p>{uiText('Define the result, responsibility and execution timing in one task form.')}</p><dl className="plan-form-context"><div><dt>{uiText('Available employees')}</dt><dd>{employees}</dd></div><div><dt>{uiText('Default time zone')}</dt><dd>{timezone}</dd></div></dl>{!employees&&<p className="plan-form-no-employees" role="status"><Icon name="person"/>{uiText('Add an employee in Team to create a task.')}</p>}</aside>
    <div className="plan-form-content">{createdMission&&<div className="plan-form-success" ref={success} tabIndex={-1} role="status"><Icon name="check"/><div><strong>{uiText("Task created:")} {createdMission.name}</strong><p>{uiText("Reminders continue until success is explicitly confirmed.")}</p><button onClick={()=>onOpen(createdMission.id)}>{uiText("Open task details")}<Icon name="arrow-right"/></button></div></div>}{created&&<div className="plan-form-success" ref={success} tabIndex={-1} role="status"><Icon name="check"/><div><strong>{uiText('Task created:')} {created.name}</strong><p>{created.enabled?uiText('Automatic scheduling enabled'):uiText('Created paused')} · {created.nextAt?<time dateTime={created.nextAt}>{new Date(created.nextAt).toLocaleString(interfaceLocale(),{timeZone:timezone})}</time>:uiText(created.rule.kind==='event'&&created.enabled?'Waiting for event':'No future occurrence')}</p><details><summary>{uiText('Schedule details')}</summary><code>{created.id}</code></details><button onClick={()=>onOpen(created.id)}>{uiText('Open task details')}<Icon name="arrow-right"/></button></div></div>}
      <PlanEditor unified key={revision} inline retainOnPlanNavigation store={store} timezone={timezone} onDirtyChange={onDirtyChange} onClose={()=>{setRevision(value=>value+1);setCreated(null);setCreatedMission(null)}} onMissionSaved={mission=>{setCreated(null);setCreatedMission(mission);setRevision(value=>value+1)}} onSaved={job=>{if(job){setCreatedMission(null);setCreated(job);setRevision(value=>value+1)}}} onConversation={onConversation}/>
    </div>
  </section>
}
