import fs from 'node:fs'
import path from 'node:path'
import {directoryName} from '../../src/shared/directory-names.ts'

// Legacy compatibility only. Current Core refuses to create Work/plugin Teams,
// but already-installed state and its native sessions must keep working.
// Seed that state without Core running, inside the fixture's own temp HOME.

const readState=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{sessions:[],groups:[],rooms:{},teamRoots:{},teamSettings:{}}

function pluginWorkspaceDirectory(env,pluginId){
 const roots=[env.AGENTS_COMPANY_BUILTIN_PLUGINS,env.AGENTS_COMPANY_HOME&&path.join(env.AGENTS_COMPANY_HOME,'plugins'),...String(env.AGENTS_COMPANY_PLUGIN_DIRS||'').split(path.delimiter)].filter(Boolean)
 for(const root of roots){
  if(!fs.existsSync(root))continue
  const directories=fs.existsSync(path.join(root,'agents-company.plugin.json'))?[root]:fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(root,entry.name))
  for(const directory of directories){
   const manifestFile=path.join(directory,'agents-company.plugin.json')
   if(!fs.existsSync(manifestFile))continue
   try{
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'))
    if(manifest.id===pluginId)return manifest.workspaceDirectory&&/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(manifest.workspaceDirectory)?manifest.workspaceDirectory:`${pluginId}-workspace`
   }catch{}
  }
 }
 return `${pluginId}-workspace`
}

function assertInsideTemp(temp,location,label){
 const root=path.resolve(temp),value=path.resolve(location)
 if(value!==root&&!value.startsWith(root+path.sep))throw new Error(`${label} must stay inside the fixture temp directory: ${value}`)
}

/** The old defaultTeamRoot(name,{mode:'work',pluginId}) computation, without loading Core. */
export function legacyWorkTeamRoot(f,pluginId,name){
 const home=path.resolve(f.env.AGENTS_COMPANY_HOME)
 const base=path.resolve(f.env.AGENTS_COMPANY_WORKSPACES||path.join(home,'workspaces'))
 return path.join(base,pluginWorkspaceDirectory(f.env,pluginId),directoryName(String(name??'').trim()||'default','team'))
}

export async function seedLegacyWorkTeams(f,teams){
 if(!f?.env||!f.temp||typeof f.stop!=='function'||typeof f.start!=='function')throw new Error('legacy seeding requires a fixture with env, temp, stop and start')
 const temp=path.resolve(f.temp),home=path.resolve(f.env.AGENTS_COMPANY_HOME||path.join(temp,'state'))
 assertInsideTemp(temp,home,'legacy AGENTS_COMPANY_HOME')
 const seeded=teams.map(({name,pluginId})=>{
  const clean=String(name??'').trim()
  if(!clean)throw new Error('Legacy Team name cannot be empty')
  if(!pluginId)throw new Error(`Legacy Work Team '${clean}' requires a pluginId`)
  const root=legacyWorkTeamRoot(f,pluginId,clean)
  assertInsideTemp(temp,root,'legacy Work Team root')
  return {name:clean,pluginId,root}
 })
 await f.stop()
 try{
  const file=path.join(home,'sessions.json'),store=readState(file)
  store.sessions=Array.isArray(store.sessions)?store.sessions:[]
  store.groups=Array.isArray(store.groups)?store.groups:[]
  store.teamRoots=store.teamRoots&&typeof store.teamRoots==='object'?store.teamRoots:{}
  store.teamSettings=store.teamSettings&&typeof store.teamSettings==='object'?store.teamSettings:{}
  fs.mkdirSync(home,{recursive:true})
  for(const team of seeded){
   fs.mkdirSync(path.join(path.dirname(team.root),'default'),{recursive:true})
   if(!store.groups.includes(team.name))store.groups.push(team.name)
   store.teamRoots[team.name]=team.root
   store.teamSettings[team.name]={mode:'work',pluginId:team.pluginId}
   fs.mkdirSync(team.root,{recursive:true})
  }
  const temporary=file+'.legacy.tmp'
  fs.writeFileSync(temporary,JSON.stringify(store,null,2),{encoding:'utf8',mode:0o600})
  fs.renameSync(temporary,file)
 }finally{await f.start()}
 return seeded
}

export async function seedLegacyWorkTeam(f,name,pluginId){
 const [team]=await seedLegacyWorkTeams(f,[{name,pluginId}])
 return team
}
