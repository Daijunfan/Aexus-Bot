'use strict';
const {definitions,legacy,schema,kebab,globalOptions}=require('./commands.cjs');
const {assert}=require('../safety.cjs');
const utilities=['commands','help','schema','completion','api','import','serve','tui'];
function candidates(words){
 // Bash may split --flag=value into three completion words at its '=' word break.
 if(words.length>=3&&words.at(-2)==='='&&words.at(-3).startsWith('--')){const prefix=words.at(-3)+'=';return candidates([...words.slice(0,-3),prefix+(words.at(-1)||'')]).map(v=>v.slice(prefix.length));}
 words=words.reduce((out,word,i)=>{if(word==='='&&out.at(-1)?.startsWith('--')&&i<words.length-1){out[out.length-1]+='=';}else if(out.at(-1)?.endsWith('=')&&out.at(-1).startsWith('--'))out[out.length-1]+=word;else out.push(word);return out;},[]);
 const current=words.at(-1)||'', previous=words.slice(0,-1),tokens=[];
 let pendingGlobal=null;
 for(let i=0;i<previous.length;i++){
  const m=previous[i].match(/^--([^=]+)(?:=(.*))?$/s);
  if(m&&Object.hasOwn(globalOptions,m[1])){
   if(globalOptions[m[1]].type==='string'&&m[2]===undefined){if(i===previous.length-1)pendingGlobal=m[1];else i++;}
   continue;
  }
  tokens.push(previous[i]);
 }
 const filter=values=>[...new Set(values.map(String))].filter(v=>v.startsWith(current)&&!/[\r\n\0]/.test(v)).sort();
 const currentGlobal=current.match(/^--([^=]+)=(.*)$/s);
 if(currentGlobal&&Object.hasOwn(globalOptions,currentGlobal[1]))return filter((globalOptions[currentGlobal[1]].enum||[]).map(v=>'--'+currentGlobal[1]+'='+v));
 if(pendingGlobal)return filter(globalOptions[pendingGlobal].enum||[]);
 const globals=Object.keys(globalOptions).map(k=>'--'+k);
 if(tokens[0]==='completion')return filter(['bash','zsh','fish']);
 if(tokens[0]==='schema'||tokens[0]==='api'&&tokens.length===1)return filter(schema.commands.map(c=>c.method));
 if(tokens[0]==='api')return filter(['--data','--text',...globals]);
 if(tokens[0]==='import')return filter(['--to','--password',...globals]);
 if(tokens[0]==='serve')return filter(['--port',...globals]);
 if(tokens[0]==='tui')return filter(globals);
 let path=tokens[0]==='help'?tokens.slice(1):tokens;
 const defs=[...definitions,...Object.entries(legacy).map(([name,[method,positionals]])=>({name,method,positionals,command:schema.commands.find(c=>c.method===method)}))];
 const def=defs.filter(d=>d.name.split(' ').every((part,i)=>path[i]===part)).sort((a,b)=>b.name.split(' ').length-a.name.split(' ').length)[0];
 if(!def){
  if(current.startsWith('--'))return filter(globals);
  if(!path.length&&current.includes('.'))return filter(schema.commands.map(c=>c.method));
  const children=defs.filter(d=>!d.name.includes('.')&&path.every((part,i)=>d.name.split(' ')[i]===part)).map(d=>d.name.split(' ')[path.length]).filter(Boolean);
  return filter(path.length?children:[...children,...utilities]);
 }
 const rules=Object.fromEntries(Object.entries(def.command.options||{}).map(([k,r])=>['--'+kebab(k),r]));
 const rest=path.slice(def.name.split(' ').length),used=new Set();
 let pending=null,ended=false,positionalCount=0;
 for(let i=0;i<rest.length;i++){
  const token=rest[i];if(token==='--'){ended=true;continue;}
  const [flag,...inline]=token.split('=');
  if(!ended&&Object.hasOwn(rules,flag)){
   used.add(flag);const rule=rules[flag];
   if(!inline.length){
    if(rule.type==='boolean'){if(['true','false'].includes(rest[i+1]))i++;else if(i===rest.length-1)pending=flag;}
    else if(i===rest.length-1)pending=flag;else i++;
   }
  }else if(!token.startsWith('--'))positionalCount++;
 }
 if(ended)return [];
 const equal=current.indexOf('=');
 if(equal>=0){const flag=current.slice(0,equal),rule=rules[flag]||globalOptions[flag.slice(2)];return filter((rule?.enum|| (rule?.type==='boolean'?['true','false']:[])).map(v=>flag+'='+v));}
 if(pending&&!current.startsWith('--')){const rule=rules[pending];return filter(rule.enum||(rule.type==='boolean'?['true','false']:[]));}
 const positionalRule=def.command.options?.[def.positionals[positionalCount]];
 if(!current.startsWith('--')&&positionalRule?.enum)return filter(positionalRule.enum);
 const supplied=new Set(def.positionals.slice(0,positionalCount).map(k=>'--'+kebab(k)));
 return filter([...Object.keys(rules).filter(k=>!used.has(k)&&!supplied.has(k)),...globals]);
}
function completion(shell){
 assert(['bash','zsh','fish'].includes(shell),'INVALID_PARAMS','completion requires bash, zsh or fish');
 // Shells pass words as arguments; candidates only returns schema/command identifiers and enum values.
 if(shell==='bash')return '_margin_reader_complete() {\n  local candidate\n  COMPREPLY=()\n  while IFS= read -r candidate; do\n    [[ -n "$candidate" ]] && COMPREPLY+=("$candidate")\n  done < <(margin-reader _complete "${COMP_WORDS[@]:1:COMP_CWORD}")\n}\ncomplete -F _margin_reader_complete margin-reader\n';
 if(shell==='zsh')return '#compdef margin-reader\n_margin_reader_complete() {\n  local -a suggestions\n  suggestions=("${(@f)$(margin-reader _complete "${words[@]:1:$((CURRENT-1))}")}")\n  compadd -- "${suggestions[@]}"\n}\ncompdef _margin_reader_complete margin-reader\n';
 return "complete -c margin-reader -f -a '(margin-reader _complete (commandline -opc)[2..-1] (commandline -ct))'\n";
}
module.exports={completion,candidates};
