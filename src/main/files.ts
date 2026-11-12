import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {directoryName,needsDirectoryName} from '../shared/directory-names'
import {directoryPath,migrationLink} from './directory-aliases'
import {fileVersion} from './read-cache'
import {atomicJson} from './atomic-file'
import type {PrincipalRef} from '../shared/management'

export type WorkspaceTrash={id:string;path:string;deletedAt:number;bytes?:number;directory?:boolean;version?:string;by?:PrincipalRef;restoredAt?:number}
/** Only actual recoverable blobs are listed; old manifests remain compatible. */
export function workspaceTrash(root:string,relative?:string):WorkspaceTrash[]{
  const directory=workspacePath(root,'.agents-company/trash')
  if(!fs.existsSync(directory))return []
  return fs.readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).flatMap(name=>{
    const manifest=path.join(directory,name),id=name.slice(0,-5),blob=path.join(directory,id)
    if(!fs.lstatSync(manifest).isFile()||fs.lstatSync(manifest).isSymbolicLink()||!fs.existsSync(blob))return []
    const value=JSON.parse(fs.readFileSync(manifest,'utf8')),original=typeof value.path==='string'?path.relative(root,workspacePath(root,value.path)).split(path.sep).join('/'):undefined
    if(original===undefined||relative!==undefined&&original!==relative)return []
    return [{...value,id,path:original,directory:value.directory??fs.lstatSync(blob).isDirectory(),bytes:value.bytes??fs.lstatSync(blob).size,deletedAt:value.deletedAt??fs.statSync(manifest).mtimeMs}]
  }).sort((a,b)=>b.deletedAt-a.deletedAt)
}

/** Normalize only newly-created folder components; file names and existing paths retain identity. */
export function directoryDestination(root:string,value:string,folder=false){
  workspacePath(root,value,folder)
  const parts=value.split(/[\\/]/),limit=parts.length-(folder?0:1)
  for(let i=0;i<limit;i++)if(parts[i]&&parts[i]!=='.'&&parts[i]!=='..'&&!parts[i].startsWith('.')&&needsDirectoryName(parts[i],parts.slice(0,i+1).join('/'))&&!fs.existsSync(path.join(root,...parts.slice(0,i+1))))parts[i]=directoryName(parts[i])
  return parts.join('/')
}

export function workspacePath(root:string,value='.',write=false) {
  value=directoryPath(root,value)
  const file=path.resolve(root,value),part=path.relative(root,file)
  if(part==='..'||part.startsWith('..'+path.sep)||path.isAbsolute(part))throw new Error('文件路径超出工作目录')
  let parent=file;while(!fs.existsSync(parent))parent=path.dirname(parent)
  const real=fs.realpathSync(parent)
  if(real!==root&&!real.startsWith(root+path.sep))throw new Error('软链接指向工作目录外部')
  if(write&&(!part||part.split(path.sep).includes('.agents-company')))throw new Error('不能修改工作目录本身或宿主管理文件')
  return file
}
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex')
const imageMime=(bytes:Buffer)=>bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':/^GIF8[79]a$/.test(bytes.subarray(0,6).toString())?'image/gif':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':undefined
export function workspaceFiles(root:string,operation:string,args:Record<string,any>,trashOptions?:{by?:PrincipalRef;keepReceipt?:boolean;expectedVersion?:string}) {
  args={...args,path:directoryPath(root,args.path||'.'),...(args.to!==undefined?{to:directoryPath(root,String(args.to))}:{})}
  if(operation==='mkdir'&&!args.literalPaths)args={...args,path:directoryDestination(root,args.path||'.',true)}
  if(operation==='write'&&!args.literalPaths)args={...args,path:directoryDestination(root,args.path||'.')}
  if(operation==='move'&&!args.literalPaths)args={...args,to:directoryDestination(root,String(args.to),fs.lstatSync(workspacePath(root,args.path)).isDirectory())}
  const file=workspacePath(root,args.path||'.',['write','mkdir','move','trash'].includes(operation))
  if(operation==='shared-list'){
    const entries:any[]=[];const walk=(relative:string)=>{for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;const name=path.posix.join(relative,entry.name);if(entry.isDirectory())walk(name);else if(entry.isFile()){const stat=fs.lstatSync(path.join(root,name));entries.push({path:name,name:entry.name,bytes:stat.size,modifiedAt:stat.mtimeMs,version:fileVersion(path.join(root,name)),regular:true,directory:false})}}};walk('');return {entries,trash:workspaceTrash(root)}
  }
  if(operation==='trash-info'||operation==='restore-rollback'){
    if(!/^[a-f0-9-]{36}$/.test(args.id))throw Error('Invalid trash identity')
    const directory=workspacePath(root,'.agents-company/trash'),manifest=path.join(directory,args.id+'.json');if(!fs.lstatSync(manifest).isFile()||fs.lstatSync(manifest).isSymbolicLink())throw Error('Trash receipt unavailable')
    const value=JSON.parse(fs.readFileSync(manifest,'utf8')),target=workspacePath(root,value.path,true),blob=path.join(directory,args.id),available=fs.existsSync(blob)
    if(operation==='trash-info')return {...value,id:args.id,available,originalExists:fs.existsSync(target),already:!!value.restoredAt&&!available}
    if(available||!value.restoredAt||!fs.existsSync(target)||value.restoredVersion!==fileVersion(target))throw Error('Restored file changed; refresh before retrying')
    fs.renameSync(target,blob);delete value.restoredAt;delete value.restoredVersion;atomicJson(manifest,value,true);return {rolledBack:true}
  }
  if(operation==='copy-info'){
    if(!fs.existsSync(file)){const removed=workspaceTrash(root,path.relative(root,file).split(path.sep).join('/'))[0];return {exists:false,...(removed?{trashed:true,trashId:removed.id,deletedAt:removed.deletedAt}:{})}}
    const stat=fs.lstatSync(file);return {exists:true,version:fileVersion(file),directory:stat.isDirectory(),regular:stat.isFile(),symlink:stat.isSymbolicLink(),bytes:stat.size,modifiedAt:stat.mtimeMs,mode:stat.mode&0o777}
  }
  if(operation==='copy-read'){
    const {offset,length}=args
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>262144)throw Error('Invalid transfer range')
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('只能传输普通文件')
    const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(length)
    try{const bytes=fs.readSync(fd,buffer,0,length,offset);return {data:buffer.subarray(0,bytes).toString('base64'),bytes}}finally{fs.closeSync(fd)}
  }
  if(['copy-write','copy-commit','copy-replace','copy-remove'].includes(operation)){
    workspacePath(root,args.path,true)
    if(!path.relative(root,file).split(path.sep).some(p=>/^\.agents-transfer-[a-f0-9-]{36}$/.test(p)))throw Error('Invalid transfer staging path')
    if(operation==='copy-remove'){fs.rmSync(file,{recursive:true,force:true});return {removed:true}}
    if(operation==='copy-commit'||operation==='copy-replace'){
      const to=workspacePath(root,String(args.to),true)
      if(operation==='copy-replace'){if(fileVersion(to)!==args.expectedVersion)throw Error('Shared file changed while uploading');fs.renameSync(file,to);return {path:args.to}}
      if(fs.existsSync(to))throw Error('目标已有同名文件，未覆盖')
      if(fs.statSync(file).isDirectory())fs.renameSync(file,to)
      else{fs.linkSync(file,to);fs.unlinkSync(file)}
      return {path:args.to}
    }
    if(!Number.isSafeInteger(args.offset)||args.offset<0||typeof args.data!=='string'||args.data.length>349528)throw Error('Invalid transfer chunk')
    const data=Buffer.from(args.data,'base64'),fd=fs.openSync(file,args.offset===0?'wx':'r+',(Number(args.mode)||0o600)|0o600)
    try{if(fs.fstatSync(fd).size!==args.offset)throw Error('Transfer offset mismatch');let done=0;while(done<data.length)done+=fs.writeSync(fd,data,done,data.length-done,args.offset+done);if(args.final)fs.fchmodSync(fd,Number(args.mode)||0o600);return {bytes:data.length}}finally{fs.closeSync(fd)}
  }
  if(operation==='list')return {root,path:path.relative(root,file),entries:fs.readdirSync(file,{withFileTypes:true}).filter(e=>(args.hidden||!e.name.startsWith('.'))&&(args.hidden||!migrationLink(root,path.relative(root,path.join(file,e.name))))).map(e=>{const child=path.join(file,e.name),stat=fs.lstatSync(child);return {name:e.name,path:path.relative(root,child),directory:e.isDirectory(),symlink:e.isSymbolicLink(),bytes:stat.size,modifiedAt:stat.mtimeMs}}).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name))}
  if(operation==='read-image'){
    if(fs.statSync(file).size>10*1024*1024)throw new Error('图片不能超过 10 MB')
    const bytes=fs.readFileSync(file),mimeType=imageMime(bytes)
    if(!mimeType)throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片')
    return {path:args.path,mimeType,data:bytes.toString('base64'),bytes:bytes.length,binary:true}
  }
  if(operation==='read') {
    const stat=fs.statSync(file)
    if(!stat.isFile())throw new Error('请选择一个文件')
    if(stat.size>4*1024*1024)return {path:args.path,bytes:stat.size,binary:true}
    const bytes=fs.readFileSync(file)
    return {path:args.path,bytes:bytes.length,hash:hash(bytes),binary:bytes.includes(0),content:bytes.includes(0)?undefined:bytes.toString('utf8')}
  }
  if(operation==='write') {
    if(args.hash&&(!fs.existsSync(file)||hash(fs.readFileSync(file))!==args.hash))throw new Error('文件已被其他操作修改，请重新读取后保存')
    if(args.create&&fs.existsSync(file))throw new Error('同名文件已存在')
    if(args.contentBase64!==undefined){
      if(typeof args.contentBase64!=='string'||args.contentBase64.length>14*1024*1024)throw new Error('图片不能超过 10 MB')
      const bytes=Buffer.from(args.contentBase64,'base64')
      if(bytes.length>10*1024*1024||!imageMime(bytes))throw new Error('请选择 10 MB 以内的 PNG、JPEG、GIF 或 WebP 图片')
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:args.create?'wx':'w'});return {path:args.path,saved:true}
    }
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,String(args.content??''));return {path:args.path,saved:true}
  }
  if(operation==='mkdir'){fs.mkdirSync(file,{recursive:false});return {path:args.path,created:true}}
  if(operation==='move') {
    const next=workspacePath(root,String(args.to),true)
    if(args.expectedVersion!==undefined&&fileVersion(file)!==args.expectedVersion)throw Error('File changed; refresh before renaming')
    if(fs.existsSync(next)){
      const a=fs.statSync(file),b=fs.statSync(next),caseOnly=a.dev===b.dev&&a.ino===b.ino&&file.toLowerCase()===next.toLowerCase()&&!fs.readdirSync(path.dirname(next)).includes(path.basename(next))
      if(!caseOnly)throw new Error('目标路径已存在')
    }
    fs.renameSync(file,next);return {path:args.to}
  }
  if(operation==='trash') {
    const directory=workspacePath(root,'.agents-company/trash'),id=randomUUID()
    const stat=fs.lstatSync(file),manifest=path.join(directory,id+'.json'),value={path:path.relative(root,file).split(path.sep).join('/'),deletedAt:Date.now(),bytes:stat.size,directory:stat.isDirectory(),version:fileVersion(file),...(trashOptions?.by?{by:trashOptions.by}:{})}
    if(trashOptions?.expectedVersion!==undefined&&value.version!==trashOptions.expectedVersion)throw Error('File changed; refresh before deleting')
    fs.mkdirSync(directory,{recursive:true,mode:0o700});atomicJson(manifest,value,true)
    try{if(trashOptions?.expectedVersion!==undefined&&fileVersion(file)!==trashOptions.expectedVersion)throw Error('File changed; refresh before deleting');fs.renameSync(file,path.join(directory,id))}catch(error){fs.unlinkSync(manifest);throw error}
    return {id,path:args.path}
  }
  if(operation==='restore') {
    if(!/^[a-f0-9-]+$/.test(args.id))throw new Error('无效回收记录')
    const directory=workspacePath(root,'.agents-company/trash'),info=JSON.parse(fs.readFileSync(path.join(directory,args.id+'.json'),'utf8'))
    const next=workspacePath(root,info.path,true)
    if(fs.existsSync(next))throw new Error('原路径已有文件')
    const manifest=path.join(directory,args.id+'.json'),blob=path.join(directory,args.id)
    if(trashOptions?.keepReceipt)atomicJson(manifest,{...info,restoredAt:Date.now()},true)
    fs.renameSync(blob,next)
    if(trashOptions?.keepReceipt){try{atomicJson(manifest,{...info,restoredAt:Date.now(),restoredVersion:fileVersion(next)},true)}catch(error){fs.renameSync(next,blob);throw error}}else fs.unlinkSync(manifest)
    return {path:info.path}
  }
  throw new Error('Unknown file operation')
}
