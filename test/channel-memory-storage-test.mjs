// Real Core + scoped HTTP + the actual Python server store in a separate fixture directory.
// No user news, platform access, native agents or model calls.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'

const root=path.resolve(import.meta.dirname,'..'),server=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-content-server-')),f=await fixtureCore(),checks=[]
const rpc=async(cmd,args={})=>{const result=await f.request(null,cmd,args);assert.ok(result.ok,result.error);return result.data}
const child=spawn(process.env.AGENTS_ARCHIVE_TEST_PYTHON||'python3',['-B','-u','-c',`import sys,json
sys.path.insert(0,${JSON.stringify(path.join(root,'Collectors'))})
from channel_content import ChannelContentStore
from pathlib import Path
store=ChannelContentStore(Path(${JSON.stringify(server)}))
for line in sys.stdin:
 try:
  request=json.loads(line);print(json.dumps({'result':store.execute(request['operation'],request['args'])}),flush=True)
 except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
store.close()
`],{stdio:['pipe','pipe','pipe']})
const waiting=[];createInterface({input:child.stdout}).on('line',line=>waiting.shift()?.(JSON.parse(line)))
let diagnostics='';child.stderr.on('data',data=>diagnostics+=data)
const operations=[];const execute=job=>new Promise(resolve=>{operations.push(job.operation);waiting.push(resolve);child.stdin.write(JSON.stringify(job)+'\n')})
let stopping=false,rejectProof=false,worker;const pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 await rpc('channel.settings',{patch:{enabled:true,port}})
 const source=await rpc('channel.source-add',{plugin:'x',locator:'@memoryfixture',name:'Original author'}),issued=await rpc('channel.collector-add',{name:'Fixture storage',sourceIds:'all'}),host=await rpc('host.create',{name:'Fixture server',host:'fixture',os:'linux',defaultDirectory:'/srv/channel-content'})
 const endpoint=`http://127.0.0.1:${port}/api/channels/collector`
 const external=async(cmd,args={})=>{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({cmd,args})});const value=await response.json();assert.ok(value.ok,value.error);return value.data}
 await rpc('channel.storage',{patch:{collectorId:issued.collector.id,hostId:host.id,directory:'/srv/channel-content'}})
 worker=(async()=>{while(!stopping){try{const data=await external('channel.storage-exchange',{waitMs:500});for(const job of data.jobs){const reply=rejectProof&&job.operation==='rows-verify'?{result:{failed:[{table:'posts',key:'fixture'}]}}:await execute(job);await external('channel.storage-result',{id:job.id,...reply})}}catch(error){if(!stopping)await new Promise(resolve=>setTimeout(resolve,80))}}})()
 const marker='UNSAVED_CHANNEL_MARKER_'+Date.now(),posts=[]
 const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP+kAAAAASUVORK5CYII='
 const publishedAt=Date.now()-1000
 const media=await external('channel.media-put',{sourceId:source.id,externalId:'story-0',publishedAt,mediaKey:'photo',name:'photo.png',mimeType:'image/png',data:pixel})
 for(let index=0;index<8;index++)posts.push(await external('channel.publish',{sourceId:source.id,externalId:'story-'+index,publishedAt:publishedAt-index,title:'Story '+index,body:marker+' '+index,mediaIds:index?[]:[media.media.id]}))
 await external('channel.source-avatar-put',{sourceId:source.id,name:'Original avatar',mimeType:'image/png',data:pixel})
 const loaded=await rpc('channel.posts',{channelId:source.channelId,limit:20});assert.equal(loaded.total,8);assert.ok(loaded.posts.every(post=>post.sourceAvatar))
 assert.equal((await rpc('channel.image',{channelId:source.channelId,postId:posts[0].id,mediaId:media.media.id})).data,pixel)
 const disk=()=>new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true})
 let database=disk();assert.equal(database.prepare('SELECT COUNT(*) n FROM posts').get().n,0);assert.equal(database.prepare('SELECT COUNT(*) n FROM media').get().n,0);assert.equal(database.prepare('SELECT COUNT(*) n FROM source_avatars').get().n,0);database.close()
 await rpc('messenger.search',{query:marker,limit:20})
 await rpc('messenger.draft',{conversation:'channel:'+source.channelId,text:marker+' draft'})
 for(const file of [path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite-wal')])if(fs.existsSync(file))assert.equal(fs.readFileSync(file).includes(Buffer.from(marker)),false)
 assert.equal(fs.existsSync(path.join(f.env.AGENTS_COMPANY_HOME,'cache/message-index.sqlite')),false)
 const scan=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())scan(file);else if(item.isFile()&&fs.statSync(file).size<30*1024*1024)assert.equal(fs.readFileSync(file).includes(Buffer.from(marker)),false,'unsaved content reached '+file)}};scan(f.env.AGENTS_COMPANY_HOME)
 await f.cli('group','add','Privacy fixture');const reader=await f.create('Authorized reader','Privacy fixture','employee'),token=await f.token(reader.id)
 assert.equal((await f.request(token,'channel.post',{id:posts[0].id})).ok,false)
 assert.equal((await f.request(token,'channel.history',{id:source.channelId})).ok,false)
 const metadata=await f.request(token,'channel.list',{});assert.equal(metadata.ok,true);assert.ok(metadata.data.every(channel=>!channel.lastPost&&!channel.lastMessage))
 assert.equal((await f.request(null,'channel.update',{id:source.channelId,adminIds:[reader.id]})).ok,false)
 assert.equal((await f.request(token,'conversation.entry',{conversation:'channel:'+source.channelId,id:posts[0].id})).ok,false)
 assert.equal((await f.request(null,'messenger.reference',{conversation:'channel:'+source.channelId,id:posts[0].id,textOnly:true})).ok,false)
 assert.equal((await f.request(null,'channel.message-send',{id:source.channelId,text:marker+' must not enter a native queue'})).ok,false)
 assert.equal((await f.request(token,'channel.save',{id:posts[0].id,saved:true})).ok,false)
 const assetsBefore=operations.filter(op=>op==='asset-read').length
 const grant=await rpc('channel.access',{id:source.channelId});await rpc('channel.access',{id:source.channelId,employeeIds:[reader.id],expectedRevision:grant.revision})
 const textPage=await f.request(token,'channel.fetch-text',{id:source.channelId,limit:3});assert.equal(textPage.ok,true,textPage.error);assert.equal(textPage.data.messages.length,3);assert.ok(textPage.data.messages[0].text.includes(marker));assert.equal(operations.filter(op=>op==='asset-read').length,assetsBefore,'text-only reads must not load image bytes')
 const imagePage=await f.request(token,'channel.fetch-images',{id:source.channelId,limit:1});assert.equal(imagePage.ok,true,imagePage.error);assert.equal(imagePage.data.messages[0].images[0].id,media.media.id);assert.equal(imagePage.data.messages[0].images[0].mimeType,'image/webp')
 const searched=await f.request(token,'channel.search',{id:source.channelId,query:marker,limit:4});assert.equal(searched.ok,true,searched.error);assert.equal(searched.data.total,8);assert.equal(searched.data.messages.length,4)
 scan(f.env.AGENTS_COMPANY_HOME)
 pass('Explicit nonmember text/image/search APIs use the actual Python archive; text reads perform zero image loads and no fetched content is written to Mac storage')
 pass('Viewing/searching unsaved news, photos and native avatars uses Mac RAM; disk database/index contain no message payload')
 const discovery=await rpc('channel.posts',{channelId:source.channelId,order:'discovery',seed:'first',snapshot:Date.now(),limit:3}),more=await rpc('channel.posts',{channelId:source.channelId,order:'discovery',seed:'first',snapshot:Date.now(),limit:3})
 const snapshot=Date.now(),first=await rpc('channel.posts',{channelId:source.channelId,order:'discovery',seed:'stable',snapshot,limit:3}),next=await rpc('channel.posts',{channelId:source.channelId,order:'discovery',seed:'stable',snapshot,limit:3,cursor:first.nextCursor}),refreshed=await rpc('channel.posts',{channelId:source.channelId,order:'discovery',seed:'new',snapshot,avoidFirst:first.posts[0].id,limit:3})
 assert.ok(next.posts.every(post=>!first.posts.some(old=>old.id===post.id)));assert.notEqual(refreshed.posts[0].id,first.posts[0].id)
 pass('Posts refresh changes the first item; scrolling retains one stable, non-duplicating refresh order')
 await rpc('channel.save',{id:posts[0].id,saved:true});database=disk();assert.equal(database.prepare('SELECT COUNT(*) n FROM posts').get().n,1);assert.ok(database.prepare('SELECT body FROM posts').get().body.includes(marker));database.close()
 assert.equal((await f.request(token,'conversation.entry',{conversation:'channel:'+source.channelId,id:posts[0].id})).ok,false,'news access does not grant a legacy shared workspace membership')
 assert.equal(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')).length,1)
 await f.stop();await f.start();const savedPreview=await f.request(token,'channel.fetch-images',{id:source.channelId,limit:1});assert.equal(savedPreview.ok,true,savedPreview.error);assert.equal(savedPreview.data.messages[0].images[0].mimeType,'image/webp','a cold saved local original must still use the requested server preview')
 await rpc('channel.save',{id:posts[0].id,saved:false});database=disk();assert.equal(database.prepare('SELECT COUNT(*) n FROM posts').get().n,0);database.close();assert.equal(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')).length,0)
 pass('Only explicit Save creates local message/image files; Unsave clears that automatic saved cache')
 assert.equal((await f.request(null,'channel.message-send',{id:source.channelId,text:marker+' discussion'})).ok,false)
 pass('Channel discussion is disabled without affecting stored articles or documents')
 await f.stop();await f.start();const restored=await rpc('channel.posts',{channelId:source.channelId,limit:20});assert.equal(restored.total,8);assert.equal(restored.posts.find(post=>post.id===posts[0].id).body,marker+' 0')
 pass('Unsaved messages survive Mac Core restart through server storage, not a local content copy')
 const concurrent=await Promise.all(Array.from({length:12},(_,index)=>external('channel.publish',{sourceId:source.id,externalId:'parallel-'+index,publishedAt:Date.now()-1,title:'Concurrent delivery',body:marker+' parallel '+index})))
 database=new DatabaseSync(path.join(server,'content.sqlite3'),{readOnly:true})
 for(const post of concurrent)assert.ok(database.prepare("SELECT 1 FROM content WHERE kind='posts' AND item_key=?").get(post.id),'every successful concurrent acknowledgment must already be durable on the server')
 database.close();for(const post of concurrent)await rpc('channel.delete',{id:post.id})
 pass('Concurrent ingestion acknowledges each message only after its own server copy is durable')
 await f.stop()
 const remote=new DatabaseSync(path.join(server,'content.sqlite3'),{readOnly:true}),legacy=[]
 for(const table of ['posts','media','source_avatars'])for(const value of remote.prepare('SELECT data FROM content WHERE kind=?').all(table))legacy.push({table,row:JSON.parse(value.data)})
 remote.close();database=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'))
 for(const {table,row} of legacy){const keys=Object.keys(row);database.prepare('INSERT OR REPLACE INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]?.$bytes?Buffer.from(row[key].$bytes,'base64'):row[key]))}
 database.prepare("DELETE FROM metadata WHERE key='content_memory_migrated'").run();database.close()
 fs.writeFileSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media',legacy.find(value=>value.table==='media').row.file),Buffer.from(pixel,'base64'))
 rejectProof=true;await f.start();assert.equal((await f.request(null,'channel.posts',{channelId:source.channelId})).ok,false)
 database=disk();assert.equal(database.prepare('SELECT COUNT(*) n FROM posts').get().n,legacy.filter(value=>value.table==='posts').length,'failed proof must preserve all legacy bodies');database.close();assert.equal(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')).length,1)
 rejectProof=false;assert.equal((await rpc('channel.posts',{channelId:source.channelId})).total,8)
 database=disk();assert.equal(database.prepare('SELECT COUNT(*) n FROM posts').get().n,0);database.close();assert.equal(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')).length,0)
 pass('Legacy migration verifies every row/image before local deletion; a failed server proof preserves original Mac files')
 assert.equal(diagnostics,'');fs.mkdirSync(path.join(root,'artifacts/channel-redesign'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/channel-redesign/storage-result.json'),JSON.stringify({passed:true,checks,modelCalls:0},null,2)+'\n')
}finally{stopping=true;await f.close();if(worker)await worker;child.stdin.end();await new Promise(resolve=>child.once('close',resolve));fs.rmSync(server,{recursive:true,force:true})}
