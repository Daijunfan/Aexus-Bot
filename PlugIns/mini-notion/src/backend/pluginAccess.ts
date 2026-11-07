import type {Workspace,Page} from '../types';
import {executeWorkspaceCommand} from '../core/commands';
import {diffWorkspace,applyWorkspacePatch} from '../core/patch';
import {isReadOnlyProperty} from '../database/propertySchema';
import {CommandError} from '../core/errors';
export type PageScope={employeeId:string;employeeName?:string;rootId?:string;grants:{resourceId:string;read:boolean;write:boolean;create:boolean}[]};
function deny(reason=''):never{throw new CommandError('PAGE_ACCESS_DENIED','页面未授权此操作；请让用户或 Secretary 调整阅读、修改或新增权限'+(reason?' ['+reason+']':''));}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function checkReferences(before:unknown,after:unknown,workspace:Workspace,scope:PageScope,key=''){
 if(same(before,after))return;
 if(typeof after==='string'&&!['id','title','text','name','description','caption','alt'].includes(key)&&workspace.pages.some(p=>p.id===after)&&!pageRights(workspace,scope,after)?.read&&!(key==='parentId'&&pageRights(workspace,scope,after)?.create))deny('reference');
 if(Array.isArray(after))after.forEach((value,index)=>checkReferences(Array.isArray(before)?before[index]:undefined,value,workspace,scope,key));
 else if(after&&typeof after==='object')for(const [field,value]of Object.entries(after))checkReferences(before&&typeof before==='object'?(before as any)[field]:undefined,value,workspace,scope,field);
}
export function pageResources(workspace:Workspace|null){
 const pages=workspace?.pages??[];
 return [{id:'@root',title:'顶层页面',kind:'root',capabilities:['create']},...pages.filter(p=>!p.trashedAt&&!p.syncedSource).map(p=>({id:p.id,active:workspace?.activePageId===p.id,title:p.title||'Untitled',kind:p.database?'database':pages.find(parent=>parent.id===p.parentId)?.database?'record':'page',parentId:p.parentId??'@root',...(pages.find(parent=>parent.id===p.parentId)?.database?{inheritFrom:p.parentId}:{}),capabilities:['read','write','create']}))];
}
export function pageRights(workspace:Workspace,scope:PageScope,id:string){
 const direct=scope.grants.find(g=>g.resourceId===id);if(direct)return direct;if(id===scope.rootId)return scope.grants.find(g=>g.resourceId==='@root');
 const page=workspace.pages.find(p=>p.id===id),database=workspace.pages.find(p=>p.id===page?.parentId&&p.database);
 return database?scope.grants.find(g=>g.resourceId===database.id):undefined;
}
export function pageProjection(workspace:Workspace,scope:PageScope):Workspace{
 const pages=workspace.pages.filter(p=>pageRights(workspace,scope,p.id)?.read);
 return {version:1,name:workspace.name,revision:workspace.revision,pages:structuredClone(pages),activePageId:null,expanded:[],recent:[],spaces:{},people:[],uniqueIds:Object.fromEntries(Object.entries(workspace.uniqueIds??{}).filter(([id])=>pages.some(p=>p.id===id))),settings:{authorName:scope.employeeName??scope.employeeId,theme:'system',sidebarWidth:240,sidebarHidden:false,spellcheck:true}};
}
export function checkPageChanges(before:Workspace,next:Workspace,scope:PageScope){
 const changes=diffWorkspace(before,next).pages,created:{id:string;parentId:string}[]=[],newIds=new Set<string>();
 for(const change of changes){
  if(!change.after||change.after.trashedAt!==change.before?.trashedAt&&!!change.after.trashedAt)deny();
  checkReferences(change.before,change.after,before,scope);
  if(change.before){
   if(!pageRights(before,scope,change.id)?.write){
    const allowed=pageRights(before,scope,change.id)?.read,fields=new Set(Object.keys({...change.before,...change.after}).filter(k=>!same((change.before as any)[k],(change.after as any)[k])));
    const database=before.pages.find(p=>p.id===change.before!.parentId)?.database,derived=new Set(database?.columns.filter(isReadOnlyProperty).map(p=>p.id));
    const keys=new Set(Object.keys({...change.before.values,...change.after.values}));
    if(!allowed||[...fields].some(f=>!['updatedAt','values'].includes(f))||[...keys].some(k=>!same(change.before!.values[k],change.after!.values[k])&&!derived.has(k)))deny('modify:'+change.id+':'+[...fields].join(','));
   }
   if(change.after.parentId!==change.before.parentId&&!pageRights(before,scope,change.after.parentId??'@root')?.create)deny();
   if(change.after.space!==change.before.space)deny();
  }else{
   const parent=change.after.parentId??'@root',right=pageRights(before,scope,parent);
   if(!right?.create&&!newIds.has(parent))deny('create:'+parent);
   created.push({id:change.id,parentId:newIds.has(parent)?parent:right!.resourceId});newIds.add(change.id);
  }
 }
 return created;
}
export async function executePageAccess(workspace:Workspace,scope:PageScope,method:string,params:Record<string,any>,markdown:(workspace:Workspace,method:string,params:Record<string,any>)=>Promise<{workspace?:Workspace;result:any}|undefined>):Promise<{workspace:Workspace;result:any;created:{id:string;parentId:string}[]}>{
 if(method==='batch'){
  if(!Array.isArray(params.operations))deny();let next=workspace;const results=[],created=[];
  for(const operation of params.operations){const value=await executePageAccess(next,scope,operation.method,operation.params??{},markdown);next=value.workspace;results.push(value.result);for(const item of value.created){scope.grants.push({resourceId:item.id,read:true,write:true,create:true});created.push(item);}}
  return {workspace:next,result:results,created};
 }
 if(!/^(page|block|database|record|form|view|property|template|comment|synced|relation|subitem|dependency)\./.test(method)&&!['schema','search','workspace.get'].includes(method))deny();
 const projected=pageProjection(workspace,scope);if(scope.rootId&&['page.create','database.create'].includes(method)&&(!params.parentId||params.parentId==='root')){const root=workspace.pages.find(p=>p.id===scope.rootId);if(root&&!projected.pages.some(p=>p.id===root.id))projected.pages.push({...structuredClone(root),title:'Workspace',blocks:[],files:[],values:{}});params={...params,parentId:scope.rootId};}const operation=['page.read-markdown','page.write-markdown'].includes(method)?await markdown(projected,method,params):executeWorkspaceCommand(projected,method,params);
 if(!operation)deny();
 if(!operation.workspace||same(operation.workspace,projected))return {workspace,result:operation.result,created:[]};
 const changes=diffWorkspace(projected,operation.workspace);if(changes.pages.some(p=>!p.before&&workspace.pages.some(existing=>existing.id===p.id)))deny();checkPageChanges(projected,operation.workspace,scope);
 const unique=operation.workspace.uniqueIds;
 const next=applyWorkspacePatch(workspace,{id:changes.id,pages:changes.pages});
 if(unique)next.uniqueIds={...workspace.uniqueIds,...unique};
 return {workspace:next,result:operation.result,created:checkPageChanges(workspace,next,scope)};
}
