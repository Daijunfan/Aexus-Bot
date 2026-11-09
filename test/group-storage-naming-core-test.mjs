// Real local/remote migration protocol; explicitly selected group storage stays in place.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {localTunnel} from './fixtures/local-tunnel.mjs'
const root=process.cwd(),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-bound-naming-'))),shared=path.join(temp,'shared'),localParent=path.join(shared,'用户父目录'),local=path.join(localParent,'自定群文件'),remoteRoot=path.join(temp,'云端项目'),remote=path.join(remoteRoot,'自定云群文件')
for(const directory of [local,remote,path.join(shared,'可整理资料'),path.join(remoteRoot,'可整理资料')])fs.mkdirSync(directory,{recursive:true})
fs.writeFileSync(path.join(local,'原始.txt'),'Local original');fs.writeFileSync(path.join(remote,'原始.txt'),'Remote original');const foreign=JSON.stringify({owner:'An unrelated parent application',preserve:true});fs.writeFileSync(path.join(localParent,'workspace.json'),foreign);fs.writeFileSync(path.join(shared,'可整理资料','keep.txt'),'Unrelated local bytes');fs.writeFileSync(path.join(remoteRoot,'可整理资料','keep.txt'),'Unrelated remote bytes')
const f=await fixtureCore({AGENTS_COMPANY_SHARED_DIR:shared,AGENTS_COMPANY_TUNNEL_DIR:localTunnel(path.join(temp,'tunnel'),root)}),rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data}
try{
 await rpc('group.add',{name:'Studio'});const employee=await f.create('Member','Studio'),token=await f.token(employee.id),host=await rpc('host.create',{name:'Fixture host',host:'fixture',os:'linux',defaultDirectory:remoteRoot});await rpc('group.add',{name:'Cloud project',mode:'cloud',hostId:host.id,directoryMode:'bind',directory:remoteRoot})
 const localGroup=await rpc('chat.create',{name:'Local visible group',members:[employee.id],storage:{mode:'bind',directory:local}}),remoteGroup=await rpc('chat.create',{name:'Cloud visible group',members:[employee.id],storage:{mode:'bind',hostId:host.id,directory:remote}})
 assert.equal((await f.request(token,'assets.naming',{})).ok,false)
 const preview=await rpc('assets.naming');assert.ok(!preview.local.some(item=>item.from===local||local.startsWith(item.from+path.sep)),'A naming plan must not move a chosen local group location or its ancestors');assert.ok(preview.preserved?.some(item=>item.id==='group:'+localGroup.id));assert.ok(preview.preserved?.some(item=>item.id==='group:'+remoteGroup.id));assert.ok(preview.remote.every(item=>item.renames.every(rename=>rename.from!==remote&&!remote.startsWith(rename.from+'/'))))
 const applied=await rpc('assets.naming',{id:preview.id,apply:true});assert.equal(applied.applied,true);assert.ok(!fs.lstatSync(local).isSymbolicLink());assert.ok(!fs.lstatSync(remote).isSymbolicLink());assert.equal(fs.readFileSync(path.join(localParent,'workspace.json'),'utf8'),foreign)
 for(const [group,location,text]of [[localGroup,local,'Local original'],[remoteGroup,remote,'Remote original']]){const workspace=await rpc('conversation.workspace',{conversation:'group:'+group.id});assert.equal(workspace.root,location);assert.equal((await rpc('conversation.file',{conversation:'group:'+group.id,operation:'read',path:'原始.txt'},token)).content,text)}
 assert.equal(fs.readFileSync(path.join(shared,'可整理资料','keep.txt'),'utf8'),'Unrelated local bytes');assert.equal(fs.readFileSync(path.join(remoteRoot,'可整理资料','keep.txt'),'utf8'),'Unrelated remote bytes');assert.ok(applied.local.renamed>0);assert.ok(applied.remote.some(item=>item.renamed>0))
 console.log('PASS local/cloud chosen group locations, ancestor paths, original bytes, membership access and unrelated parent metadata survive directory naming; unbound sibling folders still migrate')
 const another=await rpc('assets.naming');await rpc('host.update',{id:host.id,patch:{name:'Changed host configuration'}});assert.equal((await f.request(null,'assets.naming',{id:another.id,apply:true})).ok,false,'A host configuration change invalidates its old migration preview');console.log('PASS host changes invalidate stale migration plans before file operations; ordinary members cannot administer migration')
}finally{await f.close();fs.rmSync(temp,{recursive:true,force:true})}
