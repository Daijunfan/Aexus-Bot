import {collectorSourceRoot} from './fixtures/collector-source.mjs'
// Real Core, authenticated collector HTTP and Python SQLite archive. No production data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),server=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-read-archive-')),f=await fixtureCore(),checks=[],operations=[]
const rpc=async(cmd,args={})=>{const value=await f.request(null,cmd,args);assert.ok(value.ok,value.error);return value.data}
const python=spawn(process.env.AGENTS_ARCHIVE_TEST_PYTHON||'python3',['-B','-u','-c',`import sys,json
from pathlib import Path
sys.path.insert(0,${JSON.stringify(collectorSourceRoot)})
from channel_content import ChannelContentStore
store=ChannelContentStore(Path(${JSON.stringify(server)}))
for line in sys.stdin:
 try:
  request=json.loads(line);print(json.dumps({'result':store.execute(request['operation'],request['args'])}),flush=True)
 except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
store.close()`],{stdio:['pipe','pipe','pipe']})
const waiting=[];let diagnostics='';python.stderr.on('data',chunk=>diagnostics+=chunk);createInterface({input:python.stdout}).on('line',line=>waiting.shift()?.(JSON.parse(line)))
const execute=job=>new Promise(resolve=>{waiting.push(resolve);python.stdin.write(JSON.stringify(job)+'\n')})
let stopping=false,holdNext=false,held,releaseHold,failNextMark=false,holdMark=false,markHeld=false,releaseMark,marksCompleted=0,workers=[]
const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 await rpc('channel.settings',{patch:{enabled:true,port}})
 const source=await rpc('channel.source-add',{plugin:'x',locator:'@readarchive',name:'Reader source'}),other=await rpc('channel.source-add',{plugin:'youtube',locator:'@foreignread',name:'Other source'}),issued=await rpc('channel.collector-add',{name:'Read archive fixture',sourceIds:'all'}),host=await rpc('host.create',{name:'Synthetic archive',host:'fixture',os:'linux',defaultDirectory:server})
 const external=async(cmd,args={})=>{const response=await fetch(`http://127.0.0.1:${port}/api/channels/collector`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data}
 await rpc('channel.storage',{patch:{collectorId:issued.collector.id,hostId:host.id,directory:server}})
 workers=Array.from({length:3},()=> (async()=>{while(!stopping){try{const data=await external('channel.storage-exchange',{waitMs:50});await Promise.all(data.jobs.map(async job=>{
  operations.push(job.operation)
  let reply
  if(job.operation==='read-mark'&&holdMark){holdMark=false;markHeld=true;await new Promise(resolve=>releaseMark=resolve)}
  if(job.operation==='read-mark'&&failNextMark){failNextMark=false;reply={error:'Synthetic archive write failure'}}else reply=await execute(job)
  if(job.operation==='summaries'&&holdNext){holdNext=false;held={job,reply};await new Promise(resolve=>releaseHold=resolve)}
  await external('channel.storage-result',{id:job.id,...reply});if(job.operation==='read-mark')marksCompleted++
 }))}catch(error){if(!stopping)throw error}}})())
 const posts=[],stamp=Date.now()-5000
 for(let i=0;i<120;i++)posts.push(await external('channel.publish',{sourceId:source.id,externalId:'read-'+i,publishedAt:stamp-i,title:'Read fixture '+i,body:'SYNTHETIC_READ_BODY '+i}))
 await external('channel.publish',{sourceId:other.id,externalId:'foreign',publishedAt:stamp,title:'Other channel',body:'Independent unread'})
 const summary=async id=>(await rpc('channel.list')).find(c=>c.id===id)
 assert.equal((await summary(source.channelId)).unreadCount,120)
 await rpc('channel.posts',{channelId:source.channelId,limit:24})
 // Hold a real old summary response while a different worker commits the read.
 const startOldSummary=async()=>{held=undefined;holdNext=true;await rpc('channel.source-update',{id:source.id,patch:{name:'Reader '+Date.now()}});await f.until(()=>held,'held old summary')}
 await startOldSummary();let completed=false;const ack=rpc('channel.acknowledge',{id:source.channelId,entryIds:[posts[0].id]}).then(value=>{completed=true;return value})
 await f.until(()=>marksCompleted>0,'archive read-mark completion');assert.equal(completed,false,'receipt must await a fresh post-commit summary');releaseHold();const first=await ack
 assert.equal(first.unreadCount,119);assert.equal(first.acknowledgedCount,1);assert.equal((await summary(source.channelId)).unreadCount,119);assert.equal((await summary(other.channelId)).unreadCount,1)
 pass('An in-flight pre-read summary cannot leave the archived unread badge stale; the committed response and subsequent catalog agree')
 failNextMark=true;const failed=await f.request(null,'channel.acknowledge',{id:source.channelId,entryIds:[posts[1].id]});assert.equal(failed.ok,false);assert.match(failed.error,/archive write failure/)
 let disk=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true});assert.equal(disk.prepare('SELECT entry_id FROM channel_user_reads WHERE entry_id=?').get(posts[1].id),undefined);disk.close()
 assert.equal((await rpc('channel.read-state',{id:source.channelId,entryIds:[posts[1].id]})).entries[0].state,'unread')
 assert.equal((await summary(source.channelId)).unreadCount,119)
 pass('A rejected archive read write does not create a false local read marker or lower the remaining count')
 const retry=await rpc('channel.acknowledge',{id:source.channelId,entryIds:[posts[1].id]});assert.equal(retry.unreadCount,118);assert.equal((await summary(source.channelId)).unreadCount,118)
 const again=await rpc('channel.acknowledge',{id:source.channelId,entryIds:[posts[1].id]});assert.equal(again.acknowledgedCount,0);assert.equal(again.unreadCount,118)
 const beforeMarks=marksCompleted;await startOldSummary();completed=false
 const all=rpc('channel.acknowledge',{id:source.channelId,all:true}).then(value=>{completed=true;return value});await f.until(()=>marksCompleted>beforeMarks,'bulk archive commit');assert.equal(completed,false);releaseHold();const result=await all
 assert.equal(result.unreadCount,0);assert.equal(result.acknowledgedCount,118);assert.equal((await summary(source.channelId)).unreadCount,0);assert.equal((await summary(other.channelId)).unreadCount,1)
 pass('Bulk/one-source reads publish only after durable archive state and a new summary, including unloaded history; retries are idempotent')
 const next=await external('channel.publish',{sourceId:source.id,externalId:'after-read',publishedAt:stamp-10000,title:'Late original-date arrival',body:'New arrival remains unread'})
 assert.equal((await summary(source.channelId)).unreadCount,1);assert.equal((await rpc('channel.read-state',{id:source.channelId,entryIds:[next.id]})).entries[0].state,'unread')
 holdMark=true;const racing=rpc('channel.acknowledge',{id:source.channelId,all:true});await f.until(()=>markHeld,'held read request')
 const during=await external('channel.publish',{sourceId:source.id,externalId:'during-read',publishedAt:stamp-20000,title:'Arrived during read',body:'Keep this new arrival unread'})
 await f.until(async()=>(await summary(source.channelId)).unreadCount===2,'new arrival archived');releaseMark();const raced=await racing
 assert.equal(raced.unreadCount,1);assert.equal((await rpc('channel.read-state',{id:source.channelId,entryIds:[during.id]})).entries[0].state,'unread')
 const localReads=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true});assert.equal(localReads.prepare('SELECT entry_id FROM channel_user_reads WHERE entry_id=?').get(during.id),undefined);localReads.close()
 pass('A news item arriving during a held bulk read stays unread both on the archive and local mirror; old acknowledgments cannot clear a newer reception')
 disk=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true});assert.equal(disk.prepare('SELECT count(*) n FROM posts').get().n,0);assert.equal(disk.prepare('SELECT count(*) n FROM media').get().n,0);disk.close()
 assert.deepEqual(await rpc('session.list',{live:true}),[]);assert.equal(diagnostics,'')
 pass('Later old-date arrivals remain unread; metadata receipts do not save news bodies, media or start employees')
 fs.writeFileSync(path.join(root,'artifacts/read-sync/archive-result.json'),JSON.stringify({passed:true,checks,modelCalls:0,productionDataUsed:false},null,2)+'\n')
}finally{stopping=true;releaseHold?.();await f.close();await Promise.allSettled(workers);python.stdin.end();await new Promise(resolve=>python.once('close',resolve));fs.rmSync(server,{recursive:true,force:true})}
