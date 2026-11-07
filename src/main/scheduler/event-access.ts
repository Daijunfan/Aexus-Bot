import {canReadEmployee} from '../employee-authority'
import {requireConversation} from '../conversation-policy'
import {catalog} from '../chat-group-store'
import {readStore} from '../store'
import {monitorRecord,canObserveMonitor} from '../script-monitors'
import type {ScheduleRule} from '../../shared/scheduler'
import type {PrincipalRef} from '../../shared/management'

/** The planner and the eventual target must both retain access to the event source. */
export function validateEventAccess(target:string,rule:ScheduleRule,principal:PrincipalRef){
 if(rule.kind!=='event')return
 for(const actor of [principal,{kind:'agent',employeeId:target} as PrincipalRef]){
  if(rule.event==='message.received'){
   const [kind,id]=rule.conversation!.split(':'),bot=catalog().groups.find(g=>g.id===id&&g.bot)
   if(kind==='group'||bot)requireConversation('group:'+id,'read',actor)
   else if(!readStore().sessions.some(c=>c.id===id&&!c.deleting)||!canReadEmployee(actor,id))throw Error('Private event source is outside your authorized employee scope')
  }
  if(rule.event==='session.completed'&&(!readStore().sessions.some(c=>c.id===rule.employeeId&&!c.deleting)||!canReadEmployee(actor,rule.employeeId!)))throw Error('Session event source is outside your authorized employee scope')
  if(rule.event.startsWith('monitor.')){
   const monitor=monitorRecord(rule.monitorId!)
   if(!monitor||!canObserveMonitor(monitor,actor))throw Error('Monitor event source is outside your authorized scope')
  }
 }
}
