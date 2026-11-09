import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'

const run=promisify(execFile),root=path.resolve(import.meta.dirname,'..'),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-team-views-')))
const env={...process.env,AGENTS_COMPANY_HOME:path.join(temp,'state'),AGENTS_COMPANY_SHARED_DIR:path.join(temp,'shared'),AGENTS_COMPANY_PROJECTS:path.join(temp,'projects'),AGENTS_COMPANY_WORKSPACES:path.join(temp,'work')}
let service,ended
const cli=async(...args)=>{const reply=JSON.parse((await run(process.execPath,[root+'/bin/agents',...args,'--json'],{env,timeout:20000}).catch(error=>{if(error.stdout)return {stdout:error.stdout};throw error})).stdout);assert.ok(reply.ok,reply.error);return reply.data}
const start=async()=>{service=spawn(process.execPath,[root+'/bin/agents','serve'],{env,stdio:'ignore'});ended=new Promise(resolve=>service.once('exit',resolve));for(let i=0;i<100;i++){try{await cli('status');return}catch{await new Promise(resolve=>setTimeout(resolve,40))}}throw Error('CLI service did not start')}
const stop=async()=>{service.kill('SIGTERM');await ended}
try{
 await start()
 assert.deepEqual(await cli('team-view','list'),{activeId:'all',views:[{id:'all',name:'All Team',teams:[]}]})
 for(const name of ['Alpha','Beta'])await cli('group','add',name)
 const initialViewport=await cli('canvas','view');await assert.rejects(()=>cli('canvas','set','--x','10','--y','20','--zoom','1'),/fixed scale/)
 const focus=await cli('team-view','create','--name','Focus','--teams','["Alpha"]')
 assert.deepEqual(focus.teams,['Alpha']);assert.equal((await cli('team-view','list')).activeId,focus.id)
 await assert.rejects(()=>cli('canvas','set','--x','90','--y','110','--zoom','.7'),/fixed scale/)
 await cli('team-view','select','all');assert.deepEqual(await cli('canvas','view'),initialViewport)
 await cli('team-view','select',focus.id);assert.deepEqual(await cli('canvas','view'),initialViewport)
 await stop();await start()
 assert.equal((await cli('team-view','list')).activeId,focus.id)
 assert.deepEqual(await cli('canvas','view'),initialViewport)
 const second=await cli('team-view','create','--name','Second')
 const third=await cli('team-view','create','--name','Third')
 await cli('team-view','update',third.id,'--patch','{"index":0}')
 assert.deepEqual((await cli('team-view','list')).views.map(view=>view.id),['all',third.id,focus.id,second.id])
 await assert.rejects(()=>cli('team-view','update','all','--patch','{"index":1}'))
 await assert.rejects(()=>cli('team-view','update',focus.id,'--patch','{"index":-1}'))
 await stop();await start()
 assert.deepEqual((await cli('team-view','list')).views.map(view=>view.id),['all',third.id,focus.id,second.id])
 await cli('team-view','remove',third.id);await cli('team-view','remove',second.id);await cli('team-view','select',focus.id)
 await cli('group','rename','Alpha','Renamed');assert.deepEqual((await cli('team-view','list')).views[1].teams,['Renamed'])
 await cli('group','add','Gamma');assert.deepEqual((await cli('team-view','list')).views[1].teams,['Renamed','Gamma'])
 await cli('team-view','update',focus.id,'--patch','{"name":"Only Gamma","teams":["Gamma"]}')
 assert.deepEqual((await cli('team-view','list')).views[1].teams,['Gamma'])
 await assert.rejects(()=>cli('team-view','create','--name','All Team'))
 await assert.rejects(()=>cli('team-view','update','all','--patch','{"name":"Other"}'))
 await assert.rejects(()=>cli('team-view','update',focus.id,'--patch','{"teams":["Missing"]}'))
 assert.deepEqual(await cli('canvas','view'),initialViewport,'membership does not change shared geometry or allow free pan/zoom')
 await cli('group','remove','Gamma');assert.deepEqual((await cli('team-view','list')).views[1].teams,[])
 await cli('team-view','remove',focus.id)
 assert.deepEqual((await cli('team-view','list')).views,[{id:'all',name:'All Team',teams:['Renamed','Beta']}])
 assert.deepEqual(await cli('canvas','view'),initialViewport)
 console.log('PASS CLI Team views: create, membership, reordering, rename/delete sync, fixed-scale guard, restart persistence and All Team protection; no model calls')
}finally{if(service&&!service.killed){service.kill('SIGTERM');await ended}fs.rmSync(temp,{recursive:true,force:true})}
