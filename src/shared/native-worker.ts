import {objectSchema,nonemptySchema} from './api-schema.ts'
import type {Engine} from './types'

/** A native CLI has no employee identity, role, onboarding or Company transcript. */
export type NativeWorker={id:string;employee:string;title:string;engine:Engine;cwd:string;host?:string;createdAt:string;running:boolean;terminal?:string;exitCode?:number}
const id={id:nonemptySchema},size={cols:{type:'integer',minimum:2,maximum:500},rows:{type:'integer',minimum:2,maximum:300}}
export const WORKER_COMMANDS=[
 {name:'worker.create',args:'[--employee ID] --engine codex|claude|cline|pi|opencode|kilo [--title NAME --cwd PATH]',summary:'Create a native Worker owned by yourself (user supplies employee); no inference, role prompt or Company tools',gui:'Employee profile / Workers',inputSchema:objectSchema({employee:nonemptySchema,engine:{enum:['codex','claude','cline','pi','opencode','kilo']},title:nonemptySchema,cwd:nonemptySchema},['engine'])},
 {name:'worker.list',args:'[--employee ID]',summary:'List directly owned native Workers (user/Secretary may administer all); user and Secretary may list all',gui:'Workers',inputSchema:objectSchema({employee:nonemptySchema})},
 {name:'worker.start',args:'ID [--cols N --rows N]',summary:'Open the native CLI with its own configuration and no injected task; does not resume an old conversation automatically',gui:'Open native Worker',cli:{positionals:['id']},inputSchema:objectSchema({...id,...size},['id'])},
 {name:'worker.read',args:'ID [--cursor N --wait-ms N]',summary:'Read native terminal output; optional wait up to 15000ms',gui:'Native terminal',cli:{positionals:['id']},inputSchema:objectSchema({...id,cursor:{type:'integer',minimum:0},waitMs:{type:'integer',minimum:0,maximum:15000}},['id'])},
 {name:'worker.input',args:'ID --data TEXT|--file PATH [--enter]',summary:'Send literal native CLI input or a task; no Company prompt wrapping',gui:'Native terminal input',inputSchema:objectSchema({...id,data:{type:'string'}},['id','data'])},
 {name:'worker.resize',args:'ID --cols N --rows N',summary:'Resize the native terminal',gui:'Native terminal size',cli:{positionals:['id']},inputSchema:objectSchema({...id,...size},['id','cols','rows'])},
 {name:'worker.interrupt',args:'ID',summary:'Send Ctrl-C to the native CLI; native approval and task semantics apply',gui:'Interrupt Worker',cli:['id'],inputSchema:objectSchema(id,['id'])},
 {name:'worker.stop',args:'ID',summary:'Stop the native CLI process; retain Worker record, work files and native history',gui:'Stop Worker',cli:['id'],inputSchema:objectSchema(id,['id'])},
 {name:'worker.remove',args:'ID',summary:'Stop and remove your Worker record; preserve work files, engine configuration, authentication and native history',gui:'Remove Worker',cli:['id'],inputSchema:objectSchema(id,['id'])}
]
