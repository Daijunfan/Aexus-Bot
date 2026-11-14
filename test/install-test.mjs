import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {installApp,runningApp} from '../scripts/install-app.mjs'
const require=createRequire(import.meta.url),asar=require('@electron/asar'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ac-inst-'))
const target=path.join(temp,'Aexus Bot.app'),legacy=path.join(temp,'Aexus.app'),source=path.join(temp,'candidate.app'),home=path.join(temp,'data')
async function bundle(app,version){
 const content=path.join(temp,'content-'+version);fs.mkdirSync(path.join(content,'out/renderer/assets'),{recursive:true})
 fs.writeFileSync(path.join(content,'out/renderer/index.html'),'<!doctype html><div id="root"></div><script src="./assets/app.js"></script>')
 fs.writeFileSync(path.join(content,'out/renderer/assets/app.js'),'window.version='+JSON.stringify(version))
 fs.mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});fs.mkdirSync(path.join(app,'Contents/MacOS'))
 fs.writeFileSync(path.join(app,'Contents/Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.agentscompany.app</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`)
 await asar.createPackage(content,path.join(app,'Contents/Resources/app.asar'))
}
let process_
try{
 await bundle(target,'1');await bundle(source,'2');fs.mkdirSync(home);fs.writeFileSync(path.join(home,'sessions.json'),'original data')
 const before=fs.readFileSync(path.join(target,'Contents/Resources/app.asar'))
 process_=spawn('/bin/sleep',['30'],{argv0:path.join(target,'Contents/MacOS/Aexus Bot')})
 await new Promise(r=>process_.once('spawn',r))
 assert.ok(runningApp(target).length)
 assert.throws(()=>installApp({source,target,home}),/Running applications cannot be replaced/)
 assert.ok(fs.readFileSync(path.join(target,'Contents/Resources/app.asar')).equals(before))
 assert.equal(fs.existsSync(path.join(home,'backups')),false)
 console.log('PASS installer refuses a running app before changing files or metadata')
 const ended=new Promise(r=>process_.once('exit',r));process_.kill();await ended;process_=undefined
 const result=installApp({source,target,home})
 assert.equal(result.version,'2');assert.equal(result.backup,null);assert.equal(result.legacyBackup,null)
 assert.equal(fs.readFileSync(path.join(home,'sessions.json'),'utf8'),'original data')
 // asar caches by pathname too: inspect via a fresh process/path-independent file read.
 assert.ok(fs.readFileSync(path.join(target,'Contents/Resources/app.asar')).equals(fs.readFileSync(path.join(source,'Contents/Resources/app.asar'))))
 const noTemporaryBundles=()=>assert.deepEqual(fs.readdirSync(temp).filter(name=>name.startsWith('.Aexus-Bot-')),[])
 noTemporaryBundles()
 assert.ok(fs.readdirSync(path.join(home,'backups')).every(name=>name.endsWith('.json')))
 console.log('PASS stopped-app installation verifies the new app and removes the replaced bundle while preserving user data')
 const historical=path.join(home,'backups','user-managed-old.backup');fs.mkdirSync(historical);fs.writeFileSync(path.join(historical,'keep.txt'),'User handles existing backups')
 installApp({source,target,home});noTemporaryBundles()
 assert.deepEqual(fs.readdirSync(path.join(home,'backups')).filter(name=>!name.endsWith('.json')),['user-managed-old.backup'])
 assert.equal(fs.readFileSync(path.join(historical,'keep.txt'),'utf8'),'User handles existing backups')
 console.log('PASS repeated installation creates no permanent app copies and leaves existing user-managed backups untouched')
 const current=fs.readFileSync(path.join(target,'Contents/Resources/app.asar')),rename=fs.renameSync
 try{
  fs.renameSync=(from,to)=>{if(path.basename(from)==='next'&&to===target)throw Error('Simulated install failure');return rename(from,to)}
  assert.throws(()=>installApp({source,target,home}),/Simulated install failure/)
 }finally{fs.renameSync=rename}
 assert.ok(fs.readFileSync(path.join(target,'Contents/Resources/app.asar')).equals(current));noTemporaryBundles()
 assert.equal(fs.readFileSync(path.join(home,'sessions.json'),'utf8'),'original data')
 console.log('PASS failed installation restores the previous app and removes its temporary transaction directory')
 fs.renameSync(target,legacy)
 process_=spawn('/bin/sleep',['30'],{argv0:path.join(legacy,'Contents/MacOS/Aexus')})
 await new Promise(r=>process_.once('spawn',r))
 assert.throws(()=>installApp({source,target,home}),/Running applications cannot be replaced/)
 assert.equal(fs.existsSync(target),false);assert.ok(fs.existsSync(legacy))
 const legacyEnded=new Promise(r=>process_.once('exit',r));process_.kill();await legacyEnded;process_=undefined
 const migrated=installApp({source,target,home})
 assert.ok(fs.existsSync(target));assert.equal(fs.existsSync(legacy),false);assert.equal(migrated.legacyBackup,null)
 assert.equal(migrated.backup,null);noTemporaryBundles()
 assert.equal(fs.readFileSync(path.join(home,'sessions.json'),'utf8'),'original data')
 console.log('PASS Aexus Bot upgrade refuses a running legacy app and removes the stopped legacy bundle after installation')
 const renamed=path.join(temp,'Anexus.app'),otherLegacies=['Avalon.app','Agents Company.app'].map(name=>path.join(temp,name))
 fs.renameSync(target,renamed);for(const app of otherLegacies)await bundle(app,'1')
 process_=spawn('/bin/sleep',['30'],{argv0:path.join(renamed,'Contents/MacOS/Anexus')})
 await new Promise(r=>process_.once('spawn',r))
 assert.throws(()=>installApp({source,target,home}),/Running applications cannot be replaced/)
 const renameEnded=new Promise(r=>process_.once('exit',r));process_.kill();await renameEnded;process_=undefined
 const upgraded=installApp({source,target,home})
 assert.ok(fs.existsSync(target));for(const app of [renamed,...otherLegacies])assert.equal(fs.existsSync(app),false)
 assert.equal(upgraded.legacyBackup,null);assert.equal(fs.readFileSync(path.join(home,'sessions.json'),'utf8'),'original data');noTemporaryBundles()
 console.log('PASS Aexus Bot upgrade removes all replaced product-name variants and retains only the newly installed bundle')
}finally{process_?.kill();fs.rmSync(temp,{recursive:true,force:true})}
