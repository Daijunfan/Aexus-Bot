// Real portable source archives from disposable Git and extracted-source trees.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {list as listTar} from 'tar'

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'aexus-source-package-'))
const plugins=['margin-reader','mini-notion','cloud-hosts']
const write=(file,content)=>{const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content)}
const execute=(program,args)=>execFileSync(program,args,{cwd:temp,encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})
const pack=async()=>{
 const result=JSON.parse(execute(process.execPath,['scripts/package-source.mjs'])),entries=[]
 await listTar({file:result.archive,onentry:entry=>{if(entry.type==='File')entries.push(entry.path.replace(/^Aexus-Bot-0\.0\.0-source\//,''))}})
 for(const file of ['README.md','docs/guide.md','docs/images/promo.png','build.py','build/entitlements.mac.plist','src/index.ts'])assert.ok(entries.includes(file),'Missing public source: '+file)
 for(const plugin of plugins)for(const file of ['package.json','LICENSE','src/index.ts'])assert.ok(entries.includes('PlugIns/'+plugin+'/'+file),'Missing plugin source: '+plugin+'/'+file)
 for(const file of ['private.md','image.png','sources.md','src/private.md','docs/private.md','workspaces/private.json'])assert.ok(!entries.includes(file),'Private working file entered archive: '+file)
 assert.equal(entries.some(file=>file.startsWith('node_modules/')),false)
 assert.match(path.basename(result.archive),/^Aexus-Bot-0\.0\.0-source\.tar\.gz$/)
 return entries
}
try{
 for(const file of ['source-files.mjs','package-source.mjs'])write('scripts/'+file,fs.readFileSync(path.join(root,'scripts',file)))
 write('package.json',JSON.stringify({version:'0.0.0'}));write('plugins.lock.json',JSON.stringify({plugins:plugins.map(directory=>({directory,version:'0.0.0'}))}))
 for(const plugin of plugins){write('PlugIns/'+plugin+'/package.json',JSON.stringify({version:'0.0.0'}));write('PlugIns/'+plugin+'/LICENSE','Fixture license');write('PlugIns/'+plugin+'/src/index.ts','export const fixture=true\n')}
 for(const file of ['README.md','docs/guide.md','build.py','build/entitlements.mac.plist','src/index.ts'])write(file,'Public fixture '+file+'\n')
 write('docs/images/promo.png',Buffer.from([137,80,78,71]));write('PlugIns/README.md','Public plugin sources\n')
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),process.platform==='win32'?'junction':'dir')
 execute('git',['init','--quiet']);execute('git',['add','--','scripts','package.json','plugins.lock.json','README.md','docs','build.py','build','src','PlugIns'])
 for(const file of ['private.md','image.png','sources.md','src/private.md','docs/private.md','workspaces/private.json'])write(file,'PRIVATE WORKING FILE\n')
 const versioned=await pack()
 const sourceManifest=path.join(temp,'.dist','Aexus-Bot-0.0.0-source','SOURCE_MANIFEST.json')
 fs.copyFileSync(sourceManifest,path.join(temp,'SOURCE_MANIFEST.json'));fs.rmSync(path.join(temp,'.git'),{recursive:true,force:true})
 const extracted=await pack();assert.deepEqual(extracted,versioned)
 fs.rmSync(path.join(temp,'SOURCE_MANIFEST.json'));for(const file of ['src/private.md','docs/private.md'])fs.rmSync(path.join(temp,file));await pack()
 console.log('PASS Git, extracted manifest and manifest-free source archives preserve all three plugin sources, public docs, promo assets and macOS build inputs; private working Markdown, images and workspaces are excluded from controlled snapshots, and unlisted root files are excluded from the manifest-free fallback')
}finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
