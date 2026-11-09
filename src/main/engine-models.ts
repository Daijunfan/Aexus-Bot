import {discoverCline} from './engines/cline-runtime'
import {discoverPi} from './engines/pi-runtime'
import {isEngine,isNativeAcp} from '../shared/engines'
import {discoverNativeAcp} from './engines/opencode-runtime'
import {codeConfig} from './engines/opencode-config'
import {engineExecutable} from './engines/executable'
import {engineEnvironment,processProvider} from './engines/configuration'
import {loadClaudeSdk} from './engines/claude-sdk'
import {readStore,getPreferences} from './store'
import {teamSettings,type Engine,type EmployeeKind,type ModelInfo} from '../shared/types'
import {allCodexModels} from './codex'
import {withCodexSessionApi} from './native-sessions'
import {deepSeekProvider,deepSeekModels,deepSeekModel,claudeModelCatalog} from './claude-provider'
import {childEnv,resolveBinary} from './exec'
import {spawnRemoteAgent} from './remote-agent-process'
import {nativeClaudeSettings,nativeCodexSettings} from './engines/native-config'

export function defaultEmployeeModel(engine:Engine,kind:EmployeeKind='worker'){
  if(kind==='cloud-native-worker')return undefined
  if(engine==='deepseek')return undefined
  if(isNativeAcp(engine))return codeConfig(engine).model
  if(engine==='codex')return nativeCodexSettings().model
  if(engine==='claude'){const settings=nativeClaudeSettings();return process.env.ANTHROPIC_MODEL||settings.env?.ANTHROPIC_MODEL||settings.model}
  return processProvider(engine).model||undefined
}

/** Discover models without creating an employee or sending an inference turn. */
export async function engineModels(engine:Engine,kind:EmployeeKind='worker',team?:string){
  if(!isEngine(engine))throw Error('请选择有效的 Coding Agent')
  if(!['worker','cloud-native-worker'].includes(kind))throw Error('Unknown employee kind')
  if(isNativeAcp(engine)){if(kind!=='worker')throw Error('This ACP engine currently supports Core-local employees only');return discoverNativeAcp(engine)}
  if(engine==='cline'||engine==='pi'){if(kind==='cloud-native-worker')throw Error('Use kind:worker for Cline/Pi cloud workspaces through Tunnel; cloud-native execution is not supported');return {models:(await (engine==='cline'?discoverCline():discoverPi())).models,defaultModel:defaultEmployeeModel(engine)}}
  const store=readStore(),config=team?teamSettings(store,team):undefined
  if(kind==='cloud-native-worker'&&(!team||!store.groups.includes(team)||config?.mode!=='cloud'||!config.remote))throw Error('请先选择已绑定云主机的 Cloud Team')
  const remote=kind==='cloud-native-worker'?config!.remote:undefined
  const provider=engine==='claude'&&!remote?deepSeekProvider():undefined
  let models:ModelInfo[]
  if(engine==='codex')models=await withCodexSessionApi(allCodexModels,remote?{nativeRemote:remote}:{})
  else{
    const abort=new AbortController()
    const prompt=(async function*(){await new Promise<void>(resolve=>abort.signal.addEventListener('abort',()=>resolve(),{once:true}))})()
    const {query}=await loadClaudeSdk()
    const q=query({prompt,options:{abortController:abort,persistSession:false,settingSources:['user'],
      pathToClaudeCodeExecutable:remote?'claude':engineExecutable('claude'),
      env:remote?{}:{...childEnv(),...engineEnvironment('claude')},...(remote?{cwd:remote.directory,spawnClaudeCodeProcess:options=>spawnRemoteAgent(remote,'claude',options.args,options.signal)}:{})}})
    const timer=setTimeout(()=>abort.abort(),15000)
    try{models=claudeModelCatalog(await q.supportedModels())}finally{clearTimeout(timer);abort.abort();q.close()}
  }
  const preferred=defaultEmployeeModel(engine,kind)
  const defaultModel=remote
    ?models.find(model=>model.value===preferred)?.value??models.find(model=>model.isDefault)?.value??models[0]?.value
    :preferred??models.find(model=>model.isDefault)?.value
  return {models,defaultModel}
}
