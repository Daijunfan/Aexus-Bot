import {parse as parseToml} from 'smol-toml'
import {APP_HOME} from '../shared/protocol'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import type {EngineId} from '../shared/engines'
import {isEngine,isNativeAcp} from '../shared/engines'
import {codeConfig,codeCredential} from './engines/opencode-config'
import type {EngineProviderCatalog,EngineProviderProfile} from '../shared/engine-providers'
import {nativeJson,claudeConfigRoot,clineDataRoot,piConfigRoot,nativeClineConnection,nativePiConnection} from './engines/native-config'
import {engineConfiguration,usesNativeConfiguration} from './engines/configuration'

const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,12)
const modelId=(value:string='')=>value.replace(/\[1m\]$/i,'')
const publicUrl=(value:string|undefined)=>{if(!value)return undefined;const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString().replace(/\/$/,'')}
function credential(key:unknown,file?:string,helper?:string):EngineProviderProfile['credential']{
 if(file){if(!fs.existsSync(file))return {configured:false,kind:'file'};return {configured:!!fs.statSync(file).size,kind:'file',fingerprint:hash(fs.readFileSync(file,'utf8').trim())}}
 if(helper)return {configured:true,kind:'helper'}
 return typeof key==='string'&&key?{configured:true,kind:'key',fingerprint:hash(key)}:{configured:false,kind:'none'}
}
function savedProfiles(engine:EngineId):EngineProviderProfile[]{
 if(isNativeAcp(engine))return []
 const home=os.homedir(),canonical=engine==='claude'?claudeConfigRoot()===path.join(home,'.claude'):engine==='pi'?piConfigRoot()===path.join(home,'.pi','agent'):engine==='codex'?(process.env.CODEX_HOME||path.join(home,'.codex'))===path.join(home,'.codex'):clineDataRoot()===path.join(home,'.cline','data')
 if(!canonical)return []
 const file=path.join(home,'.cc-switch/cc-switch.db');if(!fs.existsSync(file))return []
 const db=new DatabaseSync(file,{readOnly:true})
 try{return (db.prepare('SELECT id,name,settings_config FROM providers WHERE app_type=? ORDER BY sort_index,name').all(engine) as {id:string;name:string;settings_config:string}[]).map(row=>{
  const data=JSON.parse(row.settings_config),env=data.env??{},config=typeof data.config==='string'?parseToml(data.config):data.config??{},provider=config.model_providers?.[config.model_provider],key=env.ANTHROPIC_AUTH_TOKEN||env.ANTHROPIC_API_KEY||data.auth?.OPENAI_API_KEY
  const models=Array.isArray(data.models)?data.models.map((model:any)=>model.id):Object.keys(data.models??{})
  return {id:'saved:'+row.id,name:row.name,source:'saved',active:false,sourceFile:file,baseUrl:env.ANTHROPIC_BASE_URL||data.baseUrl||provider?.base_url,models:[data.model||env.ANTHROPIC_MODEL||config.model,...models].filter(Boolean),credential:key?credential(key):{configured:!!data.auth?.tokens,kind:data.auth?'login':'none'}}
 })}finally{db.close()}
}
function codexConfig(root:string):Record<string,any>{const file=path.join(root,'config.toml');return fs.existsSync(file)?parseToml(fs.readFileSync(file,'utf8')):{}}
/** Public catalog is a whitelist. Credentials stay in their native files, never the renderer. */
export async function engineProviderCatalog(engine:EngineId):Promise<EngineProviderCatalog>{
 if(!isEngine(engine))throw Error('Unknown Coding Agent engine')
 const profiles:EngineProviderProfile[]=[],files:string[]=[],native=usesNativeConfiguration(engine)
 let activeModel:string|undefined,endpoint:string|undefined
 if(engine==='claude'){
  const root=claudeConfigRoot(),file=path.join(root,'settings.json'),settings=nativeJson(file),env=settings.env??{},routerFile=path.join(root,'model-router/routes.json'),router=nativeJson(routerFile)
  files.push(file);activeModel=env.ANTHROPIC_MODEL||settings.model;endpoint=env.ANTHROPIC_BASE_URL
  const routed=endpoint&&Number(new URL(endpoint).port)===router.port&&Object.keys(router.routes??{}).length
  if(routed){
   files.push(routerFile)
   for(const [id,value] of Object.entries(router.routes) as [string,any][]){profiles.push({id:'router:'+id,name:value.label||id,source:'router',baseUrl:value.base_url,models:[id],active:native&&modelId(activeModel)===modelId(id),credential:credential(undefined,value.key_file),sourceFile:routerFile})}
  }else profiles.push({id:'native:claude',name:'Native Claude configuration',source:'native',baseUrl:endpoint,models:(settings.modelPicker?.options??[]).map((m:any)=>m.model),active:native,credential:credential(env.ANTHROPIC_AUTH_TOKEN||env.ANTHROPIC_API_KEY,undefined,settings.apiKeyHelper),sourceFile:file})
 }else if(engine==='cline'){
  const selected=nativeClineConnection(),root=clineDataRoot(),file=process.env.CLINE_PROVIDER_SETTINGS_PATH||path.join(root,'settings/providers.json'),data=nativeJson(file),models=nativeJson(path.join(root,'settings/models.json'))
  files.push(file,path.join(root,'settings/models.json'));activeModel=selected?.model;endpoint=selected?.baseUrl
  for(const [id,entry] of Object.entries(data.providers??{}) as [string,any][]){const s=entry.settings??{},registry=models.providers?.[id];profiles.push({id:'native:'+id,name:registry?.provider?.name||s.provider||id,source:'native',baseUrl:s.baseUrl||registry?.provider?.baseUrl,models:[...new Set<string>([s.model,...Object.keys(registry?.models??{})].filter(Boolean))],active:native&&id===selected?.id,credential:credential(s.apiKey),sourceFile:file})}
 }else if(engine==='pi'){
  const root=piConfigRoot(),file=path.join(root,'models.json'),data=nativeJson(file),selected=nativePiConnection(),auth=nativeJson(path.join(root,'auth.json'))
  files.push(file,path.join(root,'settings.json'),path.join(root,'auth.json'));activeModel=selected?.model;endpoint=selected?.baseUrl
  for(const [id,entry] of Object.entries(data.providers??{}) as [string,any][]){const key=entry.apiKey||auth[id]?.key;profiles.push({id:'native:'+id,name:entry.name||id,source:'native',baseUrl:entry.baseUrl,models:(entry.models??[]).map((m:any)=>m.id),active:native&&id===selected?.id,credential:credential(key),sourceFile:file})}
 }else if(isNativeAcp(engine)){
  const config=codeConfig(engine),selected=engine==='deepseek'?'deepseek-official':config.model?.split('/')[0]
  files.push(...config.files,...(fs.existsSync(config.authFile)?[config.authFile]:[]));activeModel=config.model
  for(const [id,entry] of Object.entries(config.providers)){
   const auth=config.auth[id],apiKey=codeCredential(entry.options?.apiKey)||auth?.key
   const models=Object.keys(entry.models??{}).filter(model=>(!entry.whitelist||entry.whitelist.includes(model))&&!entry.blacklist?.includes(model)).map(model=>id+'/'+model)
   profiles.push({id:'native:'+id,name:entry.name||id,source:'native',baseUrl:entry.options?.baseURL,models,active:native&&id===selected,credential:apiKey?credential(apiKey):{configured:!!auth,kind:auth?'login':'none'},sourceFile:config.files.at(-1)??config.root})
   if(id===selected)endpoint=entry.options?.baseURL
  }
 }else{
  const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),file=path.join(root,'config.toml'),data=codexConfig(root),auth=nativeJson(path.join(root,'auth.json')),selected=data.model_provider||'openai'
  files.push(file,path.join(root,'auth.json'));activeModel=data.model
  const providers={openai:{name:'OpenAI · Native configuration'},...data.model_providers}
  for(const [id,entry] of Object.entries(providers) as [string,any][]){const key=entry.env_key?process.env[entry.env_key]:auth.OPENAI_API_KEY;profiles.push({id:'native:'+id,name:entry.name||id,source:'native',baseUrl:entry.base_url,models:activeModel?[activeModel]:[],active:native&&id===selected,credential:key?credential(key):{configured:!!auth.tokens,kind:'login'},sourceFile:file});if(id===selected)endpoint=entry.base_url}
 }
 profiles.push(...savedProfiles(engine))
 if(!native){const config=engineConfiguration(engine);profiles.forEach(p=>p.active=false);profiles.unshift({id:'app:override',name:'Aexus Bot override',source:'app',active:true,baseUrl:config.baseUrl,models:config.model?[config.model]:[],credential:{configured:!!config.secret,kind:config.secret?'key':'none'},sourceFile:path.join(APP_HOME,'engines/settings.json')});endpoint=config.baseUrl;activeModel=config.model||activeModel}
 for(const profile of profiles)profile.baseUrl=publicUrl(profile.baseUrl)
 endpoint=publicUrl(endpoint)
 const extensions=path.join(os.homedir(),'.vscode/extensions'),extensionId={claude:'anthropic.claude-code-',codex:'openai.chatgpt-',cline:'saoudrizwan.claude-dev-',pi:'',opencode:'sst-dev.opencode-',kilo:'kilocode.kilo-code-',deepseek:''}[engine],extensionInstalled=!!extensionId&&fs.existsSync(extensions)&&fs.readdirSync(extensions).some(name=>name.startsWith(extensionId))
 return {engine,source:native?'native':'app',activeModel,endpoint,profiles,files,updatedAt:Date.now(),clients:{cli:'Native configuration',vscode:extensionInstalled?'Native configuration':'Extension not installed',app:native?'Native configuration':'Explicit application override'}}
}
