// Real authenticated Core/CLI, isolated synthetic news and deterministic employee engines.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore(),checks=[],rpc=async(cmd,args={},token=null)=>{const value=await f.request(token,cmd,args);assert.ok(value.ok,cmd+': '+value.error);return value.data},pass=label=>{checks.push(label);console.log('PASS '+label)}
try{
 await rpc('group.add',{name:'Readers'});const employees=[]
 for(const role of ['employee','manager','governor','secretary'])employees.push(await f.create(role+' reader','Readers',role))
 const tokens=await Promise.all(employees.map(card=>f.token(card.id)))
 const a=await rpc('channel.source-add',{plugin:'x',locator:'@textreader',name:'Reader author'}),b=await rpc('channel.source-add',{plugin:'x',locator:'@otherreader',name:'Second author'}),other=await rpc('channel.source-add',{plugin:'youtube',locator:'@reader',name:'Other platform'})
 const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP+kAAAAASUVORK5CYII=',stamp=Date.now()-1000,posts=[]
 const image=(await rpc('channel.media-put',{sourceId:a.id,externalId:'news-0',publishedAt:stamp,mediaKey:'photo',name:'photo.png',mimeType:'image/png',data:pixel})).media
 for(let i=0;i<57;i++){
  const media=i===0?image:i<35?(await rpc('channel.media-put',{sourceId:i%2?b.id:a.id,externalId:'news-'+i,publishedAt:stamp-i,mediaKey:'photo',name:'photo.png',mimeType:'image/png',data:pixel})).media:null
  posts.push(await rpc('channel.publish',{sourceId:i%2?b.id:a.id,externalId:'news-'+i,publishedAt:stamp-i,title:'LLM story '+i,body:'Full text '+i+' '+(i===0?'完整正文 '.repeat(1500):'AI/frontier'),mediaIds:media?[media.id]:[]}))
 }
 const unread=await rpc('channel.read-state',{id:a.channelId,entryIds:posts.map(post=>post.id)}),before=await rpc('session.list',{summary:true})
 for(let i=0;i<employees.length-1;i++)assert.deepEqual(await rpc('channel.list',{},tokens[i]),[])
 for(const channel of [a.channelId,other.channelId]){const current=await rpc('channel.access',{id:channel});await rpc('channel.access',{id:channel,employeeIds:employees.slice(0,3).map(e=>e.id),expectedRevision:current.revision})}
 for(const [index,token]of tokens.entries()){
  const list=await rpc('channel.list',{},token);assert.equal(list.length,2);if(index<3)assert.ok(list.every(c=>!c.lastPost&&!c.lastMessage&&!c.engine?.host));assert.equal((await rpc('channel.get',{id:a.channelId},token)).id,a.channelId)
  const page=await rpc('channel.fetch-text',{id:a.channelId,limit:50},token);assert.equal(page.messages.length,50);assert.equal(page.total,57);assert.ok(page.nextCursor);assert.ok(page.messages[0].text.length>4096);assert.ok(page.messages.every(m=>!m.images&&!('saved' in m)&&!('savedAt' in m)))
  const next=await rpc('channel.fetch-text',{id:a.channelId,limit:50,cursor:page.nextCursor},token);assert.equal(next.messages.length,7);assert.equal(next.nextCursor,null);assert.equal(new Set([...page.messages,...next.messages].map(m=>m.id)).size,57)
  const visual=await rpc('channel.fetch-images',{id:a.channelId,limit:1},token);assert.equal(visual.messages[0].images[0].data,pixel);assert.equal(visual.messages[0].images[0].id,image.id)
  const search=await rpc('channel.search',{id:a.channelId,query:'LLM story 0',images:true,limit:3},token);assert.equal(search.total,1);assert.equal(search.messages[0].id,posts[0].id);assert.equal(search.messages[0].images[0].data,pixel)
  const filtered=await rpc('channel.fetch-text',{id:a.channelId,sourceId:b.id,limit:100},token);assert.equal(filtered.messages.length,28);assert.ok(filtered.messages.every(m=>m.sourceId===b.id))
  for(const [cmd,args] of [['channel.fetch-text',{id:a.channelId,limit:0}],['channel.fetch-images',{id:a.channelId,limit:101}],['channel.fetch-text',{id:other.channelId,cursor:page.nextCursor}],['channel.fetch-text',{id:a.channelId,sourceId:b.id,cursor:page.nextCursor}],['channel.search',{id:a.channelId,query:'  '}],['channel.fetch-text',{id:a.channelId,sourceId:other.id}] ,...(index<3?[['channel.save',{id:posts[0].id,saved:true}]]:[]),['channel.message-post',{id:a.channelId,text:'No reply'}]])assert.equal((await f.request(token,cmd,args)).ok,false,cmd+' must reject invalid scope or retired write')
  const available=await rpc('api.list',{},token);for(const command of ['channel.fetch-text','channel.fetch-images','channel.search'])assert.ok(JSON.stringify(available).includes(command))
 }
 pass('Authorized Employee/Manager/Governor and automatic Secretary discover and fetch unsaved news/images/search; full text, selected count, source filtering and complete nonduplicating pagination')
 const bounded=await rpc('channel.fetch-images',{id:a.channelId,limit:100},tokens[0]);assert.equal(bounded.messages.length,32);assert.ok(bounded.nextCursor);const rest=await rpc('channel.fetch-images',{id:a.channelId,limit:100,cursor:bounded.nextCursor},tokens[0]);assert.equal(rest.messages.length,25);assert.equal(rest.nextCursor,null);assert.equal(new Set([...bounded.messages,...rest.messages].map(m=>m.id)).size,57)
 pass('Image budget returns a bounded page with a complete continuation rather than dropping pictures/messages')
 const cli=await f.call(tokens[0],'channel','fetch-text',a.channelId,'--limit','3');assert.equal(cli.messages.length,3)
 assert.equal((await f.call(tokens[0],'channel','search',a.channelId,'--query','LLM story 0','--images','--limit','1')).messages[0].images[0].data,pixel)
 assert.deepEqual((await rpc('channel.read-state',{id:a.channelId,entryIds:posts.map(post=>post.id)})).entries,unread.entries)
 assert.ok((await rpc('channel.posts',{channelId:a.channelId})).posts.every(post=>!post.saved));assert.deepEqual((await rpc('session.list',{summary:true})).sessions.map(c=>c.id),before.sessions.map(c=>c.id))
 assert.equal((await rpc('session.status')).filter(s=>s.busy).length,0)
 const disk=new DatabaseSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/channels.sqlite'),{readOnly:true});for(const table of ['posts','media','channel_messages'])assert.equal(disk.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);disk.close();assert.deepEqual(fs.readdirSync(path.join(f.env.AGENTS_COMPANY_HOME,'channels/media')),[])
 pass('Actual CLI flags work; deliberate reads do not mark user reads, Save, create news files or launch work')
 const revision=(await rpc('channel.get',{id:a.channelId})).revision,conversation='channel:'+a.channelId
 for(const [cmd,args] of [['channel.create',{name:'No employee channels',engine:{kind:'employees',employeeIds:[employees[0].id]}}],['channel.update',{id:a.channelId,adminIds:[employees[0].id]}],['channel.message-send',{id:a.channelId,text:'No group'}],['conversation.member',{conversation,employee:employees[0].id,action:'add',expectedRevision:revision}],['conversation.role',{conversation,employee:employees[0].id,role:'admin',expectedRevision:revision}],['conversation.silence',{conversation,silent:true,expectedRevision:revision}],['conversation.notice-create',{conversation,spec:{},clientRequestId:'not-a-group'}],['channel.post-trigger-set',{id:a.channelId,employee:employees[0].id,everyPosts:2,prompt:'No automatic work',enabled:true,expectedRevision:0}]])assert.equal((await f.request(null,cmd,args)).ok,false,cmd+' must reject channel group behavior')
 assert.deepEqual((await rpc('conversation.policy',{conversation})).allowedActions,[])
 const group=await rpc('chat.create',{name:'Normal group',members:[employees[0].id,employees[1].id],ownerId:employees[0].id}),ref='group:'+group.id
 await rpc('conversation.role',{conversation:ref,employee:employees[1].id,role:'admin',expectedRevision:group.revision},tokens[0]);assert.equal((await rpc('conversation.policy',{conversation:ref},tokens[1])).actorRole,'admin')
 pass('Channel membership/reply/moderation/notice/count-task writes and employee engines are disabled; real group roles still work')
 const out=path.join(f.root,'artifacts/channel-api');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'core-result.json'),JSON.stringify({passed:true,checks,providerCalls:0},null,2)+'\n')
}finally{await f.close()}
