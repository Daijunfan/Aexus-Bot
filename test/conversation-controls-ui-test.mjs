// The former nested group editor and channel group-role UI have been retired.
// Exercise their replacement through visible controls and authenticated effects.
import {spawn} from 'node:child_process'
const modes=process.platform==='linux'?[['--web']]:[['--web'],[]]
for(const args of modes){
 const child=spawn(process.execPath,[new URL('./message-management-ui-test.mjs',import.meta.url).pathname,...args],{stdio:'inherit',env:process.env})
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
 if(code)process.exit(code)
}
