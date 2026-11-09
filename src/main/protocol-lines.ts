import {EventEmitter} from 'node:events'
import {StringDecoder} from 'node:string_decoder'
import type {Readable} from 'node:stream'

/** JSONL is LF-framed. Node's readline also splits valid JSON text at U+2028/U+2029. */
export function protocolLines(input:Readable){
 const lines=new EventEmitter(),decoder=new StringDecoder('utf8');let buffer=''
 const data=(chunk:Buffer|string)=>{buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);lines.emit('line',line)}}
 const finish=()=>{buffer+=decoder.end();if(buffer){const line=buffer.replace(/\r$/,'');buffer='';lines.emit('line',line)}},error=(cause:Error)=>lines.emit('error',cause)
 input.on('data',data);input.on('end',finish);input.on('error',error)
 return Object.assign(lines,{close(){input.off('data',data);input.off('end',finish);input.off('error',error);buffer=''}})
}

/** Keep compatibility with native Node readers while preserving the exact decoded text. */
export function protocolJson(value:unknown){return JSON.stringify(value).replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')}
