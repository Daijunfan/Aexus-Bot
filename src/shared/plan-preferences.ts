import {objectSchema} from './api-schema.ts'
import {PLAN_FILTER_SCHEMA} from './plan-schema.ts'
import type {PlanFilter} from './plan'
export type RetentionRule={action:'keep'|'archive'|'delete';afterSeconds:number}
export type PlanPreferences={revision:number;filter:PlanFilter;hiddenIds:string[];retention:{succeeded:RetentionRule;failed:RetentionRule}}
const retentionRule=objectSchema({action:{enum:['keep','archive','delete']},afterSeconds:{type:'integer',minimum:0,maximum:31536000}},['action','afterSeconds'])
export const PLAN_PREFERENCE_COMMANDS=[
 {cli:{},name:'plan.preferences',args:'[--patch JSON --expected-revision N]',summary:'User/Secretary: read or update Mission-wide display filters, hidden task IDs and automatic retention. Display filtering does not pause work. Failed unresolved missions may be archived but never automatically deleted.',inputSchema:objectSchema({patch:objectSchema({filter:PLAN_FILTER_SCHEMA,hiddenIds:{type:'array',uniqueItems:true,items:{type:'string',minLength:1}},retention:objectSchema({succeeded:retentionRule,failed:retentionRule},['succeeded','failed'])}),expectedRevision:{type:'integer',minimum:1}})},
 {cli:{},name:'plan.archive',args:'--id ID --archived true|false --expected-revision N',summary:'Archive or restore an authorized saved schedule or mission. Archiving is a display action and never stops reminders or scheduled work.',inputSchema:objectSchema({id:{type:'string',minLength:1},archived:{type:'boolean'},expectedRevision:{type:'integer',minimum:1}},['id','archived','expectedRevision'])}
].map(command=>({...command,gui:'Mission / global filter and retention'}))
