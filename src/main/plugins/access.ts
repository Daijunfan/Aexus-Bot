import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {APP_HOME} from '../../shared/protocol'
import type {PluginGrant,PluginScope,PluginResource,PluginCreatedResource} from '../../shared/plugin-access'
import {atomicJson,readJson} from '../atomic-file'
import {requireAppAdministrator} from '../application-authority'
import {readStore} from '../store'

type Entry={plugin:string;workspace:string;revision:number;grants:PluginGrant[]}
const file=path.join(APP_HOME,'plugin-access.json')
const canonical=(root:string)=>fs.existsSync(root)?fs.realpathSync(root):path.resolve(root)
const key=(id:string,workspace:string)=>createHash('sha256').update(JSON.stringify([id,canonical(workspace)])).digest('hex')
const all=()=>readJson<Record<string,Entry>>(file,()=>({}))
export function pluginAccessEntry(id:string,workspace:string):Entry{return all()[key(id,workspace)]??{plugin:id,workspace:canonical(workspace),revision:0,grants:[]}}
export function pluginScope(id:string,workspace:string,employeeId:string):PluginScope{
 return {employeeId,employeeName:readStore().sessions.find(p=>p.id===employeeId)?.title,grants:pluginAccessEntry(id,workspace).grants.filter(g=>g.employeeId===employeeId).map(({employeeId,...rights})=>rights)}
}
export function pluginAccess(id:string,workspace:string,resources:PluginResource[],args:{resourceIds?:string[];updates?:PluginGrant[];employees?:({employeeId:string;read:boolean;write:boolean;create:boolean})[];expectedRevision?:number}){
 requireAppAdministrator();const data=all(),entry=pluginAccessEntry(id,workspace),people=readStore().sessions.filter(p=>!p.deleting)
 if(args.employees!==undefined||args.updates!==undefined){
  if(args.expectedRevision!==entry.revision)throw Error('Plugin access changed; reload before saving')
  const resourceIds=args.updates?[...new Set(args.updates.map(g=>g.resourceId))]:args.resourceIds
  const employees=args.updates??args.employees
  if(!Array.isArray(resourceIds)||!resourceIds.length||resourceIds.length>1000||resourceIds.some(id=>!resources.some(r=>r.id===id)))throw Error('Choose existing plugin pages or resources')
  if(!Array.isArray(employees)||employees.length>200000||employees.some(g=>!people.some(p=>p.id===g.employeeId)||['read','write','create'].some(right=>typeof g[right as keyof typeof g]!=='boolean')))throw Error('Choose existing employees and explicit read/write/create rights')
  const selected=new Set(resourceIds),grants=entry.grants.filter(g=>args.updates?!args.updates.some(u=>u.resourceId===g.resourceId&&u.employeeId===g.employeeId):!(selected.has(g.resourceId)&&(!employees.length||employees.some(employee=>employee.employeeId===g.employeeId))))
  for(const resourceId of selected)for(const employee of employees.filter(g=>!args.updates||(g as PluginGrant).resourceId===resourceId)){
   if(people.find(p=>p.id===employee.employeeId)!.managementRole==='secretary')continue
   const capabilities=resources.find(r=>r.id===resourceId)!.capabilities??['read','write','create']
   if(employee.write&&!capabilities.includes('write')||employee.create&&!capabilities.includes('create'))throw Error('This resource does not support the selected permission')
   const rights={read:capabilities.includes('read')&&(employee.read||employee.write||employee.create),write:employee.write,create:employee.create}
   grants.push({employeeId:employee.employeeId,resourceId,...rights})
  }
  entry.grants=grants;entry.revision++;data[key(id,workspace)]=entry;atomicJson(file,data,true)
 }
 return {...entry,grants:entry.grants.filter(g=>!args.resourceIds||args.resourceIds.includes(g.resourceId)),employees:people.map(p=>({id:p.id,title:p.title,team:p.group,role:p.managementRole??'employee'})),automaticRoles:['secretary']}
}
export function grantCreatedPluginResources(id:string,workspace:string,scope:PluginScope,created:PluginCreatedResource[]){
 if(!created.length)return
 const data=all(),entry=pluginAccessEntry(id,workspace),allowed=new Set(entry.grants.filter(g=>g.employeeId===scope.employeeId&&g.create).map(g=>g.resourceId))
 for(const resource of created){if(!allowed.has(resource.parentId))continue;entry.grants=entry.grants.filter(g=>g.employeeId!==scope.employeeId||g.resourceId!==resource.id);entry.grants.push({employeeId:scope.employeeId,resourceId:resource.id,read:true,write:true,create:true});allowed.add(resource.id)}
 entry.revision++;data[key(id,workspace)]=entry;atomicJson(file,data,true)
}
