'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {writeNew}=require('../lib/safety.cjs');
const failure=code=>Object.assign(new Error('injected '+code),{code});
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mr-write-new-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,file:path.join(directory,'output.png')};}
function intercept(t,file,change){const open=fs.open.bind(fs);t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args);if(args[0]===file&&args[1]==='wx')change(handle);return handle;});}

test('partial new-file write failures remove the owned fragment and allow a clean retry',async t=>{
 const {file}=await fixture(t);let inject=true,closed=0;
 intercept(t,file,handle=>{const write=handle.writeFile.bind(handle),close=handle.close.bind(handle);handle.close=async()=>{closed++;return close();};handle.writeFile=async bytes=>{if(!inject)return write(bytes);inject=false;await write(Buffer.from('partial'));throw failure('ENOSPC');};});
 await assert.rejects(writeNew(file,Buffer.from('complete export')),{code:'ENOSPC'});
 assert.equal(await fs.stat(file).catch(()=>null),null);assert.equal(closed,1);
 await writeNew(file,Buffer.from('complete export'));assert.equal(await fs.readFile(file,'utf8'),'complete export');assert.equal(closed,2);
});

test('sync and close failures clean the created target while preserving the original write error',async t=>{
 const {directory}=await fixture(t);
 for(const mode of ['sync','close','write-and-close']){
  const file=path.join(directory,mode+'.png');let closed=0;
  intercept(t,file,handle=>{const write=handle.writeFile.bind(handle),close=handle.close.bind(handle);if(mode==='sync')handle.sync=async()=>{throw failure('EIO');};if(mode==='write-and-close')handle.writeFile=async()=>{await write('partial');throw failure('ENOSPC');};handle.close=async()=>{closed++;await close();if(mode!=='sync')throw failure('EIO');};});
  await assert.rejects(writeNew(file,'complete'),{code:mode==='write-and-close'?'ENOSPC':'EIO'});
  assert.equal(await fs.stat(file).catch(()=>null),null);assert.equal(closed,1);
 }
});

test('EEXIST keeps pre-existing files and symbolic links byte-for-byte',async t=>{
 const {directory,file}=await fixture(t),link=path.join(directory,'link.png');
 await fs.writeFile(file,'original user data');await fs.symlink(file,link);
 for(const name of [file,link])await assert.rejects(writeNew(name,'replacement'),{code:'ALREADY_EXISTS'});
 assert.equal(await fs.readFile(file,'utf8'),'original user data');assert((await fs.lstat(link)).isSymbolicLink());
});

test('cleanup preserves an externally replaced regular file during write or close failure',async t=>{
 const {directory}=await fixture(t);
 for(const phase of ['write','close']){
  const file=path.join(directory,phase+'.png'),moved=file+'.moved';
  intercept(t,file,handle=>{const write=handle.writeFile.bind(handle),close=handle.close.bind(handle),replace=async()=>{await fs.rename(file,moved);await fs.writeFile(file,'external replacement');throw failure('EIO');};if(phase==='write')handle.writeFile=async()=>{await write('partial');await replace();};else handle.close=async()=>{await close();await replace();};});
  await assert.rejects(writeNew(file,'complete'),{code:'EIO'});
  assert.equal(await fs.readFile(file,'utf8'),'external replacement');assert.equal(await fs.readFile(moved,'utf8'),phase==='write'?'partial':'complete');
 }
});

test('cleanup neither follows nor removes a replacement symbolic link',async t=>{
 const {directory,file}=await fixture(t),outside=path.join(directory,'other-document.txt'),moved=file+'.moved';await fs.writeFile(outside,'keep this document');
 intercept(t,file,handle=>{const write=handle.writeFile.bind(handle);handle.writeFile=async()=>{await write('partial');await fs.rename(file,moved);await fs.symlink(outside,file);throw failure('ENOSPC');};});
 await assert.rejects(writeNew(file,'complete'),{code:'ENOSPC'});
 assert((await fs.lstat(file)).isSymbolicLink());assert.equal(await fs.readFile(outside,'utf8'),'keep this document');assert.equal(await fs.readFile(moved,'utf8'),'partial');
});

test('an already removed failed target stays absent and cleanup errors do not mask the I/O cause',async t=>{
 const {directory,file}=await fixture(t);
 intercept(t,file,handle=>{handle.writeFile=async()=>{await fs.unlink(file);throw failure('ENOSPC');};});
 await assert.rejects(writeNew(file,'complete'),{code:'ENOSPC'});assert.equal(await fs.stat(file).catch(()=>null),null);
 const blocked=path.join(directory,'blocked.png'),unlink=fs.unlink.bind(fs);
 intercept(t,blocked,handle=>{handle.sync=async()=>{throw failure('ENOSPC');};});
 t.mock.method(fs,'unlink',async name=>{if(name===blocked)throw failure('EACCES');return unlink(name);});
 await assert.rejects(writeNew(blocked,'complete'),error=>error.code==='ENOSPC'&&error.details.cleanup.code==='EACCES'&&error.details.cleanup.createdFileMayRemain);
 assert.equal(await fs.readFile(blocked,'utf8'),'complete');
});

test('failed creation-identity reads preserve the unverified file and report possible residue',async t=>{
 const {file}=await fixture(t);let written=false,closed=0;
 intercept(t,file,handle=>{const close=handle.close.bind(handle);handle.stat=async()=>{throw failure('EIO');};handle.writeFile=async()=>{written=true;};handle.close=async()=>{closed++;return close();};});
 await assert.rejects(writeNew(file,'complete'),error=>error.code==='EIO'&&error.details.cleanup.code==='OWNERSHIP_UNVERIFIED'&&error.details.cleanup.createdFileMayRemain&&/identity.*preserved/.test(error.details.cleanup.message));
 assert.equal(written,false);assert.equal(closed,1);assert.equal(await fs.readFile(file,'utf8'),'');
 await assert.rejects(writeNew(file,'retry'),{code:'ALREADY_EXISTS'});
});
