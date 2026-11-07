'use strict';
const fs=require('node:fs'),path=require('node:path');
// Overall includes required but unavailable gates; a subset passing is not a full pass.
function overall({failed=0,blocked=0,notRun=0,skipped=0}={}){
 if(failed)return 'failed';
 return blocked||notRun||skipped?'partial':'passed';
}
function legacyPreflight(root){
 const host=path.resolve(root,'../..');
 const needed=['bin/agents','test/fixtures/headless-core.mjs','node_modules/@playwright/test/package.json','node_modules/electron/package.json'];
 const missing=needed.filter(p=>!fs.existsSync(path.join(host,p))).map(p=>path.join(host,p));
 return ['test:agent-acceptance','test:deep-audit'].map(suite=>({suite,status:'blocked',reason:missing.length?'legacy host prerequisites absent at paths used by unchanged tests':'prerequisites present, but protocol-fixture safety review and actual legacy suite execution are still required',missing}));
}
module.exports={overall,legacyPreflight};
