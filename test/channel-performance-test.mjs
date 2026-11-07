// Actual Core/HTTP, indexed Python archive and a bounded simulated network delay.
// Large synthetic history and image originals exist only in the separate server fixture.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),server=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-archive-server-')),f=await fixtureCore(),checks=[],operations=[]
const rpc=async(cmd,args={})=>{const r=await f.request(null,cmd,args);assert.ok(r.ok,r.error);return r.data}
const python=spawn(process.env.AGENTS_ARCHIVE_TEST_PYTHON||'python3',['-B','-u','-c',`import sys,json,time,random,hashlib
from pathlib import Path
sys.path.insert(0,${JSON.stringify(path.join(root,'Collectors'))})
from channel_content import ChannelContentStore
store=ChannelContentStore(Path(${JSON.stringify(server)}),Path(${JSON.stringify(path.join(server,'originals'))}))
for line in sys.stdin:
 try:
  job=json.loads(line);args=job['args'];operation=job['operation']
  if operation=='fixture-seed':
   count=args['count'];now=int(time.time()*1000)
   for start in range(0,count,100):
    changes=[]
    for i in range(start,min(start+100,count)):
     row={'id':'np_fixture_'+str(i),'source_id':args['sourceId'],'external_id':str(i),'state':'active','title':'Archive '+str(i),'body':('OLDEST_ARCHIVE_NEEDLE ' if i==0 else '')+'Synthetic source text. '*100,'published_at':now-(count-i)*86400000,'received_at':now-(count-i)*1000,'updated_at':now,'saved_at':None,'media_ids':'[]','remote_files':'[]','content_hash':str(i),'payload_hash':str(i),'author_name':None,'author_url':None,'url':None,'avatar_media_id':None,'forget_at':None,'telegram':None,'expires_at':9007199254740991}
     changes.append({'table':'posts','key':row['id'],'row':row})
    store.execute('write',{'changes':changes})
   result={'count':count,'rawHistoryBytes':store.db.execute('SELECT SUM(length(data)) FROM content').fetchone()[0]}
  elif operation=='fixture-image':
   from PIL import Image
   file=store.root/'noise.png';Image.frombytes('RGB',(1600,1000),random.Random(7).randbytes(1600*1000*3)).save(file)
   data=file.read_bytes();digest=hashlib.sha256(data).hexdigest();target=store.source_media/digest[:2]/digest;target.parent.mkdir(parents=True,exist_ok=True);file.replace(target);result={'sha256':digest,'bytes':len(data)}
  else:result=store.execute(operation,args)
  print(json.dumps({'result':result}),flush=True)
 except Exception as e:print(json.dumps({'error':str(e)}),flush=True)
store.close()
`],{stdio:['pipe','pipe','pipe']})
const waiting=[];let diagnostics='';python.stderr.on('data',v=>diagnostics+=v);createInterface({input:python.stdout}).on('line',line=>waiting.shift()?.(JSON.parse(line)))
const execute=job=>new Promise(resolve=>{waiting.push(resolve);python.stdin.write(JSON.stringify(job)+'\n')})
let stopping=false,workers=[]
const pass=name=>{checks.push(name);console.log('PASS '+name)}
try{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 await rpc('channel.settings',{patch:{enabled:true,port}})
 const source=await rpc('channel.source-add',{plugin:'x',locator:'archivefixture',name:'Archive author'}),issued=await rpc('channel.collector-add',{name:'Archive fixture',sourceIds:'all'}),host=await rpc('host.create',{name:'Archive server',host:'fixture',os:'linux',defaultDirectory:server})
 const count=12000,seeded=await execute({operation:'fixture-seed',args:{sourceId:source.id,count}});assert.ok(seeded.result,seeded.error)
 await rpc('channel.storage',{patch:{collectorId:issued.collector.id,hostId:host.id,directory:server}})
 const external=async(cmd,args={})=>{const r=await fetch(`http://127.0.0.1:${port}/api/channels/collector`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});const j=await r.json();assert.ok(j.ok,j.error);return j.data}
 workers=Array.from({length:8},()=> (async()=>{while(!stopping){try{const {jobs}=await external('channel.storage-exchange',{waitMs:50});for(const job of jobs){operations.push(job.operation);await new Promise(r=>setTimeout(r,20));const reply=await execute(job);await external('channel.storage-result',{id:job.id,...reply})}}catch(e){if(!stopping)throw e}}})())
 const start=performance.now(),first=await rpc('channel.posts',{channelId:source.channelId,limit:24}),coldMs=Math.round(performance.now()-start)
 assert.equal(first.total,count);assert.equal(first.posts.length,24);assert.equal(first.posts[0].id,'np_fixture_11999');if(process.env.AGENTS_ARCHIVE_BENCHMARK_LEGACY!=='1')assert.ok(coldMs<1800,'cold first page must not load the history')
 if(process.env.AGENTS_ARCHIVE_BENCHMARK_LEGACY==='1'){fs.writeFileSync(path.join(root,'artifacts/channel-performance/legacy-core-result.json'),JSON.stringify({passed:true,coldMs,archiveMessages:count,transferredSnapshotPages:operations.filter(x=>x==='snapshot').length,rawHistoryBytes:seeded.result.rawHistoryBytes},null,2)+'\n');console.log('Legacy isolated cold page '+coldMs+' ms')}else{
 assert.ok(!operations.includes('snapshot'));assert.equal(operations.filter(x=>x==='posts-page').length,1)
 let state=await rpc('channel.storage');assert.equal(state.memory.cachedPosts,24)
 pass('Cold load reads one 24-item page from 12000 archived messages without a full snapshot')
 let cursor=first.nextCursor
 for(let i=0;i<20;i++){const page=await rpc('channel.posts',{channelId:source.channelId,cursor,limit:100});assert.equal(page.total,count);cursor=page.nextCursor}
 state=await rpc('channel.storage');assert.ok(state.memory.cachedPosts<=384);assert.ok(state.memory.textBytes<8*1024*1024)
 pass('Paging thousands of messages keeps the Mac Core cache below 384 messages and 8 MiB of text')
 const query=await rpc('channel.posts',{channelId:source.channelId,query:'OLDEST_ARCHIVE_NEEDLE',limit:24});assert.equal(query.total,1);assert.equal(query.posts[0].id,'np_fixture_0')
 assert.equal((await rpc('channel.post',{id:'np_fixture_11999'})).id,'np_fixture_11999')
 pass('Old history remains searchable through the server index after Mac RAM eviction; individual entries reload on demand')
 const timeline=await rpc('channel.timeline',{id:source.channelId,kind:'news',limit:3}),older=await rpc('channel.timeline',{id:source.channelId,kind:'news',limit:3,cursor:timeline.nextCursor})
 assert.equal(timeline.entries.length,3);assert.ok(older.entries.every(row=>!timeline.entries.some(other=>other.id===row.id)))
 const global=await rpc('messenger.search',{conversation:'channel:'+source.channelId,query:'Archive 1234',limit:10});assert.equal(global.total,1);assert.equal(global.messages[0].id,'np_fixture_1234')
 pass('Existing timeline cursors and Messenger search read the archive beyond the in-memory window')
 const marked=await rpc('channel.acknowledge',{id:source.channelId,all:true});assert.equal(marked.unreadCount,0)
 assert.equal((await rpc('channel.list')).find(c=>c.id===source.channelId).unreadCount,0)
 assert.equal((await rpc('channel.read-state',{id:source.channelId,entryIds:['np_fixture_3']})).entries[0].state,'read')
 pass('Mark-all uses source watermarks without importing thousands of read IDs or bodies into Mac memory')
 const image=await execute({operation:'fixture-image',args:{}});assert.ok(image.result,image.error)
 const externalId='server-photo',publishedAt=Date.now()-1000,registered=await external('channel.media-register',{sourceId:source.id,externalId,publishedAt,mediaKey:'photo',name:'Original.png',mimeType:'image/png',...image.result})
 const post=await external('channel.publish',{sourceId:source.id,externalId,publishedAt,title:'Server image',body:'Registered without Mac image bytes',mediaIds:[registered.media.id]})
 const preview=await rpc('channel.image',{channelId:source.channelId,postId:post.id,mediaId:registered.media.id,maxEdge:640})
 assert.equal(preview.mimeType,'image/webp');assert.ok(Buffer.from(preview.data,'base64').length<image.result.bytes/5);assert.ok(!operations.includes('asset-put'))
 pass('Collector registers original images on the server; the Mac receives a small preview instead of forwarding full originals')
 const database=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true});for(const table of ['posts','media','source_avatars'])assert.equal(database.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);database.close();assert.equal(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')).length,0)
 assert.equal(diagnostics,'');fs.mkdirSync(path.join(root,'artifacts/channel-performance'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/channel-performance/core-result.json'),JSON.stringify({passed:true,checks,coldMs,archiveMessages:count,legacyFullSnapshotBytes:seeded.result.rawHistoryBytes,legacySnapshotPages:Math.ceil(count/100),mac:state.memory,previewBytes:Buffer.from(preview.data,'base64').length,originalBytes:image.result.bytes,operations:operations.reduce((a,k)=>(a[k]=(a[k]??0)+1,a),{}),modelCalls:0},null,2)+'\n')
 }
}finally{stopping=true;await f.close();await Promise.allSettled(workers);python.stdin.end();await new Promise(r=>python.once('close',r));fs.rmSync(server,{recursive:true,force:true})}
