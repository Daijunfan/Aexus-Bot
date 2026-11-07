// Real authenticated settings/CLI in disposable state; pure geometry uses the same source tile model.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {fixtureCore} from './fixtures/headless-core.mjs'
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-wallpaper-core-')),out=path.join(root,'artifacts/message-wallpaper'),require=createRequire(import.meta.url),checks=[]
fs.mkdirSync(out,{recursive:true});fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'))
let f;const report={passed:false,checks,paidModelCalls:0,productionDataUsed:false},pass=text=>{checks.push(text);console.log('PASS '+text)}
try{
 const bundle=path.join(temp,'patterns.cjs');await build({stdin:{contents:"export * from './src/shared/message-wallpaper';export {TELEGRAM_WALLPAPERS} from './src/shared/telegram-wallpapers';export * from './src/shared/preferences';export * from './src/renderer/src/chat/wallpaper-patterns'",resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'})
 const {DEFAULT_MESSAGE_WALLPAPER:defaults,WALLPAPER_PATTERNS,WALLPAPER_PALETTES,TELEGRAM_WALLPAPERS,wallpaperMarks,WALLPAPER_MOTIFS,mergePreferences}=require(bundle)
 assert.equal(Object.values(WALLPAPER_MOTIFS).flat().length,50)
 assert.ok(WALLPAPER_PATTERNS.includes('telegram'));assert.equal('telegram' in WALLPAPER_MOTIFS,false)
 assert.equal(TELEGRAM_WALLPAPERS.length,22);assert.deepEqual(WALLPAPER_PALETTES,['theme',...TELEGRAM_WALLPAPERS.map(preset=>preset.id),'custom'])
 for(const preset of TELEGRAM_WALLPAPERS){assert.ok(preset.id&&preset.name);assert.ok(preset.colors.length>=1&&preset.colors.length<=4);assert.ok(preset.colors.every(color=>/^#[0-9a-fA-F]{6}$/.test(color)))}
 for(const pattern of Object.keys(WALLPAPER_MOTIFS))for(const layout of ['ordered','scattered']){
  const marks=wallpaperMarks(pattern,layout);assert.equal(marks.length,36);assert.equal(wallpaperMarks(pattern,layout),marks);assert.equal(new Set(marks.map(mark=>mark.motif)).size,10)
  for(const mark of marks){assert.ok(mark.size>=29&&mark.size<=37);assert.ok(mark.y>=0&&mark.y<384);assert.ok(mark.x>=0&&mark.x<384);if(layout==='ordered')assert.equal(mark.angle,0)}
  for(let i=0;i<marks.length;i++)for(let j=i+1;j<marks.length;j++){let dx=Math.abs(marks[i].x-marks[j].x),dy=Math.abs(marks[i].y-marks[j].y);dx=Math.min(dx,384-dx);dy=Math.min(dy,384-dy);assert.ok(Math.hypot(dx,dy)>44,'tile-edge neighbours keep breathing room')}
 }
 assert.deepEqual(mergePreferences({}).messageWallpaper,defaults)
 assert.deepEqual(mergePreferences(mergePreferences({}, {messageWallpaper:{pattern:'cosmos',density:140}}),{messageWallpaper:{layout:'ordered'}}).messageWallpaper,{...defaults,pattern:'cosmos',density:140,layout:'ordered'})
 assert.deepEqual(mergePreferences({}, {messageWallpaper:{palette:'custom',colors:['#112233'],rotation:0}}).messageWallpaper,{...defaults,palette:'custom',colors:['#112233'],rotation:0})
 assert.deepEqual(mergePreferences(mergePreferences({}, {messageWallpaper:{pattern:'telegram',palette:TELEGRAM_WALLPAPERS[0].id,colors:['#bdcd8c'],rotation:30}}),{messageWallpaper:{colors:['#010203','#a1b2c3','#ffffff','#000000']}}).messageWallpaper,{...defaults,pattern:'telegram',palette:TELEGRAM_WALLPAPERS[0].id,colors:['#010203','#a1b2c3','#ffffff','#000000'],rotation:30})
 pass('50 original motifs; ten deterministic compact tiles, balanced spacing across seams, deep defaults and partial merge; 22 Telegram presets plus custom colors/rotation')
 const entry=path.join(temp,'daemon.cjs');await build({entryPoints:[path.join(root,'src/main/daemon.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',define:{__AGENTS_PROJECT_ROOT__:JSON.stringify(root)},logLevel:'silent'})
 f=await fixtureCore({},entry);const rpc=async(cmd,args={},token=null)=>{const response=await f.request(token,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data},get=()=>rpc('settings.get')
 assert.deepEqual((await get()).messageWallpaper,defaults)
 const initial=await get();await f.cli('settings','set','--message-wallpaper','{"pattern":"botanical","layout":"ordered","density":130}')
 await rpc('settings.set',{messageWallpaper:{opacity:21},viewAppearance:{plan:{theme:'black'}}})
 assert.deepEqual((await get()).messageWallpaper,{pattern:'botanical',layout:'ordered',density:130,opacity:21});assert.deepEqual((await get()).viewAppearance.messages,initial.viewAppearance.messages);assert.deepEqual((await get()).viewAppearance.company,initial.viewAppearance.company)
 const file=path.join(temp,'wallpaper.json');fs.writeFileSync(file,JSON.stringify({pattern:'studio'}));await f.cli('settings','set','--message-wallpaper','@'+file)
 assert.equal((await get()).messageWallpaper.pattern,'studio');assert.equal((await get()).messageWallpaper.opacity,21)
 const base=(await get()).messageWallpaper,appearance=(await get()).viewAppearance,identityBefore=(await rpc('session.list')).sessions.map(({id,engine,cwd,managementRole,threadId})=>({id,engine,cwd,managementRole,threadId}))
 for(const preset of TELEGRAM_WALLPAPERS){
  await f.cli('settings','set','--message-wallpaper',JSON.stringify({pattern:'telegram',palette:preset.id,colors:preset.colors,rotation:0}))
  const current=await get();assert.deepEqual(current.messageWallpaper,{...base,pattern:'telegram',palette:preset.id,colors:[...preset.colors],rotation:0});assert.deepEqual(current.viewAppearance,appearance)
 }
 await rpc('settings.set',{messageWallpaper:{pattern:'telegram',palette:'theme',rotation:0}});assert.equal((await get()).messageWallpaper.palette,'theme')
 const customColors=[['#123456'],['#123456','#abcdef'],['#123456','#abcdef','#fedcba'],['#123456','#abcdef','#fedcba','#0a0b0c']]
 for(const colors of customColors){await rpc('settings.set',{messageWallpaper:{pattern:'telegram',palette:'custom',colors,rotation:360}});assert.deepEqual((await get()).messageWallpaper,{...base,pattern:'telegram',palette:'custom',colors,rotation:360})}
 await rpc('settings.set',{messageWallpaper:{opacity:23},viewAppearance:{plan:{theme:'white'}}})
 const customSaved=await get();assert.deepEqual(customSaved.messageWallpaper,{...base,pattern:'telegram',palette:'custom',colors:customColors[3],rotation:360,opacity:23});assert.deepEqual(customSaved.viewAppearance.messages,appearance.messages);assert.deepEqual(customSaved.viewAppearance.company,appearance.company)
 assert.deepEqual((await rpc('session.list')).sessions.map(({id,engine,cwd,managementRole,threadId})=>({id,engine,cwd,managementRole,threadId})),identityBefore)
 await f.stop();await f.start();assert.deepEqual(await get(),customSaved)
 assert.deepEqual((await rpc('session.list')).sessions.map(({id,engine,cwd,managementRole,threadId})=>({id,engine,cwd,managementRole,threadId})),identityBefore)
 const schema=(await f.cli('api','describe','settings.set')).inputSchema.properties.messageWallpaper;assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.properties.pattern.enum,WALLPAPER_PATTERNS)
 assert.deepEqual(schema.properties.palette.enum,WALLPAPER_PALETTES);assert.equal(schema.properties.colors.type,'array');assert.equal(schema.properties.colors.minItems,1);assert.equal(schema.properties.colors.maxItems,4);assert.equal(schema.properties.colors.items.pattern,'^#[0-9a-fA-F]{6}$');assert.equal(schema.properties.rotation.type,'integer');assert.equal(schema.properties.rotation.minimum,0);assert.equal(schema.properties.rotation.maximum,360)
 pass('Native CLI JSON/@file and authenticated API use one canonical preference; all 22 Telegram presets, custom 1–4 colors and rotation persist across partial updates and restart; schema exposes palette enum/colors/rotation; unrelated views and native actor identity retained')
 const stateFile=path.join(f.env.AGENTS_COMPANY_HOME,'sessions.json')
 for(const invalid of [null,[],false,'daydream',{pattern:'custom-url'},{layout:'random'},{density:69},{density:161},{density:'115'},{opacity:-1},{opacity:46},{opacity:null},{palette:'not-a-palette'},{palette:null},{colors:[]},{colors:['#000000','#111111','#222222','#333333','#444444']},{colors:['#GGGGGG']},{colors:['#000000',null]},{colors:null},{rotation:1.5},{rotation:-45},{rotation:361},{image:'https://invalid.example'},{layout:'ordered',extra:1}]){
  const before=fs.readFileSync(stateFile,'utf8');assert.equal((await f.request(null,'settings.set',{language:'zh-CN',messageWallpaper:invalid})).ok,false);assert.equal(fs.readFileSync(stateFile,'utf8'),before)
 }
 await f.cli('group','add','Wallpaper test');const worker=await f.create('Reader','Wallpaper test'),secretary=await f.create('Assistant','Wallpaper test','secretary')
 assert.equal((await f.request(await f.token(worker.id),'settings.set',{messageWallpaper:{pattern:'cosmos'}})).ok,false)
 await rpc('settings.set',{messageWallpaper:{pattern:'cosmos'}},await f.token(secretary.id))
 const identity=(await rpc('session.list')).sessions.map(({id,engine,cwd,managementRole,threadId})=>({id,engine,cwd,managementRole,threadId})),saved=await get()
 await f.stop();await f.start();assert.deepEqual(await get(),saved)
 await f.stop();const legacy=JSON.parse(fs.readFileSync(stateFile,'utf8'));delete legacy.preferences.messageWallpaper;fs.writeFileSync(stateFile,JSON.stringify(legacy));await f.start()
 assert.deepEqual((await get()).messageWallpaper,defaults);assert.deepEqual((await get()).viewAppearance,saved.viewAppearance);assert.deepEqual((await rpc('session.list')).sessions.map(({id,engine,cwd,managementRole,threadId})=>({id,engine,cwd,managementRole,threadId})),identity)
 assert.deepEqual(await rpc('schedule.list'),[]);assert.deepEqual(await rpc('terminal.list'),[])
 pass('Atomic invalid-input rejection, existing Employee/Secretary authority, full restart and legacy migration preserve all employee/native identities; no tasks or terminals')
 report.passed=true
}catch(error){report.error=error.stack;throw error}finally{await f?.close();fs.writeFileSync(path.join(out,'core-verification.json'),JSON.stringify(report,null,2));fs.rmSync(temp,{recursive:true,force:true})}
