import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
export const root=path.resolve(import.meta.dirname,'..')
const topDirectories=['src','bin','scripts','test','Modules','examples','docs','licenses','.github','resources']
const rootFiles=new Set(['AGENTS.md','API.md','ARCHITECTURE.md','Aexus-bot.png','app_icon.png','build.py','CHANGELOG.md','CONTRIBUTING.md','COVERAGE.md','ENGINE_CAPABILITIES.md','LICENSING.md','PERMISSIONS.md','PLAN.md','PLUGIN_SPEC.md','README.md','README.en.md','SCHEDULER.md','SECURITY.md','THIRD_PARTY_NOTICES.md','electron.vite.config.ts','engine-downloads.json','package.json','package-lock.json','plugins.lock.json','tsconfig.json','vite.web.config.ts','LICENSE','NOTICE','.gitignore','.dockerignore','.env.example','.gitattributes','.editorconfig','Dockerfile'])
const excluded=new Set(['.git','node_modules','out','release','release.noindex','dist','dist-cli','dist-plugin','build','artifacts','workspaces','.local-data','.agents-company','.tunnel','__pycache__','.pytest_cache','test-results','playwright-report','REPAIR_STATUS.md','VERIFICATION.md'])
function walk(directory,result){
  if(!fs.existsSync(directory))return
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(excluded.has(entry.name)||entry.name==='.DS_Store'||entry.name.startsWith('._')||entry.name.endsWith('.tsbuildinfo')||entry.name.startsWith('.env')&&entry.name!=='.env.example')continue
    const file=path.join(directory,entry.name)
    if(entry.isSymbolicLink())continue
    if(path.relative(root,file).split(path.sep).join('/')==='resources/library-reader/ui/vendor')continue
    if(entry.isDirectory())walk(file,result)
    else if(entry.isFile())result.push(file)
  }
}
/** Explicit product roots, never the developer's working folders, browser profiles or .git history. */
export function sourceFiles(){
  const manifest=path.join(root,'SOURCE_MANIFEST.json')
  const controlled=fs.existsSync(path.join(root,'.git'))
    ?new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))
    :fs.existsSync(manifest)?new Set(JSON.parse(fs.readFileSync(manifest,'utf8')).files.map(item=>item.file)):undefined
  const files=[]
  for(const directory of topDirectories)walk(path.join(root,directory),files)
  for(const file of fs.readdirSync(root,{withFileTypes:true}))if(file.isFile()&&file.name!=='UI.png'&&(controlled?controlled.has(file.name):rootFiles.has(file.name)))files.push(path.join(root,file.name))
  for(const file of ['build/entitlements.mac.plist','build/ICON.md'])if(fs.existsSync(path.join(root,file)))files.push(path.join(root,file))
  const lock=JSON.parse(fs.readFileSync(path.join(root,'plugins.lock.json'),'utf8'))
  for(const plugin of lock.plugins)walk(path.join(root,'PlugIns',plugin.directory),files)
  files.push(path.join(root,'PlugIns','README.md'))
  return [...new Set(files)].filter(file=>!controlled||controlled.has(path.relative(root,file).split(path.sep).join('/'))).sort()
}
