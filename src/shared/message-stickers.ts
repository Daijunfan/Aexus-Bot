import {objectSchema,nonemptySchema} from './api-schema.ts'
export type MessageSticker={id:string;name:string;pack:string;mimeType:string;bytes:number;createdAt:number}
export const MESSAGE_STICKER_COMMANDS=[
 {name:'messenger.sticker-list',cli:{},args:'[--pack NAME --query TEXT]',summary:'List your local sticker packs, including static and animated images; no external service or inference.',gui:'Local stickers',inputSchema:objectSchema({pack:{type:'string',maxLength:80},query:{type:'string',maxLength:100}})},
 {name:'messenger.sticker-save',cli:{},args:'--name TEXT --pack NAME --image JSON',summary:'User/Secretary imports a signature-checked PNG/JPEG/GIF/WebP up to 2 MiB into a local sticker pack. Same image and pack is idempotent; no message is sent.',gui:'Import local sticker',inputSchema:objectSchema({name:{type:'string',minLength:1,maxLength:80},pack:{type:'string',minLength:1,maxLength:80},image:objectSchema({name:nonemptySchema,mimeType:{enum:['image/png','image/jpeg','image/gif','image/webp']},data:nonemptySchema},['name','mimeType','data'])},['name','pack','image'])},
 {name:'messenger.sticker-image',cli:{positionals:['id']},args:'ID',summary:'Read one current local sticker image for the authenticated user; imported stickers do not grant filesystem access.',gui:'Sticker preview',inputSchema:objectSchema({id:nonemptySchema},['id'])},
 {name:'messenger.sticker-remove',cli:{},args:'--ids JSON',summary:'Remove selected stickers from your library; previously shared group images remain independent and intact.',gui:'Remove local stickers',inputSchema:objectSchema({ids:{type:'array',minItems:1,maxItems:200,uniqueItems:true,items:nonemptySchema}},['ids'])}
]
export const MESSAGE_STICKER_APIS=new Set(MESSAGE_STICKER_COMMANDS.map(command=>command.name))
