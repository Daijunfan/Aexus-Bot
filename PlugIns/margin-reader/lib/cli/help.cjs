'use strict';
const {schema,kebab,definitions}=require('./commands.cjs');
const {assert}=require('../safety.cjs');
const unique=definitions.filter(d=>!d.name.includes('.'));
function listing(query=''){
 const q=query.toLowerCase();
 return unique.filter(d=>(d.name+' '+d.method+' '+d.command.description).toLowerCase().includes(q)).map(d=>d.name+' → '+d.method+'\n  '+d.command.description).join('\n')+'\n';
}
function exampleValue(key,rule){
 if(rule.enum)return rule.enum[0];
 if(rule.nullable&&key.toLowerCase().includes('parent'))return null;
 if(rule.type==='boolean')return true;
 if(rule.type==='number')return rule.minimum??1;
 if(rule.type==='array')return key==='paths'?['lesson.md']:key==='setIds'?['STUDY_ID']:[];
 if(rule.type==='object')return key==='locator'?{section:0}:{};
 return ({path:'lesson.md',title:'学习笔记',text:'Hello',color:'yellow',captureId:'00000000-0000-4000-8000-000000000001'})[key]||key.toUpperCase();
}
const quote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
function methodHelp(name){
 const d=definitions.find(d=>d.name===name||d.method===name);
 if(!d)return null;
 const rules=d.command.options||{};
 const lines=[d.name+' → '+d.method,d.command.description,'','Usage: margin-reader --workspace DIR '+d.name+' '+d.positionals.map(k=>'<'+k+'>').join(' ')+' [options]',''];
 for(const [key,rule] of Object.entries(rules))lines.push('  --'+kebab(key)+' <'+rule.type+(rule.nullable?'|null':'')+'> '+(rule.required?'(required) ':'')+rule.description+(rule.enum?' Choices: '+rule.enum.join(', '):''));
 const examples=d.command.examples||[];
 if(d.kind==='map-render'){lines.push('','Example:','  margin-reader --workspace "$MR_WORKSPACE" map render --set-id "$SET_ID" --columns 120 --rows 36 --output text','Read-only adapter; no map.render runtime method is introduced. Default output wraps the snapshot in a JSON-RPC envelope.');}
 else
 if(examples.length){
  lines.push('','Schema example parameters (replace identities/versions for your workspace):');
  for(const sample of examples)lines.push('  margin-reader --workspace "$MR_WORKSPACE" api '+d.method+' --data '+quote(JSON.stringify(sample)));
 }else{
  const sample=Object.fromEntries(Object.entries(rules).filter(([,r])=>r.required).map(([k,r])=>[k,exampleValue(k,r)]));
  lines.push('','Parameter skeleton only — NOT a valid request until completed with real IDs, versions, array members and nested fields:',
   '  margin-reader --workspace "$MR_WORKSPACE" api '+d.method+' --data '+quote(JSON.stringify(sample)));
 }
 if(d.defaults)lines.push('','Alias defaults: '+JSON.stringify(d.defaults)+'; explicit flags override these defaults.');
 lines.push( '','JSON/@file/- is accepted for object and array values. Strings remain literal.',
 'Versions are explicit; conflicts and uncertain mailbox completion are never retried.',
 'Output: --output json|pretty|text; default JSON-RPC. See docs/CLI_REFERENCE.md.');
 return lines.join('\n')+'\n';
}
function help(name=''){
 if(name==='tui')return [
  'tui — local keyboard-driven reading and knowledge workspace',
  'Read, select excerpts, follow sources, organize cards and review through the public runtime.',
  '',
  'Usage: margin-reader --workspace DIR tui',
  'Help: margin-reader tui --help | margin-reader --help tui | margin-reader help tui',
  '',
  'Requires interactive TTY input and output, with TERM other than dumb.',
  'Redirected startup exits 1 with TTY_REQUIRED before opening Core. Use ordinary CLI commands in pipelines.',
  'This help needs no workspace and does not initialize Core or enter terminal mode.',
  '',
  'Main keys (outside a text input):',
  '  Tab / Shift-Tab   switch pane; arrows navigate; Enter confirms; ? opens full help',
  '  /                 search the current document, library or knowledge cards',
  '  S                 choose or create a study',
  '  v, then move, c   select text and preview an excerpt; Enter confirms the capture',
  '  o, then Esc      open the selected card source and return to its context',
  '  g                 toggle spatial map; u / U undo / redo study changes',
  '  e / Space         edit the selected knowledge/map card title (Space reveals in review)',
  '  a, then R        enable the selected card for review and open a review session',
  '  Space, then 1–4  reveal the answer, then grade Again / Hard / Good / Easy',
  '  q                 exit with draft confirmation; Ctrl-C exits immediately',
  '',
  'In full-screen map/review, Tab or Shift-Tab returns to visible panes; camera/session are retained.',
  'Text input: Enter saves; Ctrl-J inserts a newline; bracketed paste stays in the draft.',
  'Esc retains cancelled text drafts in memory; ! opens recovery. Drafts do not survive process exit.',
  'See docs/TERMINAL_WORKSPACE.md for all contexts, terminal requirements and complete learning flow.',
 ].join('\n')+'\n';
 if(name){const text=methodHelp(name);if(text)return text;const group=unique.filter(d=>d.name===name||d.name.startsWith(name+' '));assert(group.length,'METHOD_NOT_FOUND','Unknown help topic: '+name);return group.map(d=>d.name+' → '+d.method+'\n  '+d.command.description).join('\n')+'\n';}
 return 'Margin Reader '+schema.version+'\n\nUsage: margin-reader --workspace DIR <command> [options]\n\n'+
 'Discovery (no workspace or Core initialization):\n  commands [keyword]\n  help [group|method|command words]\n  schema [METHOD]\n  completion bash|zsh|fish\n  --version\n\n'+
 'Workflow:\n  document open PATH\n  study create TITLE\n  study add SET_ID --expected-revision N --paths JSON\n  card create SET_ID [source/version/locator options]\n  card note SET_ID TITLE --expected-revision N\n  map show SET_ID --output text\n  map render --set-id SET_ID --columns 120 --rows 36 --output text\n  review configure SET_ID CARD_ID --expected-revision N --enabled\n  review queue SET_ID\n  card source SET_ID CARD_ID\n  study export SET_ID PATH\n  xmind inspect PATH\n  tui (interactive terminal workspace; help tui for keys)\n\n'+
 'All schema methods: use dot.method names or namespace words (help study card create).\nLegacy: api METHOD --data JSON|@file|-; import FILE --to PATH; open/list/tree/mkdir/url/search/read/link; serve; tui.\nDefault output is JSON-RPC; --json is explicit JSON; --output pretty|text opts in.\n';
}
module.exports={help,listing,methodHelp,unique};
