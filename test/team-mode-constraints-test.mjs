// Real CLI/Core validation, disposable state; invalid cloud/plugin requests never reach SSH.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
try{
 const host=await rpc('host.create',{name:'Never contact',host:'no-network.invalid',os:'linux',defaultDirectory:'/srv/projects'})
 const initial=await rpc('session.list')
 for(const pluginId of ['mininotion','margin-reader','cloud-hosts'])for(const hostId of [host.id,'unknown-host']){
  const result=await f.request(null,'group.add',{name:'Forbidden cloud plugin',mode:'cloud',pluginId,hostId,directory:'/srv/projects'})
  assert.equal(result.ok,false);assert.match(result.error,/云端团队不支持插件/)
 }
 const cli=await f.raw(null,'group','add','Forbidden CLI','--mode','cloud','--plugin','mininotion','--host-id',host.id);assert.equal(cli.ok,false);assert.match(cli.error,/云端团队不支持插件/)
 const state=await rpc('session.list');assert.deepEqual(state.groups,initial.groups);assert.deepEqual(state.teamRoots,initial.teamRoots)
 await f.stop();const file=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json'),legacy=JSON.parse(fs.readFileSync(file));legacy.groups.push('Unbound legacy');legacy.teamSettings={...legacy.teamSettings,'Unbound legacy':{mode:'build'}};fs.writeFileSync(file,JSON.stringify(legacy));await f.start()
 const configured=await f.request(null,'group.configure',{name:'Unbound legacy',mode:'cloud',pluginId:'mininotion',hostId:host.id,directory:'/srv/projects'});assert.equal(configured.ok,false);assert.match(configured.error,/云端团队不支持插件/)
 await rpc('group.add',{name:'Local project',mode:'build'});await rpc('group.add',{name:'Local plugin',mode:'work',pluginId:'mininotion'})
 const valid=await rpc('session.list');assert.equal(valid.teamSettings['Local project'].mode,'build');assert.equal(valid.teamSettings['Local plugin'].mode,'work');assert.equal(valid.teamSettings['Local plugin'].pluginId,'mininotion');assert.ok(!valid.teamSettings['Local plugin'].hostId)
 console.log('PASS cloud/plugin combinations rejected through Core and CLI before host lookup/SSH; unbound configure also rejects; local project/plugin creation remains functional')
}finally{await f.close()}
