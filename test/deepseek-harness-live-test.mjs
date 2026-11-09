// Opt-in single authorized real-provider probe. No employee, schedule or real workspace is created.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'
if(process.env.AGENTS_COMPANY_DEEPSEEK_HARNESS_LIVE!=='1')throw Error('Explicit real-provider authorization is required')
const native=process.env.AGENTS_TEST_DEEPSEEK_HOME||path.join(os.homedir(),'.dsh'),binary=process.env.AGENTS_TEST_DEEPSEEK_BIN
if(!binary)throw Error('Choose the installed official dsh launcher')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-harness-live-')),profile=path.join(temp,'native-profile'),out=path.resolve('artifacts/deepseek/live');fs.mkdirSync(profile);fs.mkdirSync(out,{recursive:true})
const files=['cordis.patch.yml','.credentials.yaml'],hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before={}
for(const name of files){const source=path.join(native,name);if(fs.existsSync(source)){before[name]=hash(source);fs.symlinkSync(source,path.join(profile,name))}}
let f;const report={passed:false,realModel:true,officialHarness:true,isolatedCompanyAndNativeSession:true,credentialsCopied:false,productionEmployeesUsed:false,authorizedProbeInvocations:0}
try{
 f=await fixtureCore({DSH_HOME:profile,DEEPSEEK_BIN:binary,DSH_TELEMETRY_DISABLED:'1'})
 const rpc=async(cmd,args={})=>{const response=await f.request(null,cmd,args);assert.ok(response.ok,cmd+': '+response.error);return response.data}
 const health=await rpc('engine.check',{engine:'deepseek',force:true});assert.ok(health.ready,health.error)
 const catalog=await rpc('engine.models',{engine:'deepseek'}),providers=await rpc('engine.providers',{engine:'deepseek'})
 report.version=health.version;report.model=catalog.defaultModel;report.endpoint=providers.endpoint;report.authorizedProbeInvocations++
 const result=await rpc('engine.probe',{engine:'deepseek',confirm:true,model:catalog.defaultModel})
 assert.equal(result.text.trim(),'OK');report.reply=result.text.trim();report.elapsedMs=result.elapsedMs
 assert.equal((await rpc('session.list')).sessions.length,0);assert.deepEqual(await rpc('schedule.list'),[])
 for(const [name,digest] of Object.entries(before))assert.equal(hash(path.join(native,name)),digest)
 report.nativeConfigurationAndCredentialsUnchanged=true;report.passed=true;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){report.error=String(error.message);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');throw error}finally{await f?.close();fs.rmSync(temp,{recursive:true,force:true})}
