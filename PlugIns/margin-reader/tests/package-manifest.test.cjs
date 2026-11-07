'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {walk}=require('../scripts/release-pack.cjs');
const {manifestFiles,validateTarEntries,verifyPayload}=require('../scripts/verify-package.cjs');

function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mr-package-manifest-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 fs.mkdirSync(path.join(directory,'lib'));
 fs.writeFileSync(path.join(directory,'cli.cjs'),'#!/usr/bin/env node\n');
 fs.writeFileSync(path.join(directory,'lib/helper.cjs'),'module.exports="中文";\n');
 const files=walk(directory),manifest={files,fileCount:files.length,unpackedBytes:files.reduce((n,f)=>n+f.bytes,0)};
 return {directory,manifest};
}

test('release verification matches every actual unpacked byte and rejects same-size tampering',t=>{
 const {directory,manifest}=fixture(t);
 assert.deepEqual(verifyPayload(manifest,directory),{verifiedFiles:2,verifiedBytes:manifest.unpackedBytes});
 const file=path.join(directory,'lib/helper.cjs'),bytes=fs.readFileSync(file);bytes[0]=bytes[0]===120?121:120;fs.writeFileSync(file,bytes);
 assert.throws(()=>verifyPayload(manifest,directory),/Unpacked bytes differ.*helper/);
});

test('release verification rejects missing and extra payload files',t=>{
 const {directory,manifest}=fixture(t);
 fs.writeFileSync(path.join(directory,'private-library.json'),'synthetic unexpected data');
 assert.throws(()=>verifyPayload(manifest,directory),/Unexpected unpacked file/);
 fs.unlinkSync(path.join(directory,'private-library.json'));fs.unlinkSync(path.join(directory,'cli.cjs'));
 assert.throws(()=>verifyPayload(manifest,directory),/Missing unpacked file.*cli/);
});

test('archive path and type preflight rejects traversal, links and unlisted payload before unpacking',t=>{
 const {manifest}=fixture(t),listing='package/\npackage/cli.cjs\npackage/lib/\npackage/lib/helper.cjs\n',types='drwxr-xr-x package/\n-rwxr-xr-x package/cli.cjs\ndrwxr-xr-x package/lib/\n-rw-r--r-- package/lib/helper.cjs\n';
 assert.doesNotThrow(()=>validateTarEntries(manifest,listing,types));
 for(const dangerous of ['/outside','package/../../outside','package/./cli.cjs'])assert.throws(()=>validateTarEntries(manifest,listing.replace('package/cli.cjs',dangerous),types),/escapes|Unsafe/);
 for(const kind of ['l','h','p'])assert.throws(()=>validateTarEntries(manifest,listing,types.replace('-rwxr-xr-x',kind+'rwxr-xr-x')),/link, special file/);
 assert.throws(()=>validateTarEntries(manifest,listing+'package/extra.json\n',types+'-rw-r--r-- package/extra.json\n'),/unlisted payload/);
 assert.throws(()=>validateTarEntries(manifest,listing.replace('package/lib/helper.cjs\n',''),types.replace('-rw-r--r-- package/lib/helper.cjs\n','')),/missing manifest file/);
});

test('file manifests reject ambiguous names, duplicate identities and inconsistent totals',t=>{
 const {manifest}=fixture(t);
 for(const name of ['../outside','/absolute','lib/../cli.cjs','lib\\helper.cjs','bad\nname']){
  const invalid=structuredClone(manifest);invalid.files[0].path=name;
  assert.throws(()=>manifestFiles(invalid),/Invalid or duplicate manifest path/);
 }
 const duplicate=structuredClone(manifest);duplicate.files[1].path=duplicate.files[0].path;
 assert.throws(()=>manifestFiles(duplicate),/duplicate manifest path/);
 assert.throws(()=>manifestFiles({...manifest,fileCount:1}),/manifest count/);
 assert.throws(()=>manifestFiles({...manifest,unpackedBytes:manifest.unpackedBytes+1}),/byte total/);
});
