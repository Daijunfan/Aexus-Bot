import {objectSchema,nonemptySchema} from './api-schema.ts'
export type StorageFolderInput={hostId?:string;directory?:string;mode:'create'|'bind';folderName?:string}
export type GroupStorage={kind:'local'|'remote';directory:string;hostId?:string}
export const STORAGE_FOLDER_SCHEMA=objectSchema({hostId:nonemptySchema,directory:nonemptySchema,mode:{enum:['create','bind']},folderName:nonemptySchema},['mode'])
/** A folder label is independent of its Team/group display name. */
export function storageFolderName(value:string){
 const name=value.trim()
 if(!name||name==='.'||name==='..'||name.length>120||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Choose a valid folder name without path separators')
 return name
}
export function defaultStorageFolderName(value:string){const name=value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').slice(0,100)||'Group';return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)?'_'+name:name}
