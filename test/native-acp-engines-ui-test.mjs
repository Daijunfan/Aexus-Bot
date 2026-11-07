// Hidden actual settings/creation UI with shared OpenCode/Kilo native configs; discovery never prompts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-native-acp-ui-')),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/additional-engines/ui'))
fs.mkdirSync(out,{recursive:true})
const xdg=path.join(temp,'config'),home=path.join(temp,'home'),keys={opencode:'PRIVATE_OPENCODE_TEST_KEY',kilo:'PRIVATE_KILO_TEST_KEY'},binaries={opencode:process.env.AGENTS_TEST_OPENCODE_BIN,kilo:process.env.AGENTS_TEST_KILO_BIN},checks=[]
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value),{mode:0o600})}
// Exactly two synthetic services/models, no real endpoint and no real credential.
for(const engine of ['opencode','kilo'])write(path.join(xdg,engine,engine+'.jsonc'),{$schema:'https://opencode.ai/config.json',model:'deepseek-official/deepseek-flash',enabled_providers:['deepseek-official'],provider:{'deepseek-official':{npm:'@ai-sdk/openai-compatible',name:'DeepSeek Official',options:{baseURL:'https://example.invalid/v1',apiKey:keys[engine]},models:{'deepseek-flash':{name:'DeepSeek Flash'},'deepseek-v4-pro':{name:'V4 Pro'}}}}})
let f,app
try{
 f=await fixtureCore({HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:xdg,XDG_DATA_HOME:path.join(temp,'data'),XDG_STATE_HOME:path.join(temp,'state'),XDG_CACHE_HOME:path.join(temp,'cache'),...(binaries.opencode?{OPENCODE_BIN:binaries.opencode}:{}),...(binaries.kilo?{KILO_BIN:binaries.kilo}:{})})
 await f.stop()
 const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env})
 const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 const call=(cmd,args={})=>page.evaluate(async({cmd,args})=>{try{return await window.agents.call(cmd,args)}catch(error){throw Error(error?.message??JSON.stringify(error))}},{cmd,args})
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'});await call('group.add',{name:'Native ACP Team',mode:'build'})

 // Config-only ACP discovery (initialize + session/new). Real binaries are optional but never prompted.
 const discovered={}
 for(const engine of ['opencode','kilo']){
  try{discovered[engine]=await call('engine.models',{engine})}catch(error){discovered[engine]=null;if(binaries[engine])throw error;console.log('SKIP '+engine+' native model discovery (set AGENTS_TEST_'+engine.toUpperCase()+'_BIN): '+error.message.split('\n')[0])}
  if(discovered[engine])assert.deepEqual(discovered[engine].models.map(model=>model.value).sort(),['deepseek-official/deepseek-flash','deepseek-official/deepseek-v4-pro'])
 }

 await call('view.open',{kind:'settings'})
 const section=page.locator('.settings-engines');if(!await section.evaluate(el=>el.open))await section.locator(':scope > summary').click()
 for(const engine of ['opencode','kilo']){
  const card=page.locator(`[data-engine-health="${engine}"]`),catalog=card.locator('.engine-provider-catalog')
  await card.scrollIntoViewIfNeeded();await expect(catalog).toBeVisible()
  await expect(catalog.locator('.engine-provider-row')).toHaveCount(1)
  await expect(catalog.locator('.engine-provider-row').first()).toHaveAttribute('data-provider-id','native:deepseek-official')
  const text=await catalog.evaluate(el=>el.textContent)
  for(const needle of ['Shared native configuration','DeepSeek Official','https://example.invalid/v1','deepseek-flash','deepseek-v4-pro','Key configured'])assert.ok(text.includes(needle),engine+' settings card is missing '+needle)
  for(const key of Object.values(keys))assert.ok(!text.includes(key),engine+' settings card exposed a dummy secret')
  const info=await call('engine.providers',{engine});assert.equal(info.source,'native');assert.equal(info.profiles.length,1);assert.equal(info.profiles[0].baseUrl,'https://example.invalid/v1');assert.equal(info.profiles[0].credential.configured,true);assert.deepEqual(info.profiles[0].models.sort(),['deepseek-official/deepseek-flash','deepseek-official/deepseek-v4-pro']);assert.ok(!JSON.stringify(info).includes(keys[engine]))
  for(const theme of ['white','black']){
   await call('settings.set',{theme,viewAppearance:{company:{theme}}});await expect(page.locator('html')).toHaveAttribute('data-theme',theme)
   await card.scrollIntoViewIfNeeded();await card.screenshot({path:path.join(out,`settings-${engine}-${theme}.png`),animations:'disabled'})
  }
  await call('settings.set',{theme:'white',viewAppearance:{company:{theme:'white'}}});await card.scrollIntoViewIfNeeded()
  const label=engine==='opencode'?'OpenCode':'Kilo Code'
  await card.getByRole('button',{name:'Engine settings',exact:true}).click()
  const executable=card.getByLabel(label+' executable path',{exact:true})
  await expect(executable).toBeVisible();await expect(executable).toBeEditable()
  await expect(card.getByLabel(label+' provider URL',{exact:true})).toHaveCount(0)
  await expect(card.getByLabel(label+' API key',{exact:true})).toHaveCount(0)
  await expect(card.getByRole('button',{name:'Use shared native configuration'})).toHaveCount(0)
  await assert.rejects(()=>call('engine.configure',{engine,patch:{inheritNative:false}}),/native|share/i)
  await assert.rejects(()=>call('engine.configure',{engine,patch:{baseUrl:'https://example.invalid/v1'}}),/native|share/i)
  checks.push(engine+': shared card shows provider/two models/endpoint without the dummy key; path editable; provider/key overrides absent and rejected')
 }
 for(const key of Object.values(keys))assert.ok(!(await page.content()).includes(key),'dummy secret reached the renderer')
 checks.push('Both native cards share their native configuration; no private URL/key override is available')

 await call('view.open',{kind:'home'});await page.locator('.add-employee').click();await page.locator('.employee-form').waitFor()
 const choices=page.locator('.engine-choices button')
 await expect(choices).toHaveCount(6)
 assert.deepEqual((await choices.evaluateAll(buttons=>buttons.map(button=>button.dataset.engine))).sort(),['claude','cline','codex','kilo','opencode','pi'])
 for(const [engine,label] of [['opencode','OpenCode'],['kilo','Kilo Code']]){const button=page.locator(`.engine-choices button[data-engine="${engine}"]`);await expect(button).toBeVisible();await expect(button).toContainText(label);await expect(button).toBeEnabled()}
 for(const engine of ['codex','claude','cline','pi']){
  const mark=page.locator(`.engine-choices button[data-engine="${engine}"] .engine-mark`);await expect(mark).toBeVisible()
  const ink=await mark.evaluate(async element=>{const svg=element.cloneNode(true);svg.style.color=getComputedStyle(element).color;svg.setAttribute('xmlns','http://www.w3.org/2000/svg');const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(svg));await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const context=canvas.getContext('2d');context.drawImage(image,0,0,96,96);const data=context.getImageData(0,0,96,96).data;let pixels=0;for(let index=3;index<data.length;index+=4)if(data[index]>128)pixels++;return {pixels,svg:element.tagName,paths:element.querySelectorAll('path,rect').length,external:element.querySelectorAll('image,img').length}})
  assert.equal(ink.svg,'svg');assert.ok(ink.paths>0);assert.equal(ink.external,0);assert.ok(ink.pixels>700&&ink.pixels<7500,engine+' mark must draw a glyph')
 }
 for(const engine of ['opencode','kilo']){
  const mark=page.locator(`.engine-choices button[data-engine="${engine}"] .engine-mark`);await expect(mark).toBeVisible()
  const box=await mark.boundingBox();assert.ok(box.width>14&&Math.abs(box.width-box.height)<.1)
  assert.ok(await mark.evaluate(element=>element.querySelectorAll('path,rect,image').length>0),engine+' mark is not drawable');await mark.evaluate(async element=>{for(const node of element.querySelectorAll('image')){const img=new Image();img.src=node.href.baseVal;await img.decode();if(!img.naturalWidth)throw Error('Native engine artwork failed to load')}})
 }
 checks.push('Creation form offers six choices; the four original marks still render and both new marks are visible')

 const modelSelect=page.locator('.employee-form select[name="model"]')
 for(const engine of ['opencode','kilo']){
  const button=page.locator(`.engine-choices button[data-engine="${engine}"]`);await button.click();await expect(button).toHaveAttribute('aria-pressed','true')
  await expect(modelSelect).toHaveCount(1)
  if(discovered[engine]){
   const values=discovered[engine].models.map(model=>model.value)
   await expect.poll(()=>modelSelect.evaluate(element=>Array.from(element.options).map(option=>option.value)),{timeout:20000}).toEqual(expect.arrayContaining(values))
   const trigger=modelSelect.locator('..').locator('.app-select-trigger');await expect(trigger).toBeEnabled();const label=await modelSelect.locator('option').evaluateAll(options=>options.find(o=>o.value==='deepseek-official/deepseek-v4-pro').textContent);await trigger.click();await page.getByRole('option',{name:label,exact:true}).click();await expect(modelSelect).toHaveValue('deepseek-official/deepseek-v4-pro');checks.push(engine+': creation model list contains both native models and actual themed selection works')
  }
 }

 const fit=async()=>{const panel=page.locator('.creation-panel'),save=panel.locator('.form-footer .primary');assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'creation panel overflows horizontally');assert.ok(await save.evaluate(el=>{const rect=el.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth}),'primary action must remain in the viewport')}
 for(const theme of ['white','black']){await call('settings.set',{theme,viewAppearance:{company:{theme}}});await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await fit();await page.locator('.creation-panel').screenshot({path:path.join(out,`creation-${theme}.png`),animations:'disabled'});await page.locator('.engine-choices').screenshot({path:path.join(out,`creation-engines-${theme}.png`),animations:'disabled'})}
 await call('settings.set',{theme:'white',viewAppearance:{company:{theme:'white'}}});await expect(page.locator('html')).toHaveAttribute('data-theme','white')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,900))
 await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(800)
 await fit();const width=await page.evaluate(()=>innerWidth),boxes=await choices.evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return {left:rect.left,right:rect.right,width:rect.width}}));assert.ok(boxes.every(box=>box.width>0&&box.left>=-1&&box.right<=width+1),'engine choices overflow the narrow window')
 await page.locator('.creation-panel').screenshot({path:path.join(out,'creation-narrow.png'),animations:'disabled'})
 checks.push('Creation form fits the panel and the 720px window in both themes; no employee was created or prompted')
 assert.equal((await call('session.list')).sessions.length,0)

 assert.deepEqual(errors,[]);assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(window=>!window.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',nativeModelDiscovery:Object.fromEntries(Object.entries(discovered).map(([engine,value])=>[engine,!!value])),checks,modelCalls:0,paidCalls:0,productionDataUsed:false},null,2)+'\n')
 console.log('PASS hidden UI: OpenCode/Kilo shared config cards, hidden dummy keys, native-only overrides rejected, six creation choices with original/new marks, native model lists and responsive fit; no prompts')
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error}finally{await app?.close();await f?.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
