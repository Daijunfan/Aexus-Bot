import {validateApiArguments} from './api-contract'
import fs from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {APP_HOME} from '../shared/protocol'
import {atomicJson,readJson} from './atomic-file'
import {requireAppAdministrator} from './authorization'
import {validatedImage} from './image-input'
import type {MessageSticker} from '../shared/message-stickers'
type Sticker=MessageSticker&{sha256:string;file:string}
const root=join(APP_HOME,'message-stickers'),index=join(root,'index.json'),read=()=>readJson<Sticker[]>(index,()=>[])
const publicSticker=({file,sha256,...value}:Sticker)=>value
export function stickerRequest(command:string,args:Record<string,any>){
 requireAppAdministrator();validateApiArguments(command,args);const rows=read()
 if(command==='messenger.sticker-list')return {stickers:rows.filter(row=>(!args.pack||row.pack===args.pack)&&(!args.query||(row.name+' '+row.pack).toLocaleLowerCase().includes(args.query.trim().toLocaleLowerCase()))).map(publicSticker),packs:[...new Set(rows.map(row=>row.pack))]}
 if(command==='messenger.sticker-save'){
  const name=args.name.trim(),pack=args.pack.trim();if(!name||!pack)throw Error('Choose a sticker name and pack');if(args.image.data.length>Math.ceil(2*1024*1024/3)*4)throw Error('Import a sticker up to 2 MiB')
  const image=validatedImage(args.image),prior=rows.find(row=>row.sha256===image.sha256&&row.pack===pack);if(prior)return publicSticker(prior)
  fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.lstatSync(root).isSymbolicLink())throw Error('Sticker directory cannot be a symlink');const file=image.sha256+'.'+image.extension,target=join(root,file);if(fs.existsSync(target)){if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink())throw Error('Sticker image is not a regular file')}else fs.writeFileSync(target,image.data,{mode:0o600,flag:'wx'})
  const sticker:Sticker={id:'sticker_'+randomUUID(),name,pack,file,sha256:image.sha256,mimeType:args.image.mimeType,bytes:image.data.length,createdAt:Date.now()};rows.push(sticker);atomicJson(index,rows,true);return publicSticker(sticker)
 }
 if(command==='messenger.sticker-remove'){const count=rows.filter(row=>args.ids.includes(row.id)).length;atomicJson(index,rows.filter(row=>!args.ids.includes(row.id)),true);return {count}}
 const sticker=rows.find(row=>row.id===args.id);if(!sticker)throw Error('Sticker no longer exists');const target=join(root,sticker.file);if(!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink())throw Error('Sticker image is unavailable');return {...publicSticker(sticker),data:fs.readFileSync(target).toString('base64')}
}
