import type {EngineeringSpec,EngineeringRoleSpec,EngineeringTaskSpec,EngineeringDependency} from './engineering'

type Graph='topology'|'dag'
const label=(value:string)=>'"'+value.replaceAll('#','#35;').replaceAll('&','#38;').replaceAll('"','#quot;').replaceAll('\\','#92;').replaceAll('<','#60;').replaceAll('>','#62;').replace(/[\u0000-\u001f]/g,char=>'#'+char.charCodeAt(0)+';')+'"'
const labelText=(value:string)=>value.replace(/#(quot|amp|lt|gt|\d+);/g,(whole,entity)=>({quot:'"',amp:'&',lt:'<',gt:'>'} as Record<string,string>)[entity]??(Number(entity)<=0x10ffff?String.fromCodePoint(Number(entity)):whole))
/** Deliberately documented Mermaid flowchart syntax, never executable source or HTML. */
export function parseEngineeringMermaid(source:string,graph:Graph){
 const nodes=new Map<string,{title:string;rank?:string}>(),metadata=new Map<string,Record<string,any>>(),edgeMetadata=new Map<string,{requirement:string}>(),edges:Array<EngineeringDependency&{collaboration?:boolean}>=[]
 const key='[A-Za-z][A-Za-z0-9_-]{0,65}',declaration=new RegExp('('+key+')\\s*\\[\\s*("[^"]*")\\s*\\](?:\\s*:::\\s*('+key+'))?','g')
 let header=false
 for(const [index,raw] of source.split(/\r?\n/).entries()){
  let line=raw.trim().replace(/;$/,'').trim();if(!line)continue
  const meta=line.match(/^%%\s*@node\s+(\S+)\s+(\{.*\})$/)
  if(meta){if(!new RegExp('^'+key+'$').test(meta[1])||metadata.has(meta[1]))throw Error('Invalid/duplicate @node metadata on line '+(index+1));const value=JSON.parse(meta[2]);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Node metadata must be an object');metadata.set(meta[1],value);continue}
  const edgeMeta=line.match(/^%%\s*@edge\s+(\S+)\s+(\S+)\s+(\{.*\})$/)
  if(edgeMeta){const pair=edgeMeta[1]+'>'+edgeMeta[2],value=JSON.parse(edgeMeta[3]);if(edgeMetadata.has(pair)||typeof value.requirement!=='string'||Object.keys(value).some(key=>key!=='requirement'))throw Error('Invalid edge metadata on line '+(index+1));edgeMetadata.set(pair,value);continue}
  if(line.startsWith('%%'))continue
  if(/^(?:flowchart|graph)\s+(?:TD|TB|LR)$/.test(line)){if(header)throw Error('Use one flowchart per graph');header=true;continue}
  if(!header)throw Error('Start with flowchart '+(graph==='topology'?'TD':'LR'))
  line=line.replace(declaration,(_match,id,label,rank)=>{if(nodes.has(id))throw Error('Node declared twice: '+id);nodes.set(id,{title:labelText(label.slice(1,-1)),rank});return id})
  if(new RegExp('^'+key+'$').test(line))continue
  const tokens=line.split(/\s*(-->|-\.->)(?:\|([^|]*)\|)?\s*/)
  if(tokens.length<4||!new RegExp('^'+key+'$').test(tokens[0]))throw Error('Unsupported Mermaid on line '+(index+1)+'. Use id["Title"]:::rank and A -->|handoff| B or A -.-> B.')
  let from=tokens[0]
  for(let i=1;i<tokens.length;i+=3){const arrow=tokens[i],requirement=tokens[i+1],to=tokens[i+2];if(!new RegExp('^'+key+'$').test(to??''))throw Error('Invalid edge on line '+(index+1));edges.push({from,to,...(requirement?{requirement}:{}),...(arrow==='-.->'?{collaboration:true}:{})});from=to}
 }
 if(!nodes.size)throw Error('Declare at least one node')
 for(const edge of edges)if(!nodes.has(edge.from)||!nodes.has(edge.to))throw Error('Declare both endpoints of '+edge.from+' -> '+edge.to)
 for(const id of metadata.keys())if(!nodes.has(id))throw Error('Metadata has no node: '+id)
 for(const [pair,value] of edgeMetadata){const edge=edges.find(edge=>edge.from+'>'+edge.to===pair);if(!edge)throw Error('Metadata has no connection: '+pair);edge.requirement=value.requirement}
 const names=new Map([...nodes.keys()].map(id=>[id,metadata.get(id)?.key??id]));if(new Set(names.values()).size!==nodes.size||[...names.values()].some(key=>typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)))throw Error('Canonical graph keys must be unique letters/numbers/underscores/hyphens, up to 64 characters')
 for(const edge of edges){edge.from=names.get(edge.from)!;edge.to=names.get(edge.to)!}
 if(graph==='topology'){
  const roles:EngineeringRoleSpec[]=[...nodes].map(([key,node])=>{
   if(!['governor','manager','employee'].includes(node.rank??''))throw Error('Specify :::governor, :::manager or :::employee for '+key)
   const canonical=names.get(key)!,parents=edges.filter(edge=>!edge.collaboration&&edge.to===canonical);if(parents.length>1)throw Error('Each role has exactly one direct manager: '+canonical)
   const meta=metadata.get(key)??{}
   for(const name of Object.keys(meta))if(!['key','employeeId','engine','model','checkSeconds','position'].includes(name))throw Error('Unknown role metadata: '+name)
   return {...meta,key:canonical,title:node.title,rank:node.rank as EngineeringRoleSpec['rank'],...(parents[0]?{parent:parents[0].from}:{})}
  })
  return {roles,collaboration:edges.filter(edge=>edge.collaboration).map(({collaboration,...edge})=>edge)}
 }
 if(edges.some(edge=>edge.collaboration))throw Error('DAG dependencies use -->; collaboration belongs to Topology')
 const employeeRoles:EngineeringRoleSpec[]=[],tasks:EngineeringTaskSpec[]=[...nodes].map(([key,node])=>{if(node.rank&&node.rank!=='employee')throw Error('DAG nodes are Employees');const meta=metadata.get(key)??{},canonical=names.get(key)!;for(const name of Object.keys(meta))if(!['key','prompt','acceptance','position','role'].includes(name))throw Error('Unknown task metadata: '+name);const {role,...task}=meta;if(role){if(typeof role!=='object'||Array.isArray(role)||Object.keys(role).some(key=>!['parent','employeeId','engine','model'].includes(key)))throw Error('Task role metadata accepts parent, employeeId, engine and model');employeeRoles.push({...role,key:canonical,title:node.title,rank:'employee'})}return {prompt:node.title,acceptance:'Deliver the requested result and verify it with concrete evidence.',...task,key:canonical,title:node.title}})
 return {tasks,dependencies:edges.map(({collaboration,...edge})=>edge),employeeRoles}
}
export function mergeEngineeringGraph(spec:EngineeringSpec,graph:Graph,parsed:ReturnType<typeof parseEngineeringMermaid>):Partial<EngineeringSpec>{
 if(graph==='topology'){
  if(!('roles' in parsed)||!parsed.roles)throw Error('Expected a Topology document')
  const roles=parsed.roles.map(role=>({...spec.roles.find(existing=>existing.key===role.key),...role})),keys=new Set(roles.filter(role=>role.rank==='employee').map(role=>role.key))
  return {roles,collaboration:parsed.collaboration,tasks:roles.filter(role=>role.rank==='employee').map(role=>spec.tasks.find(task=>task.key===role.key)??{key:role.key,title:role.title,prompt:role.title,acceptance:'Deliver and verify the requested result.'}),dependencies:spec.dependencies.filter(edge=>keys.has(edge.from)&&keys.has(edge.to))}
 }
 if(!('tasks' in parsed)||!parsed.tasks)throw Error('Expected a DAG document')
 const roles=[...spec.roles.filter(role=>role.rank!=='employee'),...parsed.tasks.map(task=>{const existing=spec.roles.find(role=>role.key===task.key&&role.rank==='employee'),hint=parsed.employeeRoles?.find(role=>role.key===task.key);if(!existing&&!hint?.parent)throw Error('New Employee '+task.key+' needs @node metadata with role.parent (its Manager key)');return {...existing,...hint,key:task.key,title:existing?.title??hint?.title??task.title,rank:'employee' as const}})]
 return {roles,tasks:parsed.tasks,dependencies:parsed.dependencies}
}
export function exportEngineeringMermaid(spec:EngineeringSpec,graph:Graph){
 const lines=['flowchart '+(graph==='topology'?'TD':'LR')]
 if(graph==='topology'){
  for(const role of spec.roles){const {key,title,rank,parent,...meta}=role;const allowed=Object.fromEntries(Object.entries(meta).filter(([name])=>['employeeId','engine','model','checkSeconds','position'].includes(name)));lines.push('  %% @node n_'+key+' '+JSON.stringify({key,...allowed}),'  n_'+key+'['+label(title)+']:::'+rank)}
  for(const role of spec.roles)if(role.parent)lines.push('  n_'+role.parent+' --> n_'+role.key)
  for(const edge of spec.collaboration??[]){if(edge.requirement)lines.push('  %% @edge n_'+edge.from+' n_'+edge.to+' '+JSON.stringify({requirement:edge.requirement}));lines.push('  n_'+edge.from+' -.-> n_'+edge.to)}
 }else{
  for(const task of spec.tasks){const {key,title,...meta}=task,role=spec.roles.find(role=>role.key===key);lines.push('  %% @node n_'+key+' '+JSON.stringify({key,...meta,role:role?{parent:role.parent,employeeId:role.employeeId,engine:role.engine,model:role.model}:undefined}),'  n_'+key+'['+label(title)+']:::employee')}
  for(const edge of spec.dependencies){if(edge.requirement)lines.push('  %% @edge n_'+edge.from+' n_'+edge.to+' '+JSON.stringify({requirement:edge.requirement}));lines.push('  n_'+edge.from+' --> n_'+edge.to)}
 }
 return lines.join('\n')+'\n'
}
