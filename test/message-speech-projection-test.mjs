// Pure projection contract: keep IDs/text/attachments intact; never alter native records.
import assert from 'node:assert/strict'
import {spokenMessages} from '../src/shared/messages.ts'
const source=[
 {role:'notice',id:'system',text:'model changed',tone:'info'},
 {role:'user',id:'question',text:'Please inspect the file',images:['source.png']},
 {role:'assistant',id:'thinking',blocks:[{kind:'thinking',text:'private reasoning',done:false}]},
 {role:'assistant',id:'tool',blocks:[{kind:'tool',id:'t',name:'Bash',input:{command:'cat secret'},result:'internal tool result',running:false}]},
 {role:'assistant',id:'mixed',createdAt:123,blocks:[{kind:'text',text:'I will check it.'},{kind:'tool',id:'t2',name:'Read',input:{path:'a'},running:true},{kind:'thinking',text:'hidden',done:false},{kind:'text',text:'The total is 359.5.'}]},
 {role:'assistant',id:'json',blocks:[{kind:'text',text:'{"command":"chat.post","text":"This is just a quoted example"}'}]},
 {role:'assistant',id:'empty',blocks:[{kind:'text',text:'  '}]},
 {role:'user',id:'attachment',text:'',files:[{path:'document.pdf',name:'document.pdf',kind:'file'}]},
 {role:'assistant',id:'file-only',blocks:[],files:[{path:'result.pdf',name:'result.pdf',kind:'file'}]},
 {role:'assistant',id:'image-only',blocks:[],images:['result.png']}
],before=structuredClone(source),projected=spokenMessages(source)
assert.deepEqual(projected.map(item=>item.id),['question','mixed','json','attachment','file-only','image-only'])
assert.deepEqual(projected[1].blocks,[source[4].blocks[0],source[4].blocks[3]])
assert.equal(projected[1].createdAt,123);assert.equal(projected[0],source[1]);assert.equal(projected[2],source[5]);assert.deepEqual(source,before)
console.log('PASS private speech projection preserves native identities/text/JSON/media and removes tool-only/reasoning/system/empty rows without mutating history')
