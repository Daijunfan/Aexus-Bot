'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {prepare,environment,hash,walk}=require('./release-pack.cjs');
const {overall,legacyPreflight}=require('./release-status.cjs');
function manifestFiles(manifest){
 if(!Array.isArray(manifest?.files)||manifest.fileCount!==manifest.files.length)throw Error('Invalid file manifest count');
 const files=new Map();let bytes=0;
 for(const file of manifest.files){
  if(typeof file.path!=='string'||!file.path||file.path.startsWith('/')||file.path.includes('\\')||/[\x00-\x1f\x7f]/.test(file.path)||file.path!==path.posix.normalize(file.path)||file.path.split('/').some(p=>p==='.'||p==='..')||files.has(file.path))throw Error('Invalid or duplicate manifest path: '+file.path);
  if(!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid file manifest metadata: '+file.path);
  files.set(file.path,file);bytes+=file.bytes;
 }
 if(!Number.isSafeInteger(bytes)||bytes!==manifest.unpackedBytes)throw Error('Invalid file manifest byte total');
 return files;
}
function validateTarEntries(manifest,listing,verbose){
 const files=manifestFiles(manifest),lines=text=>text.trimEnd().split('\n').filter(Boolean),entries=lines(listing),details=lines(verbose),seen=new Set();
 const directories=new Set(['package']);for(const name of files.keys()){let parent=path.posix.dirname('package/'+name);while(parent!=='.'){directories.add(parent);parent=path.posix.dirname(parent);}}
 if(entries.length!==details.length)throw Error('Archive path/type listing differs');
 for(let i=0;i<entries.length;i++){
  const entry=entries[i],name=entry.replace(/\/$/,''),kind=details[i][0];
  if(name!=='package'&&!name.startsWith('package/'))throw Error('Archive entry escapes package directory: '+entry);
  if(name.startsWith('/')||name.includes('\\')||/[\x00-\x1f\x7f]/.test(name)||name!==path.posix.normalize(name)||name.split('/').some(p=>p==='.'||p==='..')||seen.has(name))throw Error('Unsafe or duplicate archive entry: '+entry);
  if(kind==='d'){if(!directories.has(name))throw Error('Unexpected archive directory: '+entry);}
  else if(kind!=='-'||!files.has(name.slice(8)))throw Error('Archive contains a link, special file or unlisted payload: '+entry);
  seen.add(name);
 }
 for(const name of files.keys())if(!seen.has('package/'+name))throw Error('Archive is missing manifest file: '+name);
}
function verifyPayload(manifest,directory){
 const expected=manifestFiles(manifest),actual=walk(directory);let bytes=0;
 for(const file of actual){const wanted=expected.get(file.path);if(!wanted)throw Error('Unexpected unpacked file: '+file.path);if(wanted.bytes!==file.bytes||wanted.sha256!==file.sha256)throw Error('Unpacked bytes differ from manifest: '+file.path);expected.delete(file.path);bytes+=file.bytes;}
 if(expected.size)throw Error('Missing unpacked file: '+expected.keys().next().value);
 if(actual.length!==manifest.fileCount||bytes!==manifest.unpackedBytes)throw Error('Unpacked manifest totals differ');
 return {verifiedFiles:actual.length,verifiedBytes:bytes};
}
function verify(input){
 const release=input?{tarball:path.resolve(input)}:prepare();
 const output=path.join(path.dirname(release.tarball),'verify-'+new Date().toISOString().replace(/[:.]/g,'-'));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'marginreader-consumer-'));
 const consumer=path.join(temp,'consumer'),home=path.join(temp,'home'),workspace=path.join(consumer,'isolated-library');
 fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(home);fs.writeFileSync(path.join(home,'empty.npmrc'),'');fs.mkdirSync(output,{recursive:true});
 const env=environment(home),npm=process.platform==='win32'?'npm.cmd':'npm';
 const installed=path.join(consumer,'node_modules/marginreader'),bin=path.join(consumer,'node_modules/.bin/margin-reader');
 const sandbox='/usr/bin/sandbox-exec',profile='(version 1) (allow default) (deny network*)';
 const report={output,tarball:release.tarball,sha256:hash(fs.readFileSync(release.tarball)),platform:process.platform,osRelease:os.release(),arch:process.arch,node:process.version,startedAt:new Date().toISOString(),verifierSHA256:hash(fs.readFileSync(__filename)),gates:[],passed:[],failed:[],blocked:[],notRun:[],network:{mechanism:'macOS inherited process sandbox',executable:sandbox,profile,probe:'outbound TCP to 1.1.1.1:443 must return EPERM before business checks',serve:'loopback-only asset check performed outside deny-network sandbox'}};
 function gate(name,fn){try{fn();report.gates.push({name,status:'passed'});report.passed.push(name);return true;}catch(e){report.gates.push({name,status:'failed',error:e.stack});report.failed.push({name,error:e.stack});process.exitCode=1;return false;}}
 function unavailable(name,reason,status='notRun'){report.gates.push({name,status,reason});report[status].push({name,reason});if(status==='blocked')process.exitCode=1;}
 function child(file,args,log,timeout=300000){const result=spawnSync(file,args,{cwd:consumer,env,encoding:'utf8',timeout,maxBuffer:20*1024*1024});fs.writeFileSync(path.join(output,log),(result.stdout||'')+'\n'+(result.stderr||''));if(result.error)throw result.error;if(result.status!==0)throw Error(`${log}: exit ${result.status}; inspect retained log`);return result.stdout;}
 try{
  const integrity=gate('tarball SHA-256 and every unpacked file match exact manifest',()=>{
   const file=path.join(path.dirname(release.tarball),'filelist.json'),manifest=JSON.parse(fs.readFileSync(file));
   if(manifest.sha256!==report.sha256||manifest.size!==fs.statSync(release.tarball).size)throw Error('Archive differs from filelist.json');
   validateTarEntries(manifest,child('tar',['-tzf',release.tarball],'archive-paths.log'),child('tar',['-tvzf',release.tarball],'archive-types.log'));
   const unpack=path.join(temp,'manifest-unpack');fs.mkdirSync(unpack);child('tar',['-xzf',release.tarball,'-C',unpack],'archive-unpack.log');
   const roots=fs.readdirSync(unpack);if(roots.length!==1||roots[0]!=='package')throw Error('Unexpected archive root');
   report.manifest={path:file,sha256:hash(fs.readFileSync(file)),fileCount:manifest.fileCount,...verifyPayload(manifest,path.join(unpack,'package'))};
  });
  const installedOK=integrity&&gate('clean npm consumer install without lifecycle scripts or host environment',()=>{report.npm=child(npm,['--version'],'npm-version.log',30000).trim();child(npm,['install','--prefix',consumer,release.tarball,'--ignore-scripts','--no-audit','--no-fund','--package-lock=false'],'install.log');});
  if(!installedOK){for(const name of ['npm bin','outside-source discovery','offline workflow','installed TUI PTY','terminal-visuals module','optional serve'])unavailable(name,'clean package install prerequisite failed');return report;}
  const binOK=gate('npm bin exists',()=>{if(!fs.existsSync(bin))throw Error('npm bin was not installed');});
  const discovery=binOK&&gate('installed launcher runs from a cwd outside source (direct POSIX bin; Windows native shim untested)',()=>{const windows=process.platform==='win32';const value=JSON.parse(child(windows?process.execPath:bin,windows?[bin,'schema','system.info']:['schema','system.info'],'discovery.log',30000));if(value.method!=='system.info')throw Error('Unexpected discovery result');report.launcher={mechanism:windows?'explicit Node; native Windows shim untested':'direct POSIX npm bin, including shebang and execute permissions'};});
  const hasSandbox=process.platform==='darwin'&&fs.existsSync(sandbox);
  if(discovery&&hasSandbox){
   gate('installed business workflow under inherited OS network denial',()=>{const harness=path.join(temp,'workflow.cjs');fs.copyFileSync(path.join(__dirname,'package-workflow.cjs'),harness);report.workflowSHA256=hash(fs.readFileSync(harness));child(sandbox,['-p',profile,process.execPath,harness,consumer,workspace,path.join(output,'offline-workflow.json')],'offline-workflow.log');});
   gate('installed TUI real PTY: offline excerpt, multiline note, hierarchy, spatial source navigation, FSRS, undo/redo, restart and terminal restoration',()=>{const pty=path.join(temp,'tui-pty.py');fs.copyFileSync(path.join(__dirname,'package-tui-pty.py'),pty);report.ptyHarnessSHA256=hash(fs.readFileSync(pty));child(sandbox,['-p',profile,'python3',pty,process.execPath,bin,path.join(consumer,'isolated-tui-library'),consumer,path.join(output,'installed-tui-pty.json')],'installed-tui-pty.log',180000);});
  }else{
   const reason=hasSandbox?'installed bin discovery failed':'OS network sandbox unavailable; offline checks are not passed';
   unavailable('offline workflow',reason,hasSandbox?'notRun':'blocked');unavailable('installed TUI PTY',reason,hasSandbox?'notRun':'blocked');
  }
  if(fs.existsSync(path.join(installed,'terminal-visuals/index.cjs'))&&hasSandbox){
   gate('installed terminal-visuals renders Unicode nodes and hierarchy under OS network denial',()=>{const probe=path.join(temp,'visuals.cjs');fs.writeFileSync(probe,`const assert=require('node:assert/strict'),fs=require('node:fs');(async()=>{const visual=await require(${JSON.stringify(path.join(installed,'terminal-visuals/index.cjs'))}).createTerminalVisuals();const scene=visual.prepare({study:{id:'fixture',revision:1,cards:[{id:'parent',title:'中文父节点'},{id:'child',title:'子主题🙂',parentId:'parent'}]},geometry:{revision:1,positions:[{cardId:'parent',x:0,y:0,width:220,height:96},{cardId:'child',x:360,y:144,width:220,height:96}],links:[{id:'branch',from:'parent',to:'child'}]}});const viewport={columns:120,rows:30},state=visual.reduce(scene,visual.initialState({selectedId:'child'}),{type:'fit'},viewport).state,frame=visual.render(scene,state,{...viewport,color:'none'}),text=visual.toPlainText(frame);assert.equal(frame.stats.visibleCards,2);assert.equal(frame.stats.renderedEdges,1);assert.match(text,/中文父节点/);assert.match(text,/子主题🙂/);assert.equal(frame.selectedId,'child');fs.writeFileSync(${JSON.stringify(path.join(output,'terminal-visuals-frame.txt'))},text+'\\n');console.log(JSON.stringify({stats:frame.stats,visibleIds:frame.visibleIds,selectedId:frame.selectedId}));})().catch(e=>{console.error(e);process.exitCode=1;});`);child(sandbox,['-p',profile,process.execPath,probe],'terminal-visuals.log',30000);});
  }else unavailable('terminal-visuals module','module absent from installed package, or OS sandbox unavailable','blocked');
  // These independent checks still run when a workflow or TUI gate fails.
  gate('optional serve local renderer and generated vendor assets (loopback outside offline sandbox)',()=>{
   const probe=path.join(temp,'serve.cjs');fs.writeFileSync(probe,`const assert=require('node:assert/strict');(async()=>{const s=await require(${JSON.stringify(path.join(installed,'lib/server.cjs'))}).startServer({workspace:${JSON.stringify(workspace)}});try{for(const p of ['index.html','vendor/pdf.mjs','vendor/pdf.worker.mjs','vendor/katex/katex.min.css']){const r=await fetch(new URL(p,s.url));assert.equal(r.status,200,p);assert((await r.arrayBuffer()).byteLength>0);}}finally{await s.close();}})().catch(e=>{console.error(e);process.exitCode=1;});`);child(process.execPath,[probe],'serve.log',30000);
  });
 }catch(e){report.failed.push({name:'verifier setup',error:e.stack});process.exitCode=1;}
 finally{
  report.requiredLegacyGates=legacyPreflight(path.resolve(__dirname,'..'));report.packageStatus=overall({failed:report.failed.length,blocked:report.blocked.length,notRun:report.notRun.length});report.overall=overall({failed:report.failed.length,blocked:report.blocked.length+report.requiredLegacyGates.length,notRun:report.notRun.length});report.scope='installed package gates plus required legacy gates; source suite results reported separately';report.countsScope="installed package gates; required legacy listed separately";report.requiredLegacyBlocked=report.requiredLegacyGates.length;report.counts={passed:report.passed.length,failed:report.failed.length,blocked:report.blocked.length,notRun:report.notRun.length};report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'package-verification.json'),JSON.stringify(report,null,2)+'\n');fs.rmSync(temp,{recursive:true,force:true});console.log(JSON.stringify(report,null,2));
 }
 return report;
}
if(require.main===module)verify(process.argv[2]);module.exports={verify,manifestFiles,validateTarEntries,verifyPayload};
