'use strict';
const fs=require('node:fs'),path=require('node:path');

module.exports=function checkUiResources(root){
 let count=0;
 function walk(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);
   if(entry.isDirectory()){walk(file);continue;}
   if(!/\.(?:html|css)$/.test(entry.name))continue;
   const pattern=entry.name.endsWith('.html')?/\b(?:src|href)\s*=\s*["']([^"']*)["']/g:/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^"'()]*))\s*\)/g;
   for(const match of fs.readFileSync(file,'utf8').matchAll(pattern)){
    const reference=(match[1]??match[2]??match[3]??'').trim();
    if(!reference||/^(?:#|\/\/|[a-z][\w+.-]*:)/i.test(reference))continue;
    const target=decodeURIComponent(reference.split(/[?#]/,1)[0]);
    if(!target)continue;
    const resolved=target.startsWith('/')?path.join(root,target):path.resolve(path.dirname(file),target);
    if(!fs.existsSync(resolved))throw Error(`Missing UI resource: ${path.relative(root,file)} -> ${reference}`);
    count++;
   }
  }
 }
 walk(root);return count;
};
