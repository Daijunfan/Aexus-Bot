import {isAppAdministrator} from './application-authority'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {APP_HOME} from '../shared/core-paths'
import {assetCatalog,type AssetMount} from './assets'
import {assetIndex} from './asset-index'
import {planDirectoryNames,applyDirectoryNames,rollbackDirectoryNames,migratedPath,needsDirectoryName,type DirectoryPlan} from './directory-migration'
import {directoryName} from '../shared/directory-names'
import {readStore,writeStore} from './store'
import {requestContext} from './request-context'
import {directoryAliases} from './directory-aliases'
import {atomicJson} from './atomic-file'
import {catalog as chatGroups} from './chat-group-store'
import {listCloudHosts} from './cloud-hosts'

type Preserved={id:string;name:string;root:string;hostId?:string}
type NamingPlan={id:string;local:DirectoryPlan;mounts:AssetMount[];fingerprint:string;createdAt:number;preserved:Preserved[];remote:{mount:AssetMount;plan:any}[]}
const plans=new Map<string,NamingPlan>()
type Remote=(mount:AssetMount,operation:string,args:any)=>Promise<any>
const fingerprint=(mounts:AssetMount[])=>{const hosts=listCloudHosts();return JSON.stringify(mounts.map(({id,root,remote,host})=>({id,root,remote,host:host?.id,hostRevision:remote?hosts.find(item=>item.id===host?.id)?.updatedAt:undefined})))}
export async function assetNaming(args:{id?:string;apply?:boolean},close:(ids:string[])=>Promise<void>,remote:Remote){
 if(!isAppAdministrator())throw Error('Only the user or Secretary may migrate directory names')
 const mounts=assetCatalog().mounts
 const preserved:Preserved[]=chatGroups().groups.filter(group=>group.storage).map(group=>({id:'group:'+group.id,name:group.name,root:group.storage!.directory,...(group.storage!.kind==='remote'?{hostId:group.storage!.hostId}: {})})),protectedIds=new Set(preserved.map(item=>item.id))
 if(!args.apply){
  const local=await planDirectoryNames(mounts.filter(mount=>!mount.remote&&!protectedIds.has(mount.id)).map(mount=>mount.root),preserved.filter(item=>!item.hostId).map(item=>item.root)),remotes:NamingPlan['remote']=[]
  for(const mount of mounts.filter(mount=>mount.remote&&!mount.owner.employee&&!protectedIds.has(mount.id))){
   const preview=await remote(mount,'directory-plan',{}),paths=preview.root.includes('\\')?path.win32:path.posix,used=new Map<string,Set<string>>()
   const normalized=(value:string)=>mount.host?.os==='linux'?paths.normalize(value):paths.normalize(value).toLocaleLowerCase(),protectedPaths=preserved.filter(item=>item.hostId===mount.host?.id).map(item=>normalized(item.root))
   preview.renames=[]
   for(const row of preview.directories.sort((a:any,b:any)=>b.fromPath.length-a.fromPath.length)){
    const candidate=normalized(row.fromPath);if(protectedPaths.some(root=>candidate===root||candidate.startsWith(root+paths.sep)||root.startsWith(candidate+paths.sep)))continue
    if(!needsDirectoryName(row.name,row.fromPath))continue
    let names=used.get(row.parent);if(!names){names=new Set(row.siblings.map((name:string)=>name.toLowerCase()));used.set(row.parent,names)}
    const base=directoryName(row.name);let name=base,index=0;while(names.has(name.toLowerCase()))name=base+'-'+createHash('sha256').update(row.fromPath).digest('hex').slice(0,8)+(index++?'-'+index:'');names.add(name.toLowerCase())
    preview.renames.push({from:row.fromPath,to:paths.join(row.parent,name),inode:row.inode,device:row.device})
   }
   delete preview.directories;remotes.push({mount,plan:preview})
  }
  const plan:NamingPlan={id:randomUUID(),local,mounts,fingerprint:fingerprint(mounts),createdAt:Date.now(),remote:remotes,preserved};plans.set(plan.id,plan)
  return {id:plan.id,createdAt:plan.createdAt,local:local.renames,remote:remotes.map(item=>({id:item.mount.id,...item.plan})),externalDirectoriesIncluded:true,preserved}
 }
 const plan=plans.get(args.id??'');if(!plan)throw Error('Preview the directory migration first')
 if(plan.fingerprint!==fingerprint(mounts))throw Error('Workspace bindings changed; regenerate the migration preview')
 const initialStore=readStore(),cards=initialStore.sessions.filter(card=>plan.local.renames.some(item=>card.cwd===item.from||card.cwd.startsWith(item.from+path.sep)||item.from.startsWith(card.cwd+path.sep))||plan.remote.some(item=>item.plan.renames?.length&&card.group===item.mount.owner.team))
 await close(cards.map(card=>card.id))
 if(plan.fingerprint!==fingerprint(assetCatalog().mounts))throw Error('Workspace bindings changed; regenerate the migration preview')
 const store=readStore()
 const backup=path.join(APP_HOME,'backups','directory-migration-'+plan.id);fs.mkdirSync(backup,{recursive:true,mode:0o700});atomicJson(path.join(backup,'plan.json'),plan);atomicJson(path.join(backup,'sessions.json'),store)
 const oldMetadata=new Map<string,{file:string;data:any}>()
 for(const mount of plan.mounts.filter(mount=>mount.scope.conversation&&!protectedIds.has(mount.id))){
  const file=path.join(path.dirname(mount.root),'workspace.json')
  if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8'));oldMetadata.set(mount.id,{file,data});atomicJson(path.join(backup,mount.id.replace(':','-')+'.json'),data)}
 }
 const originalStore=structuredClone(store),savedFiles=new Map<string,string|undefined>()
 for(const mount of plan.mounts.filter(mount=>!mount.remote&&!protectedIds.has(mount.id))){const file=path.join(mount.root,'.agents-company/directory-renames.json');savedFiles.set(file,fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined)}
 for(const {file}of oldMetadata.values())savedFiles.set(file,fs.readFileSync(file,'utf8'))
 const local=await applyDirectoryNames(plan.local),remoteResults:any[]=[]
 try{
 for(const item of plan.remote)remoteResults.push({id:item.mount.id,...await remote(item.mount,'directory-apply',{plan:item.plan})})
 for(const mount of plan.mounts.filter(mount=>!mount.remote&&!protectedIds.has(mount.id))){
  const next=migratedPath(mount.root,plan.local);if(!fs.existsSync(next))continue
  const aliases=directoryAliases(next),rows=plan.local.renames.filter(item=>item.from.startsWith(mount.root+path.sep)).map(item=>({from:path.relative(mount.root,item.from).split(path.sep).join('/'),to:path.relative(next,migratedPath(item.from,plan.local)).split(path.sep).join('/')}))
  if(rows.length){fs.mkdirSync(path.join(next,'.agents-company'),{recursive:true});atomicJson(path.join(next,'.agents-company/directory-renames.json'),{version:1,aliases:[...aliases,...rows]})}
 }
 for(const [id,{file,data}]of oldMetadata){const mount=plan.mounts.find(mount=>mount.id===id)!,next=migratedPath(mount.root,plan.local);data.folderName=path.basename(next);for(const member of Object.keys(data.members))data.members[member]=path.relative(next,migratedPath(path.join(mount.root,data.members[member]),plan.local));atomicJson(file,data)}
 for(const [team,root]of Object.entries(store.teamRoots??{}))store.teamRoots![team]=migratedPath(root,plan.local)
 for(const card of store.sessions){card.cwd=migratedPath(card.cwd,plan.local);if(card.localWorkspaceRoot)card.localWorkspaceRoot=migratedPath(card.localWorkspaceRoot,plan.local)}
 for(const result of remoteResults){const mount=plan.mounts.find(mount=>mount.id===result.id)!,team=mount.owner.team!;const settings=store.teamSettings?.[team];if(settings?.remote){const original=settings.remote.directory;settings.remote.directory=result.root;store.teamRoots![team]=result.root;for(const card of store.sessions.filter(card=>card.group===team&&card.workEnvironment!=='local')){for(const item of result.paths??[])if(card.cwd===item.fromPath||card.cwd.startsWith(item.fromPath+'/'))card.cwd=item.toPath+card.cwd.slice(item.fromPath.length);if(card.cwd.startsWith(original+'/'))card.cwd=result.root+card.cwd.slice(original.length)}}}
 writeStore(store);assetIndex.invalidate();plans.delete(plan.id)
 const report={id:plan.id,applied:true,local,remote:remoteResults,backup,identitiesPreserved:true,compatibilityLinks:true};atomicJson(path.join(backup,'result.json'),report);return report
 }catch(error){
  for(const result of [...remoteResults].reverse()){const item=plan.remote.find(item=>item.mount.id===result.id)!;await remote(item.mount,'directory-rollback',{plan:item.plan})}
  for(const [file,content]of savedFiles){const current=migratedPath(file,plan.local);if(content===undefined)fs.rmSync(current,{force:true});else fs.writeFileSync(current,content)}
  await rollbackDirectoryNames(plan.local);writeStore(originalStore);assetIndex.invalidate();atomicJson(path.join(backup,'failure.json'),{error:(error as Error).message,rolledBack:true});throw error
 }
}
