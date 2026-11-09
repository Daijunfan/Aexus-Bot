import fs from 'node:fs'
import path from 'node:path'
import {APP_HOME} from '../shared/core-paths'
import {storageFolderName,defaultStorageFolderName,type StorageFolderInput,type GroupStorage} from '../shared/storage-folder'
import {cloudHostTarget} from './cloud-hosts'
import {remoteFiles,closeRemote} from './tunnel'
import {atomicJson} from './atomic-file'
import {requireAppAdministrator} from './application-authority'

/** Resolves a creation choice once; subsequent display renames never move shared files. */
export async function prepareGroupStorage(id:string,name:string,input?:StorageFolderInput){
 if(input)requireAppAdministrator()
 const mode=input?.mode??'create',folderName=mode==='create'?storageFolderName(input?.folderName??defaultStorageFolderName(name)):undefined
 if(mode==='bind'&&input?.folderName!==undefined)throw Error('Folder name applies only when creating a folder')
 if(mode==='bind'&&!input?.directory)throw Error('Choose an existing storage folder')
 if(input?.hostId){
  const parent=cloudHostTarget(input.hostId,input.directory),session='group-storage-create-'+id
  try{const result=await remoteFiles(session,parent,'directory',{path:mode==='create'?folderName:'.',...(mode==='create'?{create:true,exclusive:true}:{})});return {kind:'remote',hostId:input.hostId,directory:result.path} satisfies GroupStorage}finally{closeRemote(session)}
 }
 const managed=path.join(APP_HOME,'conversation-workspaces','group',id),parent=input?.directory??managed
 if(!path.isAbsolute(parent))throw Error('Choose an absolute folder on the Core host')
 if(!input?.directory)fs.mkdirSync(managed,{recursive:true,mode:0o700})
 const stat=fs.lstatSync(parent);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Choose an existing physical parent folder')
 const directory=mode==='create'?path.join(fs.realpathSync(parent),folderName!):fs.realpathSync(parent)
 if(mode==='create'){if(fs.existsSync(directory))throw Error('Folder already exists. Use the existing-folder option.');fs.mkdirSync(directory,{mode:0o700})}
 if(!input?.directory)atomicJson(path.join(managed,'workspace.json'),{version:1,folderName:path.basename(directory),members:{}})
 return {kind:'local',directory} satisfies GroupStorage
}
