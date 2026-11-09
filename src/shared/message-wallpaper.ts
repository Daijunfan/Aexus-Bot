import {WALLPAPER_PALETTES} from './telegram-wallpapers.ts'
export {WALLPAPER_PALETTES}
export const WALLPAPER_PATTERNS=['telegram','daydream','botanical','cosmos','studio','geometric','none'] as const
export const WALLPAPER_LAYOUTS=['scattered','ordered'] as const
export type MessageWallpaperSettings={pattern:typeof WALLPAPER_PATTERNS[number];layout:typeof WALLPAPER_LAYOUTS[number];density:number;opacity:number;palette?:typeof WALLPAPER_PALETTES[number];colors?:string[];rotation?:number}
export const DEFAULT_MESSAGE_WALLPAPER:MessageWallpaperSettings={pattern:'none',layout:'scattered',density:115,opacity:16}
export const MESSAGE_WALLPAPER_SCHEMA={type:'object',additionalProperties:false,properties:{pattern:{enum:WALLPAPER_PATTERNS},layout:{enum:WALLPAPER_LAYOUTS},density:{type:'number',minimum:70,maximum:160},opacity:{type:'number',minimum:0,maximum:45},palette:{enum:WALLPAPER_PALETTES},colors:{type:'array',minItems:1,maxItems:4,items:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}},rotation:{type:'integer',minimum:0,maximum:360}},description:'Messages-only decoration shared by chats, groups and channels. Partial fields merge; Telegram colors/pattern, custom 1–4 RGB colors and rotation; density 70–160%, ink opacity 0–45%. No message or execution changes.'}
export function validateMessageWallpaper(patch:unknown):asserts patch is Partial<MessageWallpaperSettings>{
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('messageWallpaper must be an object')
 for(const [key,value] of Object.entries(patch)){
  if(key==='pattern'?(WALLPAPER_PATTERNS as readonly unknown[]).includes(value):key==='layout'?(WALLPAPER_LAYOUTS as readonly unknown[]).includes(value):key==='density'?typeof value==='number'&&Number.isFinite(value)&&value>=70&&value<=160:key==='opacity'?typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=45:key==='palette'?(WALLPAPER_PALETTES as readonly unknown[]).includes(value):key==='colors'?Array.isArray(value)&&value.length>=1&&value.length<=4&&value.every(color=>typeof color==='string'&&/^#[0-9a-fA-F]{6}$/.test(color)):key==='rotation'?typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=360:false)continue
  throw Error('Invalid messageWallpaper '+key)
 }
}
