import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {magazinePdf} from './fixtures/magazine-pdf.mjs'
import {nativeToolResult} from '../src/main/native-tool-result.ts'
import {messageImageIndices,remapMessageImages} from '../src/shared/message-inline-images.ts'
const f=await fixtureCore(),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS??'artifacts/magazine-reading/core'),checks=[]
fs.mkdirSync(out,{recursive:true})
const rpc=async(cmd,args={},token=null)=>{const result=await f.request(token,cmd,args);assert.ok(result.ok,cmd+': '+result.error);return result.data},denied=async(cmd,args,token)=>{const result=await f.request(token,cmd,args);assert.equal(result.ok,false,cmd+' must fail');return result.error}
try{
 await f.cli('group','add','Reading team');const reader=await f.create('Reader','Reading team'),peer=await f.create('Peer','Reading team'),token=await f.token(reader.id),other=await f.token(peer.id),payload=magazinePdf(),pdfPath=path.join(reader.cwd,'Atlas Weekly.pdf');fs.writeFileSync(pdfPath,payload)
 const info=await rpc('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf'},token);assert.equal(info.pageCount,6);assert.equal(typeof info.sourceVersion,'string')
 assert.equal((await f.call(token,'workspace','pdf','Atlas Weekly.pdf','--employee',reader.id,'--operation','info')).pageCount,6)
 const first=await rpc('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'text',page:1,limit:4},token);assert.equal(first.nextPage,5);assert.match(first.pages[2].text,/Reading a figure/)
 const last=await rpc('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'text',page:first.nextPage,limit:4},token);assert.equal(last.nextPage,null);assert.equal(last.pages[1].textLayer,false)
 await denied('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'page',page:99},token);await denied('workspace.pdf',{employee:reader.id,path:'../Atlas Weekly.pdf'},token);await denied('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf'},other)
 const page=await rpc('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'page',page:3,width:1200},token);assert.equal(page.kind,'workspace-pdf-page');assert.equal(page.page,3);assert.ok(page.width>=1199);assert.match(page.text,/Reading a figure/);const image=Buffer.from(page.data,'base64');assert.ok(image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));fs.writeFileSync(path.join(out,'page-3.png'),image)
 const native=nativeToolResult({ok:true,data:page});assert.equal(native.content.filter(part=>part.type==='image').length,1);assert.ok(!native.content[0].text.includes(page.data));assert.ok(native.content[0].text.includes('Reading a figure'))
 const exported=await rpc('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'render',page:3,width:1200,to:'page-3.png',expectedVersion:info.sourceVersion},token);assert.ok(fs.readFileSync(path.join(reader.cwd,exported.path)).equals(image));assert.equal(exported.sha256,createHash('sha256').update(image).digest('hex'));assert.equal((await rpc('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'render',page:3,width:1200,to:'page-3.png'},token)).reused,true)
 fs.writeFileSync(path.join(reader.cwd,'conflict.png'),'existing data');await denied('workspace.pdf',{employee:reader.id,path:'Atlas Weekly.pdf',operation:'render',page:3,to:'conflict.png'},token);assert.equal(fs.readFileSync(path.join(reader.cwd,'conflict.png'),'utf8'),'existing data');assert.ok(fs.readFileSync(pdfPath).equals(payload));checks.push('Actual PDF pages, text pagination, visual-page native content, page PNG export/reuse, conflicts and workspace authority')
 const images=Array.from({length:70},(_,i)=>'figure-'+(i+1)+'.png');for(const name of images)fs.writeFileSync(path.join(reader.cwd,name),image)
 const text='First explanation.\n\n![Original page](attachment:1)\n\nSecond explanation.\n\n![Comparison](attachment:2)\n\nClosing notes.'
 await denied('direct.post',{text:'![Missing](attachment:2)',images:[images[0]],clientMessageId:'invalid-image-ref'},token)
 const sent=await rpc('direct.post',{text,images,clientMessageId:'rich-private'},token),again=await rpc('direct.post',{text,images,clientMessageId:'rich-private'},token);assert.equal(again.id,sent.id);const history=await rpc('direct.history',{employee:reader.id}),entry=history.items.find(item=>item.id===sent.id);assert.equal(entry.images.length,70);assert.equal(entry.blocks[0].text,text)
 const group=await rpc('chat.create',{name:'Reading review',members:[reader.id,peer.id],ownerId:reader.id}),ref='group:'+group.id,workspace=await rpc('conversation.workspace',{conversation:ref});for(const name of images)fs.writeFileSync(path.join(workspace.root,name),image)
 const publicMessage=await rpc('chat.post',{id:group.id,text,images:images.map(name=>'@workspace/'+name),clientMessageId:'rich-group'},token);assert.equal(publicMessage.attachments.length,70);assert.equal((await rpc('chat.history',{id:group.id})).messages.find(item=>item.id===publicMessage.id).text,text)
 await rpc('chat.post',{id:group.id,text:'Evidence and explanation. '.repeat(150).trim(),clientMessageId:'long-reading'},token)
 assert.deepEqual([...messageImageIndices('`![code](attachment:9)`\n\n![Page][p]\n\n[p]: attachment:2')],[1]);assert.match(remapMessageImages(text,3),/attachment:4/);assert.match(remapMessageImages(text,3),/attachment:5/);assert.ok(!remapMessageImages(text,null).includes('attachment:'));checks.push('A single direct/group publication preserves 70 images and ordered text references; unchanged retries are idempotent; fenced examples and forward numbering remain correct')
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,paidModelCalls:0,productionStateUsed:false,realLinuxServerTested:false},null,2)+'\n');checks.forEach(value=>console.log('PASS '+value))
}finally{await f.close()}
