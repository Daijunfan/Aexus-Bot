import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import type {Engineering,EngineeringArtifact} from '../shared/engineering'
import {readStore} from './store'
import {executionEmployee,employeeWorkspace} from './workspaces'
import {workspaceFiles} from './files'
import {remoteFiles} from './tunnel'
import {ownedWorkerExecution,workerFile} from './native-workers'

export async function publishEngineeringArtifacts(item:Engineering,key:string,files:Array<{runId:string;path:string}>){
 const role=item.roles.find(role=>role.key===key)!,node=item.nodes.find(node=>node.key===key)!,artifacts:EngineeringArtifact[]=[],seen=new Set<string>()
 for(const file of files){
  const run=item.runs.find(run=>run.id===file.runId&&run.node===key&&run.attempt===node.attempt&&!run.superseded&&run.state==='completed')
  if(!run?.workerId)throw Error('Delivery files must belong to a completed Worker run in this exact node attempt')
  const {worker}=ownedWorkerExecution(run.workerId,role.employeeId!,run.id),pair=run.id+':'+file.path;if(seen.has(pair))throw Error('Delivery file listed twice');seen.add(pair)
  const info=await workerFile(worker.id,'info',{path:file.path});if(!info.exists||!info.regular||info.symlink||!info.version)throw Error('Publish an existing regular Worker file: '+file.path)
  artifacts.push({id:'ea_'+randomUUID(),runId:run.id,path:file.path,name:file.path.split(/[\\/]/).at(-1)!,bytes:info.bytes,version:info.version,employeeId:role.employeeId!,cwd:worker.cwd,host:worker.host})
 }
 return artifacts
}
async function fileOperation(artifact:EngineeringArtifact,operation:string,offset=0){
 const store=readStore(),card=store.sessions.find(card=>card.id===artifact.employeeId&&!card.deleting);if(!card)throw Error('Delivery owner was removed')
 const current=executionEmployee(store,card);if((current.remote?.host??undefined)!==artifact.host)throw Error('Delivery execution host changed; no other host was used')
 const paths=current.remote?.os==='windows'?path.win32:current.remote?path.posix:path,root=current.remote?current.cwd:employeeWorkspace(store,card.group,card.cwd,card.id),directory=current.remote?artifact.cwd:fs.realpathSync(artifact.cwd),relative=paths.relative(root,directory)
 if(relative==='..'||relative.startsWith('..'+paths.sep)||paths.isAbsolute(relative))throw Error('Delivery folder is outside its actual Employee workspace')
 const args={path:artifact.path,offset,length:262144},op=({info:'copy-info',image:'read-image',chunk:'copy-read'} as Record<string,string>)[operation]??operation
 return current.remote?remoteFiles('engineering-'+artifact.employeeId,{...current.remote,directory},op,args):workspaceFiles(directory,op,args)
}
export async function readEngineeringArtifact(item:Engineering,artifactId:string,operation='read',offset=0){
 const artifact=item.reviews.flatMap(review=>review.artifacts??[]).find(artifact=>artifact.id===artifactId);if(!artifact)throw Error('Unknown or unpublished engineering delivery file')
 const before=await fileOperation(artifact,'info');if(!before.exists||!before.regular||before.symlink||before.version!==artifact.version)throw Error('Published delivery file changed or was removed; request a new Employee review')
 if(operation==='info')return {...before,id:artifact.id,name:artifact.name,path:artifact.path}
 const result=await fileOperation(artifact,operation,offset),after=await fileOperation(artifact,'info');if(after.version!==artifact.version)throw Error('Delivery file changed during reading; its previous verification is no longer current')
 return {...result,id:artifact.id,name:artifact.name,version:artifact.version}
}
export async function verifyEngineeringArtifacts(item:Engineering,key?:string){
 for(const review of item.reviews)if(review.level==='employee'&&review.accepted&&(!key||review.node===key)&&item.nodes.some(node=>node.key===review.node&&node.attempt===review.attempt))for(const artifact of review.artifacts??[])await readEngineeringArtifact(item,artifact.id,'info')
}
