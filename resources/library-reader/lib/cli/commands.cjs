'use strict';
const schema = require('../../schema.json');
const kebab = value => value.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const shortcuts = {
 'document open':['document.open',['path']], 'document read':['document.content',['id']],
 'document search':['document.search',['id','query']], 'document outline':['toc.list',['id']],
 'study create':['study.create',['title']], 'study get':['study.get',['setId']],
 'study list':['study.list',[]], 'study add':['study.documents.add',['setId']],
 'study export':['study.export',['setId','path']],
 'card create':['study.card.create',['setId']], 'card note':['study.note.create',['setId','title']],
 'card source':['study.card.activate',['setId','cardId']],
 'card move':['study.card.move',['setId','cardId']],
 'cards move':['study.cards.move',['setId']],
 'card update':['study.card.update',['setId','cardId']],
 'card remove':['study.card.remove',['setId','cardId']],
 'study update':['study.update',['setId']],
 'map show':['study.get',['setId']], 'map export':['study.mindmap.export',['setId','path']],
 'review configure':['study.review.configure',['setId','cardId']],
 'review queue':['study.review.queue',['setId']], 'review preview':['study.review.preview',['setId','cardId']],
 'review grade':['study.review.grade',['setId','cardId','rating']],
 'xmind inspect':['study.mindmap.xmind.inspect',['path']],
 'xmind import':['study.mindmap.xmind.import',['path']],
 'xmind export':['study.mindmap.xmind.export',['path']]
};
const definitions = schema.commands.map(command => ({name:command.method.split('.').map(kebab).join(' '),method:command.method,positionals:[],command}));
for (const [name,[method,positionals]] of Object.entries(shortcuts)) {
 const command = schema.commands.find(c=>c.method===method);
 if (!command) throw new Error('CLI shortcut references missing method: '+method);
 const previous = definitions.findIndex(d=>d.name===name);
 if (previous>=0) definitions.splice(previous,1);
 definitions.push({name,method,positionals,command,...(name==='card source'?{defaults:{force:true}}:{})});
}
for (const command of schema.commands) definitions.push({name:command.method,method:command.method,positionals:[],command});
definitions.push({name:'map render',kind:'map-render',method:'study.get + study.map.geometry',positionals:[],command:{description:'Render a read-only terminal map snapshot through the public study and geometry APIs.',options:{
 setId:schema.commands.find(c=>c.method==='study.get').options.setId,
 columns:{type:'number',integer:true,minimum:1,maximum:100000,description:'Viewport columns; default 120. columns × rows must not exceed 100000.'},
 rows:{type:'number',integer:true,minimum:1,maximum:100000,description:'Viewport rows; default 36. columns × rows must not exceed 100000.'},
 select:{type:'string',description:'Optional card UUID to select in this snapshot; does not change saved selection.'},
 zoom:{type:'number',minimum:0.02,maximum:16,description:'Explicit zoom, 0.02–16. Omit for fit-to-map.'}
}}});
const legacy = {
 link:['link.open',['uri']],open:['document.open',['path']],list:['fs.list',['path']],
 tree:['fs.tree',['path']],mkdir:['fs.mkdir',['path']],url:['web.import',['url']],
 search:['document.search',['id','query']],read:['document.content',['id']]
};
const globalOptions={workspace:{type:'string'},output:{type:'string',enum:['json','pretty','text']},json:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'}};
const collisions=schema.commands.flatMap(c=>Object.keys(c.options||{}).filter(k=>Object.hasOwn(globalOptions,kebab(k))).map(key=>({method:c.method,key,flag:kebab(key)})));
module.exports={schema,kebab,definitions,legacy,globalOptions,collisions};
