'use strict';
const fs = require('node:fs/promises');
const {ReaderError,assert} = require('../safety.cjs');
const {schema,kebab,definitions,legacy} = require('./commands.cjs');
const invalid = message => {throw new ReaderError('INVALID_PARAMS',message);};
async function parse(argv) {
 const options={}, args=[], seen=new Set();
 const globals={workspace:'string',output:'string',json:'boolean',help:'boolean',version:'boolean'};
 let literal=false;
 for(let i=0;i<argv.length;i++){
  const token=argv[i]; if(token==='--'){literal=true;args.push(...argv.slice(i));break;}
  const match=!literal && token.match(/^--([^=]+)(?:=(.*))?$/s);
  if(!match || !Object.hasOwn(globals,match[1])){args.push(token);continue;}
  const [,key,inline]=match; if(seen.has(key))invalid('Repeated option: --'+key); seen.add(key);
  if(globals[key]==='boolean'){if(inline!==undefined)invalid('--'+key+' does not take a value');options[key]=true;}
  else {const value=inline===undefined?argv[++i]:inline;if(value===undefined||value.startsWith('--'))invalid('Missing value: --'+key);options[key]=value;}
 }
 if(options.output&&!['json','pretty','text'].includes(options.output))invalid('--output must be json, pretty or text');
 if(options.json&&options.output&&options.output!=='json')invalid('--json conflicts with --output');
 const command=args[0];
 if(!command||['help','commands','schema','completion'].includes(command)||options.help||options.version) {
  if(args.some(token=>token.startsWith('-')))invalid('Unknown discovery option: '+args.find(token=>token.startsWith('-')));
  return {options,positionals:args,discovery:true};
 }
 if(command==='api'||command==='import'||command==='serve'||command==='tui'){
  const allowed=command==='api'?{data:'string',text:'boolean'}:command==='import'?{to:'string',password:'string'}:command==='serve'?{port:'string'}:{};
  const rest=[]; let end=false;
  for(let i=1;i<args.length;i++){
   if(args[i]==='--'&&!end){end=true;continue;}
   if(end||!args[i].startsWith('-')){rest.push(args[i]);continue;}
   const m=args[i].match(/^--([^=]+)(?:=(.*))?$/s); if(!m||!Object.hasOwn(allowed,m[1]))invalid('Unknown option: '+args[i]);
   const [,key,value]=m;if(Object.hasOwn(options,key))invalid('Repeated option: --'+key);
   if(allowed[key]==='boolean'){if(value!==undefined)invalid('--'+key+' does not take a value');options[key]=true;}
   else {options[key]=value===undefined?args[++i]:value;if(options[key]===undefined||options[key].startsWith('--'))invalid('Missing value: --'+key);}
  }
  if(command==='tui'&&rest.length||command==='serve'&&rest.length||command==='api'&&rest.length!==1||command==='import'&&rest.length!==1)invalid('Unexpected or missing positional arguments for '+command);
  if(command==='import'&&!options.to)invalid('import requires --to');
  if(options.port!==undefined&&(!/^\d+$/.test(options.port)||Number(options.port)>65535))invalid('--port must be 0–65535');
  return {options,positionals:[command,...rest]};
 }
 let def, consumed;
 if(Object.hasOwn(legacy,command)){const [method,positionals]=legacy[command];def={name:command,method,positionals,command:schema.commands.find(c=>c.method===method)};consumed=1;}
 else {
  def=[...definitions].sort((a,b)=>b.name.split(' ').length-a.name.split(' ').length).find(d=>d.name.split(' ').every((part,i)=>args[i]===part));
  if(!def)invalid('Unknown command: '+command+'. Run commands or help.');
  consumed=def.name.split(' ').length;
 }
 const params={}, positional=[], rules=def.command.options||{};
 const names=Object.fromEntries(Object.keys(rules).map(key=>[kebab(key),key]));
 let stdinUsed=false;
 async function value(raw,rule,key){
  if(raw==='null'&&rule.nullable)return null;
  let result=raw;
  if(rule.type==='object'||rule.type==='array'){
   try {
    if(raw==='-'){if(stdinUsed)invalid('stdin may only be consumed once');stdinUsed=true;raw=await readStdin();}
    else if(raw.startsWith('@'))raw=await fs.readFile(raw.slice(1),'utf8');
    result=JSON.parse(raw);
   }catch(e){if(e instanceof ReaderError)throw e;invalid('--'+kebab(key)+' requires valid '+rule.type+' JSON, @file or -');}
  } else if(rule.type==='number'){if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))invalid('--'+kebab(key)+' must be a number');result=Number(raw);}
  else if(rule.type==='boolean'){if(!['true','false'].includes(raw))invalid('--'+kebab(key)+' must be true or false');result=raw==='true';}
  assert(rule.type==='array'?Array.isArray(result):result!==null&&typeof result===rule.type&&(rule.type!=='object'||!Array.isArray(result)),'INVALID_PARAMS',key+' must be '+rule.type);
  if(rule.enum)assert(rule.enum.includes(result),'INVALID_PARAMS','Unsupported '+key+': '+result);
  if(rule.type==='number')assert(Number.isFinite(result)&&(!rule.integer||Number.isInteger(result))&&(rule.minimum===undefined||result>=rule.minimum)&&(rule.maximum===undefined||result<=rule.maximum),'INVALID_PARAMS',key+' is outside its allowed range');
  return result;
 }
 let end=false;
 for(let i=consumed;i<args.length;i++){
  const token=args[i];if(token==='--'&&!end){end=true;continue;}
  if(end||!token.startsWith('-')){positional.push(token);continue;}
  if(token==='--text'&&['read'].includes(command)){if(options.text)invalid('Repeated --text');options.text=true;continue;}
  const m=token.match(/^--([^=]+)(?:=(.*))?$/s);if(!m||!Object.hasOwn(names,m[1]))invalid('Unknown option: '+token);
  const key=names[m[1]],rule=rules[key];if(Object.hasOwn(params,key))invalid('Repeated option: --'+m[1]);
  let raw=m[2];
  if(raw===undefined){if(rule.type==='boolean'&&!['true','false'].includes(args[i+1]))raw='true';else raw=args[++i];}
  if(raw===undefined||(m[2]===undefined&&raw.startsWith('--')))invalid('Missing value: --'+m[1]);
  params[key]=await value(raw,rule,key);
 }
 if(command==='search'&&positional.length>2)positional.splice(1,positional.length-1,positional.slice(1).join(' '));
 if(positional.length>def.positionals.length)invalid('Unexpected positional argument: '+positional[def.positionals.length]);
 for(let i=0;i<positional.length;i++){const key=def.positionals[i];if(Object.hasOwn(params,key))invalid('Ambiguous positional and option: '+key);params[key]=await value(positional[i],rules[key],key);}
 for(const [key,rule] of Object.entries(rules))if(rule.required&&!Object.hasOwn(params,key))invalid('Missing --'+kebab(key)+'. Run help '+def.name);
 if(def.kind==='map-render'&&(params.columns??120)*(params.rows??36)>100000)invalid('columns × rows must not exceed 100000 cells');
 return {options,positionals:[command],...(def.kind?{action:def.kind}:{method:def.method}),params:{...def.defaults,...params}};
}
async function readStdin(){const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);return Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8');}
module.exports={parse,readStdin};
