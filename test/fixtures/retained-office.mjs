import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {build} from 'vite'

/** Compile only the retained component host in a disposable directory, never product out/. */
export async function retainedOffice(web){
 const root=path.resolve(import.meta.dirname,'../..'),directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aexus-retained-office-'))),dist=path.join(directory,'dist'),prefix='/__retained_office_fixture__/'
 try{
  fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),process.platform==='win32'?'junction':'dir')
  await build({configFile:false,root:directory,base:web?prefix:pathToFileURL(dist+path.sep).href,publicDir:false,esbuild:{jsx:'automatic'},build:{outDir:dist,assetsInlineLimit:0,cssCodeSplit:false,reportCompressedSize:false,rollupOptions:{input:path.join(root,'test/fixtures/retained-office.tsx'),output:{format:'iife',inlineDynamicImports:true,entryFileNames:'retained-office.js'}}},logLevel:'silent'})
  return {async attach(page){
   if(web)await page.route('**'+prefix+'**',route=>{const file=path.resolve(dist,decodeURIComponent(new URL(route.request().url()).pathname.slice(prefix.length)));assert.ok(file.startsWith(dist+path.sep));return route.fulfill({path:file})})
   for(const file of fs.readdirSync(dist,{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({content:fs.readFileSync(path.join(dist,file),'utf8')})
   await page.evaluate(fs.readFileSync(path.join(dist,'retained-office.js'),'utf8'))
  },dispose:()=>fs.rmSync(directory,{recursive:true,force:true})}
 }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error}
}
