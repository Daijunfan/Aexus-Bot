import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {PassThrough} from 'node:stream'
import {build} from 'esbuild'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-protocol-lines-'))
try{
 const file=path.join(temp,'protocol.mjs');await build({entryPoints:['src/main/protocol-lines.ts'],outfile:file,platform:'node',format:'esm',bundle:true,logLevel:'silent'});const {protocolLines,protocolJson}=await import(file)
 const text='中文\n第二行\u2028第三行\u2029段落',packet={text},encoded=Buffer.from(JSON.stringify(packet)+'\r\n'+protocolJson(packet)+'\n')
 for(let boundary=0;boundary<=encoded.length;boundary++){const input=new PassThrough(),reader=protocolLines(input),lines=[];reader.on('line',line=>lines.push(JSON.parse(line)));input.write(encoded.subarray(0,boundary));input.end(encoded.subarray(boundary));await new Promise(resolve=>input.on('end',resolve));assert.deepEqual(lines,[packet,packet]);reader.close()}
 const input=new PassThrough(),reader=protocolLines(input),lines=[];reader.on('line',line=>lines.push(JSON.parse(line)));input.end(protocolJson(packet));await new Promise(resolve=>input.on('end',resolve));assert.deepEqual(lines,[packet]);reader.close()
 console.log('PASS LF-framed JSON: every UTF-8 chunk boundary, CRLF, Unicode line/paragraph characters, native Node-compatible encoding and a final non-newline frame')
}finally{fs.rmSync(temp,{recursive:true,force:true})}
