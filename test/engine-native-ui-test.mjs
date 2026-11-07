// Hidden actual settings UI with real native catalogs, only protocol peers for program checks.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {_electron as electron,expect} from '@playwright/test'
import {fixtureCore} from './fixtures/headless-core.mjs'
import {desktopExecutable} from './fixtures/desktop-app.mjs'
const root=path.resolve(import.meta.dirname,'..'),f=await fixtureCore({CLAUDE_BIN:process.env.AGENTS_TEST_CLAUDE_BIN||'/usr/bin/true',CLINE_BIN:path.join(root,'test/fixtures/process-adapter.cjs'),PI_BIN:path.join(root,'test/fixtures/process-adapter.cjs')}),require=createRequire(import.meta.url),out=path.resolve(process.env.AGENTS_COMPANY_TEST_ARTIFACTS||path.join(root,'artifacts/engine-native/ui'))
fs.mkdirSync(out,{recursive:true});let app
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value),{mode:0o600})}
try{
 await f.stop();const native=f.env.CLAUDE_CONFIG_DIR,key=path.join(f.temp,'claude.key');fs.writeFileSync(key,'PRIVATE_CLAUDE_TEST_KEY',{mode:0o600})
 write(path.join(native,'settings.json'),{model:'deepseek-flash[1m]',env:{ANTHROPIC_BASE_URL:'http://127.0.0.1:18994',ANTHROPIC_AUTH_TOKEN:'PRIVATE_CLAUDE_TEST_KEY'},modelPicker:{replaceBuiltInOptions:true,options:[{model:'deepseek-flash[1m]',label:'Official Flash'},{model:'other-model',label:'Other provider'}]}})
 const routerFile=path.join(native,'model-router/routes.json'),router={port:18994,routes:{'deepseek-flash':{label:'DeepSeek Official Flash',base_url:'https://api.deepseek.com/anthropic',key_file:key},'other-model':{label:'Other service',base_url:'https://other.invalid/v1',key_file:key}}};write(routerFile,router)
 write(path.join(f.env.CLINE_DATA_DIR,'settings/providers.json'),{version:1,lastUsedProvider:'deepseek',providers:{deepseek:{settings:{provider:'deepseek',model:'deepseek-v4-pro',baseUrl:'https://api.deepseek.com',apiKey:'PRIVATE_CLINE_TEST_KEY'}}}})
 write(path.join(f.env.PI_CODING_AGENT_DIR,'settings.json'),{defaultProvider:'custom',defaultModel:'model-a',defaultThinkingLevel:'low'});write(path.join(f.env.PI_CODING_AGENT_DIR,'models.json'),{providers:{custom:{name:'Native Pi service',baseUrl:'https://pi.invalid/v1',api:'openai-completions',apiKey:'PRIVATE_PI_TEST_KEY',models:[{id:'model-a'},{id:'model-b'}]}}})
 const application=process.env.AGENTS_COMPANY_TEST_APP,env={...f.env,AGENTS_COMPANY_HIDDEN:'1',AGENTS_COMPANY_WIDTH:'1440',AGENTS_COMPANY_HEIGHT:'1000'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:application?desktopExecutable(application):require('electron'),args:application?[]:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(20000)
 const call=(cmd,args={})=>page.evaluate(({cmd,args})=>window.agents.call(cmd,args),{cmd,args})
 await page.locator('.infinite-canvas').waitFor();await call('settings.set',{language:'en',theme:'white'});await call('view.open',{kind:'settings'})
 await page.locator('.settings-engines > summary').click()
 const claude=page.locator('[data-engine-health="claude"]'),catalog=claude.locator('.engine-provider-catalog');await expect(catalog.locator('.engine-provider-row')).toHaveCount(2);await expect(catalog.locator('[data-active=true]')).toContainText('DeepSeek Official Flash');await expect(catalog).toContainText('Other service');assert.ok(!(await catalog.innerText()).includes('PRIVATE_CLAUDE_TEST_KEY'))
 await expect(page.locator('[data-engine-health="cline"] .engine-provider-catalog')).toContainText('deepseek-v4-pro');await expect(page.locator('[data-engine-health="pi"] .engine-provider-catalog')).toContainText('Native Pi service')
 router.routes['new-model']={label:'Added externally',base_url:'https://added.invalid/v1',key_file:key};write(routerFile,router);await expect(catalog.locator('.engine-provider-row')).toHaveCount(3,{timeout:12000})
 await claude.getByRole('button',{name:'Engine settings',exact:true}).click();await expect(claude.getByLabel('Claude Agent provider URL',{exact:true})).toHaveCount(0);await expect(claude.getByLabel('Claude Agent executable path',{exact:true})).toBeVisible()
 const info=await call('engine.providers',{engine:'claude'});assert.equal(info.profiles.length,3);assert.equal(info.source,'native');assert.ok(!JSON.stringify(info).includes('PRIVATE_'))
 await claude.screenshot({path:path.join(out,'native-services-white.png'),animations:'disabled'});await call('settings.set',{theme:'black'});await claude.screenshot({path:path.join(out,'native-services-black.png'),animations:'disabled'})
 assert.ok(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible())))
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,application:application||'source',checks:['Every configured native service/current selection/URL is visible','Credential content never reaches UI/API','Externally added native route appears without reopening settings','Default UI path edits do not create private URL/key overrides','Cline/Pi display native model/provider selections','Light and dark settings remain readable'],modelCalls:0},null,2)+'\n')
 console.log('PASS hidden native provider catalogs, active selection, independent keys, five-second external refresh, shared-only default edits and both themes')
}catch(error){if(app)await(await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error}finally{await app?.close();await f.close()}
