import {nonemptySchema,objectSchema} from './api-schema.ts'
export type BoardCategory={id:string;name:string;employeeIds:string[];workerIds:string[];revision:number}
export type BoardCategoryInput=Omit<BoardCategory,'revision'|'workerIds'>&{workerIds?:string[];expectedRevision:number}
const id={type:'string',pattern:'^bc_[a-zA-Z0-9_-]{1,100}$'},ids={type:'array',items:nonemptySchema,maxItems:5000},revision={type:'integer',minimum:0}
/** Presentation membership only; it never grants access or changes Team/task-view scope. */
export const BOARD_CATEGORY_COMMANDS=[
 {name:'board.categories',cli:[],args:'',summary:'User or Secretary: list saved Board categories without starting sessions or acknowledging messages',gui:'Board categories',inputSchema:objectSchema({})},
 {name:'board.category-save',cli:{positionals:['id'],aliases:{employeeIds:'employees',workerIds:'workers'}},args:'ID --name NAME --employees JSON [--workers JSON] --expected-revision N',summary:'Create or replace a Board category with an explicit multi-selection. expectedRevision=0 creates; unchanged retries are idempotent.',gui:'Create/edit Board category',inputSchema:objectSchema({id,name:{type:'string',minLength:1,maxLength:80},employeeIds:ids,workerIds:{...ids,description:'Native Worker members in the same Team board. Category membership never grants Worker access.'},expectedRevision:revision},['id','name','employeeIds','expectedRevision'])},
 {name:'board.category-delete',cli:{positionals:['id']},args:'ID --expected-revision N',summary:'Delete a Board category; retain employees, Workers, tasks and histories',gui:'Delete Board category',inputSchema:objectSchema({id,expectedRevision:revision},['id','expectedRevision'])},
 {name:'board.category-order',cli:{},args:'--order JSON --expected-order JSON',summary:'Reorder category tabs with optimistic concurrency; never reorder employees or Team geometry',gui:'Reorder Board categories',inputSchema:objectSchema({order:{type:'array',items:id},expectedOrder:{type:'array',items:id}},['order','expectedOrder'])}
]
