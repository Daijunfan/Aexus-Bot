import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {ReadCache} from './read-cache'
const validatedJson=new ReadCache<string>(64,32*1024*1024)
const textSize=(text:string)=>Buffer.byteLength(text)
/** Never overwrite a live state file. The previous inode remains recoverable. */
export function atomicJson(file:string,value:unknown,previous=false){
  const text=JSON.stringify(value)
  if(text===undefined)throw Error('Cannot persist undefined JSON')
  const contents=text+'\n'
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700})
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Refusing a state-file symlink')
  const temp=file+'.'+randomUUID()+'.tmp',old=file+'.previous',oldTemp=old+'.'+randomUUID()+'.tmp'
  try{
    const fd=fs.openSync(temp,'wx',0o600)
    try{fs.writeFileSync(fd,contents,'utf8');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    if(previous&&fs.existsSync(file)){
      const oldText=fs.readFileSync(file,'utf8');validatedJson.get(file,oldText,()=>{JSON.parse(oldText);return oldText},textSize)
      try{fs.linkSync(file,oldTemp)}catch{fs.copyFileSync(file,oldTemp,fs.constants.COPYFILE_EXCL)}
      fs.renameSync(oldTemp,old)
    }
    fs.renameSync(temp,file)
    validatedJson.get(file,contents,()=>contents,textSize)
  }finally{fs.rmSync(temp,{force:true});fs.rmSync(oldTemp,{force:true})}
}
export function readJson<T>(file:string,missing:()=>T,valid:(value:unknown)=>boolean=()=>true):T{
  let text:string
  try{text=fs.readFileSync(file,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return missing();throw error}
  try{const value=JSON.parse(text);if(!valid(value))throw Error('Invalid data shape');return value as T}
  catch{throw Object.assign(Error('State file is corrupt; it was not replaced: '+file+(fs.existsSync(file+'.previous')?'. A previous copy is available at '+file+'.previous':'')),{code:'STATE_CORRUPT'})}
}
