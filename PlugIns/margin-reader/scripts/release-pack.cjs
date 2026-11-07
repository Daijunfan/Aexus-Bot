'use strict';
// Release preparation never runs generators in the working source tree.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const docs=['CLI_REFERENCE.md','TERMINAL_WORKSPACE.md','TERMINAL_VISUALS.md','CLI_PRODUCT_ACCEPTANCE.md','COMPETITIVE_GAPS.md','RELEASING.md'];
function environment(home){const env={};for(const k of ['PATH','SystemRoot','WINDIR','LANG','LC_ALL','TMPDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];return {...env,HOME:home,USERPROFILE:home,npm_config_userconfig:path.join(home,'empty.npmrc'),npm_config_cache:path.join(home,'npm-cache'),npm_config_audit:'false',npm_config_fund:'false'};}
function run(file,args,cwd,env){const r=spawnSync(file,args,{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:20*1024*1024});if(r.status!==0)throw Error(`${file} ${args.join(' ')} failed (${r.status}): ${r.stderr}\n${r.stdout}`);return r.stdout;}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function walk(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{const rel=prefix+e.name,full=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Release source contains symlink: '+rel);return e.isDirectory()?walk(full,rel+'/'):[{path:rel,bytes:fs.statSync(full).size,sha256:hash(fs.readFileSync(full))}];});}
function prepare(){
 const output=path.join(root,'artifacts','cli-product-20261018','release','run-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(output,{recursive:true});
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'marginreader-pack-')),stage=path.join(temp,'source'),home=path.join(temp,'home');fs.mkdirSync(stage);fs.mkdirSync(home);fs.writeFileSync(path.join(home,'empty.npmrc'),'');const env=environment(home);
 try{
  for(const name of ['cli.cjs','runtime.cjs','package.json','package-lock.json','schema.json','agents-company.plugin.json','API.md','README.md','LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','CHANGELOG.md','lib','scripts','tests','tui','terminal-visuals','ui']){
   const src=path.join(root,name);if(!fs.existsSync(src))throw Error('Missing release input: '+name);
   fs.cpSync(src,path.join(stage,name),{recursive:true,filter:s=>{const rel=path.relative(root,s).split(path.sep);return !rel.some(p=>['vendor','node_modules','artifacts','workspaces','.margin-reader','.agents-company','credentials','.git'].includes(p));}});
  }
  fs.cpSync(path.join(root,'docs'),path.join(stage,'docs'),{recursive:true});for(const name of docs){const src=path.join(root,'docs',name);if(!fs.existsSync(src))throw Error('Missing release document: '+name);fs.copyFileSync(src,path.join(stage,'docs',name));}
  const inputs=walk(stage);fs.writeFileSync(path.join(output,'source-inputs.json'),JSON.stringify({files:inputs},null,2)+'\n');
  run(process.execPath,['-e',"require('./scripts/contracts.cjs').generate(); require('./scripts/docs.cjs').generate()"],stage,env);
  const vendor=path.join(stage,'ui','vendor');fs.mkdirSync(vendor,{recursive:true});
  const expected=JSON.parse(fs.readFileSync(path.join(stage,'package.json'))).dependencies;for(const name of ['pdfjs-dist','katex'])if(require(name+'/package.json').version!==expected[name])throw Error('Installed asset dependency differs from pinned package: '+name);
  const pdf=path.dirname(require.resolve('pdfjs-dist/package.json'));
  for(const [a,b]of [['build/pdf.mjs','pdf.mjs'],['build/pdf.worker.mjs','pdf.worker.mjs'],['web/pdf_viewer.css','pdf_viewer.css'],['cmaps','cmaps'],['standard_fonts','standard_fonts'],['wasm','wasm'],['LICENSE','PDFJS-LICENSE']])fs.cpSync(path.join(pdf,a),path.join(vendor,b),{recursive:true});
  fs.cpSync(path.join(path.dirname(require.resolve('katex/package.json')),'dist'),path.join(vendor,'katex'),{recursive:true});
  const lock=JSON.parse(fs.readFileSync(path.join(stage,'package-lock.json')));fs.writeFileSync(path.join(stage,'npm-shrinkwrap.json'),JSON.stringify(lock,null,2)+'\n');const inventory=Object.entries(lock.packages).filter(([k])=>k).map(([k,v])=>({name:k.slice(k.lastIndexOf('node_modules/')+13),version:v.version,license:v.license||(k==='node_modules/png-js'&&v.version==='1.1.0'?'MIT (verified installed LICENSE)':'UNSPECIFIED: inspect upstream license'),optional:!!v.optional,...(v.os?{os:v.os}:{}),...(v.cpu?{cpu:v.cpu}:{})}));fs.writeFileSync(path.join(stage,'DEPENDENCY_LICENSES.json'),JSON.stringify({source:'package-lock.json',dependencies:inventory},null,2)+'\n');
  fs.copyFileSync(path.join(path.dirname(require.resolve('katex/package.json')),'LICENSE'),path.join(vendor,'KATEX-LICENSE'));
  fs.writeFileSync(path.join(output,'check.log'),run(process.execPath,['scripts/check.cjs'],stage,env));
  const npm=process.platform==='win32'?'npm.cmd':'npm',packed=JSON.parse(run(npm,['pack','--json','--ignore-scripts','--pack-destination',output],stage,env))[0];
  fs.writeFileSync(path.join(output,'npm-pack.json'),JSON.stringify(packed,null,2)+'\n');
  const archive=path.join(output,packed.filename),unpack=path.join(temp,'unpack');fs.mkdirSync(unpack);run('tar',['-xzf',archive,'-C',unpack],temp,env);
  const payload=walk(path.join(unpack,'package'));
  for(const f of payload){if(/(^|\/)(node_modules|workspaces|credentials|artifacts|dist-plugin|\.margin-reader|\.agents-company|\.git)(\/|$)|source-location|(^|\/)\.env(?:\.|$)|docs\/(?:HISTORY|HOURLY_|VERIFICATION)/i.test(f.path))throw Error('Forbidden package file: '+f.path);const bytes=fs.readFileSync(path.join(unpack,'package',f.path));if(bytes.includes(Buffer.from(root))||bytes.includes(Buffer.from('/Users/djf/')))throw Error('Private source path in '+f.path);}
  const meta=JSON.parse(fs.readFileSync(path.join(unpack,'package/package.json')));if(meta.dependencies&&meta.bundledDependencies)throw Error('Native dependencies must be installed by target-platform npm');
  for(const f of inputs){const current=path.join(root,f.path);if(!fs.existsSync(current)||hash(fs.readFileSync(current))!==f.sha256)throw Error('Source changed during packaging; retry after integration: '+f.path);}
  const report={createdAt:new Date().toISOString(),platform:process.platform,arch:process.arch,node:process.version,tarball:archive,sha256:hash(fs.readFileSync(archive)),size:fs.statSync(archive).size,fileCount:payload.length,unpackedBytes:payload.reduce((n,x)=>n+x.bytes,0),files:payload};
  fs.writeFileSync(path.join(output,'filelist.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(output,'SHA256SUMS'),report.sha256+'  '+packed.filename+'\n');console.log(JSON.stringify({...report,files:undefined},null,2));return report;
 }catch(e){fs.writeFileSync(path.join(output,'pack-failure.log'),e.stack+'\n');throw e;}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module){try{prepare();}catch(e){console.error(e.stack);process.exitCode=1;}}
module.exports={prepare,environment,run,walk,hash};
