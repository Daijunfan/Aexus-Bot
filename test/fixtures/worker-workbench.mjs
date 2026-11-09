import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {fixtureCore} from './headless-core.mjs'
import {writeNativeProfiles} from './native-profiles.mjs'
export const workerEngines=['codex','claude','cline','pi','opencode','kilo','deepseek']
export const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')
export async function workerWorkbenchFixture(extra={}){
 const root=process.cwd(),native=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-worker-workbench-')),adapter=path.join(root,'test/fixtures/process-adapter.cjs'),acp=path.join(root,'test/fixtures/worker-acp.cjs')
 const content=JSON.stringify({model:'fixture/native-1',provider:{fixture:{options:{apiKey:'fixture-only-not-real'},models:{'native-1':{name:'Native One',variants:{low:{},high:{}}},'native-2':{name:'Native Two',variants:{low:{},high:{}}}}}}})
 const f=await fixtureCore({HOME:native,USERPROFILE:native,AC_NATIVE_WORKER_FIXTURE:'1',AC_WORKER_PARITY:'1',CLINE_BIN:adapter,PI_BIN:adapter,OPENCODE_BIN:acp,KILO_BIN:acp,DEEPSEEK_BIN:acp,DEEPSEEK_API_KEY:'fixture-only-not-real',XDG_CONFIG_HOME:path.join(native,'config'),XDG_DATA_HOME:path.join(native,'data'),XDG_STATE_HOME:path.join(native,'state'),OPENCODE_CONFIG_CONTENT:content,KILO_CONFIG_CONTENT:content,...extra})
 const core=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
 writeNativeProfiles(f.env,{engines:['cline','pi']});await core('engine.configure',{engine:'claude',patch:{sdkPath:path.join(root,'test/fixtures/discussion-claude-sdk.mjs')}})
 const create=async engine=>{const cwd=path.join(f.temp,'workbench-'+engine);fs.mkdirSync(cwd,{recursive:true});fs.writeFileSync(path.join(cwd,'notes.md'),'# Keep my work\n');fs.writeFileSync(path.join(cwd,'image.png'),tinyPng);return core('worker.create',{engine,cwd,title:engine+' Workbench'})}
 return {...f,core,createWorker:create,close:async()=>{await f.close();fs.rmSync(native,{recursive:true,force:true})}}
}
