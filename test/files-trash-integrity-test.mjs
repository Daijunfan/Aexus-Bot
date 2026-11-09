// Files remain recoverable when metadata writes or physical moves fail.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
const root=process.cwd(),temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ac-trash-integrity-'))),entry=path.join(temp,'files.cjs'),file=path.join(temp,'report.pdf'),content='%PDF-1.4\nPreserve these exact bytes\n%%EOF'
const originalWrite=fs.writeFileSync,originalRename=fs.renameSync
try{
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir')
 await build({entryPoints:[path.join(root,'src/main/files.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'})
 const {workspaceFiles,workspaceTrash}=createRequire(import.meta.url)(entry)
 fs.writeFileSync(file,content)
 fs.writeFileSync=(...args)=>{if(typeof args[0]==='number')throw Object.assign(Error('simulated metadata disk failure'),{code:'ENOSPC'});return originalWrite(...args)}
 assert.throws(()=>workspaceFiles(temp,'trash',{path:'report.pdf'}),/simulated/)
 fs.writeFileSync=originalWrite;assert.equal(fs.readFileSync(file,'utf8'),content);assert.deepEqual(workspaceTrash(temp),[])
 fs.renameSync=(from,to)=>{if(from===file)throw Object.assign(Error('simulated move failure'),{code:'EACCES'});return originalRename(from,to)}
 assert.throws(()=>workspaceFiles(temp,'trash',{path:'report.pdf'}),/simulated/)
 fs.renameSync=originalRename;assert.equal(fs.readFileSync(file,'utf8'),content);assert.deepEqual(workspaceTrash(temp),[])
 const receipt=workspaceFiles(temp,'trash',{path:'report.pdf'})
 assert.equal(workspaceTrash(temp).length,1)
 fs.writeFileSync=(...args)=>{if(typeof args[0]==='number')throw Error('simulated restore receipt failure');return originalWrite(...args)}
 assert.throws(()=>workspaceFiles(temp,'restore',{id:receipt.id},{keepReceipt:true}),/simulated/)
 fs.writeFileSync=originalWrite;assert.equal(workspaceTrash(temp).length,1);assert.equal(fs.existsSync(file),false)
 fs.renameSync=(from,to)=>{if(to===file)throw Error('simulated restore move failure');return originalRename(from,to)}
 assert.throws(()=>workspaceFiles(temp,'restore',{id:receipt.id},{keepReceipt:true}),/simulated/)
 fs.renameSync=originalRename;assert.equal(workspaceTrash(temp).length,1)
 workspaceFiles(temp,'restore',{id:receipt.id},{keepReceipt:true});assert.equal(fs.readFileSync(file,'utf8'),content);assert.deepEqual(workspaceTrash(temp),[])
 console.log('PASS trash integrity: failed manifest writes never move a file; failed moves leave no orphan; failed restore receipts/moves keep the blob discoverable; final recovery preserves exact bytes')
}finally{fs.writeFileSync=originalWrite;fs.renameSync=originalRename;fs.rmSync(temp,{recursive:true,force:true})}
