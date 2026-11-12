import {objectSchema,nonemptySchema} from './api-schema.ts'
export type WorkspacePdfImage={kind:'workspace-pdf-page';path:string;sourceVersion:string;page:number;pageCount:number;width:number;height:number;mimeType:'image/png';data:string;text:string;title:string}
export const WORKSPACE_PDF_COMMANDS=[{
 name:'workspace.pdf',cli:{positionals:['path'],required:['employee']},args:'PATH --employee ID [--operation info|text|page|render --page N --limit N --width PX --to RELATIVE.png --expected-version VERSION --password PASSWORD]',
 summary:'Read a PDF in an authorized employee workspace; page returns real PNG pixels to native tools, render writes an original page image back to that same workspace without overwriting. Text is paged with nextPage; scanned pages need image reading. Uses the installed Margin Reader renderer, preserving the PDF and library state.',gui:'Read and share document pages',
 inputSchema:objectSchema({employee:nonemptySchema,path:nonemptySchema,operation:{enum:['info','text','page','render']},page:{type:'integer',minimum:1},limit:{type:'integer',minimum:1,maximum:32},width:{type:'integer',minimum:480,maximum:2400},to:nonemptySchema,expectedVersion:nonemptySchema,password:{type:'string',maxLength:1024}},['employee','path'])
}]
