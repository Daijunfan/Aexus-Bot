'use strict';
const fs=require('node:fs'),path=require('node:path');
const artifacts=path.resolve(__dirname,'../artifacts');
fs.mkdirSync(artifacts,{recursive:true});
const output=fs.mkdtempSync(path.join(artifacts,'verification-'));
for(const name of ['completion-current.txt','current-completion-path.txt','read-map-current.txt'])fs.writeFileSync(path.join(artifacts,name),output+'\n');
