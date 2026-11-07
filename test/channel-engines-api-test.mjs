// Real collector HTTP ingress, isolated Core/native fixture and synthetic bytes only.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
const f=await fixtureCore(),rpc=async(cmd,args={},token=null)=>{const r=await f.request(token,cmd,args);assert.ok(r.ok,cmd+': '+r.error);return r.data},deny=async(cmd,args={},token=null)=>assert.equal((await f.request(token,cmd,args)).ok,false,cmd)
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
try{
 await f.cli('group','add','Readers');const a=await f.create('Aster','Readers'),token=await f.token(a.id)
 for(const args of [{name:'No employee engine',engine:{kind:'employees',employeeIds:[a.id]}},{name:'Missing remote address',engine:{kind:'external',name:'Remote',location:'remote'}},{name:'Unsafe endpoint',engine:{kind:'external',name:'Remote',location:'remote',host:'203.0.113.10',endpoint:'http://example.test'}}])await deny('channel.create',args)
 const before=await rpc('channel.collectors');await deny('channel.create',{name:'Atomic invalid avatar',engine:{kind:'external',location:'local',name:'Discarded'},avatar:{name:'bad.png',mimeType:'image/png',data:'not-base64'}});assert.deepEqual(await rpc('channel.list'),[]);assert.deepEqual(await rpc('channel.collectors'),before)
 const remote=await rpc('channel.create',{name:'Remote desk',engine:{kind:'external',location:'remote',name:'Remote collector',host:'203.0.113.10',endpoint:'https://collector.example.test/api/channels/collector'},avatar:{name:'desk.png',mimeType:'image/png',data:png}}),local=await rpc('channel.create',{name:'Local desk',engine:{kind:'external',location:'local',name:'Local collector'}})
 assert.ok(remote.setup.token&&local.setup.token);assert.equal((await rpc('channel.connection',{id:remote.id})).status,'waiting');assert.equal((await rpc('channel.avatar-image',{id:remote.id})).data,png)
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));await rpc('channel.settings',{patch:{enabled:true,port}})
 const collect=async(key,cmd,args={})=>(await fetch('http://127.0.0.1:'+port+'/api/channels/collector',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({cmd,args})})).json()
 await f.until(async()=>{try{return (await collect(remote.setup.token,'channel.collector-config')).ok}catch{return false}},'collector listening')
 const config=(await collect(remote.setup.token,'channel.collector-config')).data,sourceId=config.targets[0].sourceId,foreign=(await rpc('channel.sources',{channelId:local.id}))[0].id
 assert.equal(config.targets.length,1);assert.equal(config.targets[0].plugin,'process');assert.equal((await rpc('channel.connection',{id:remote.id})).status,'seen')
 const article={sourceId,externalId:'report',publishedAt:Date.now(),title:'Research report',body:'Complete fixture source'}
 const upload=await collect(remote.setup.token,'channel.media-put',{sourceId,externalId:article.externalId,publishedAt:article.publishedAt,mediaKey:'cover',name:'cover.png',mimeType:'image/png',data:png});assert.equal(upload.ok,true,upload.error)
 const submitted=await collect(remote.setup.token,'channel.publish',{...article,mediaIds:[upload.data.media.id]});assert.equal(submitted.ok,true);assert.equal(submitted.data.status,'created');assert.equal((await collect(remote.setup.token,'channel.publish',{...article,mediaIds:[upload.data.media.id]})).data.status,'duplicate')
 assert.equal((await collect(remote.setup.token,'channel.publish',{...article,sourceId:foreign})).ok,false)
 for(const cmd of ['channel.access','channel.update','channel.message-send','session.send'])assert.equal((await collect(remote.setup.token,cmd,{id:remote.id,text:'No authority'})).ok,false)
 const access=await rpc('channel.access',{id:remote.id});await rpc('channel.access',{id:remote.id,employeeIds:[a.id],expectedRevision:access.revision})
 assert.deepEqual((await rpc('channel.get',{id:remote.id},token)).engine,{kind:'external',location:'remote'});assert.equal((await rpc('channel.fetch-images',{id:remote.id,limit:1},token)).messages[0].images[0].data,png)
 await deny('channel.connection',{id:remote.id},token);await deny('channel.publish',{...article,externalId:'forged'},token)
 const rotated=await f.cli('channel','collector-add','--name','Replacement','--channel',remote.id)
 assert.equal((await collect(remote.setup.token,'channel.publish',{...article,externalId:'revoked'})).ok,false);assert.equal((await collect(rotated.token,'channel.publish',{...article,externalId:'new'})).ok,true)
 await rpc('channel.save',{id:submitted.data.id,saved:true});const inventory=JSON.stringify(await rpc('channel.list'));for(const key of [remote.setup.token,local.setup.token,rotated.token])assert.ok(!inventory.includes(key))
 await f.stop();await f.start();assert.equal((await rpc('channel.post',{id:submitted.data.id})).saved,true);assert.equal((await rpc('channel.avatar-image',{id:remote.id})).data,png);assert.deepEqual((await rpc('session.transcript',{employee:a.id})).items,[])
 await rpc('channel.update',{id:remote.id,avatar:null});assert.equal((await rpc('channel.get',{id:remote.id})).avatar,undefined);assert.deepEqual(await rpc('schedule.list'),[])
 console.log('PASS external local/remote engines, atomic avatars, scoped HTTP collector/image publication, rotation, native employee read-only access, secret-free projections and saved-only persistence')
}finally{await f.close()}
