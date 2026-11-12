import assert from 'node:assert/strict'
import {engineeringOrder} from '../src/shared/engineering.ts'
import {exportEngineeringMermaid,parseEngineeringMermaid,mergeEngineeringGraph} from '../src/shared/engineering-mermaid.ts'
const spec={name:'Graph',goal:'Verify graph interoperability',team:'T',roles:[{key:'end',title:'Governor "quoted" #quot; <plain> C:\\new\\',rank:'governor'},{key:'m',title:'Manager',rank:'manager',parent:'end'},{key:'e',title:'Actual employee name',rank:'employee',parent:'m'}],tasks:[{key:'e',title:'Different task "title"\nnext\tline',prompt:'Actual work\n"quoted" instructions',acceptance:'Real checks'}],dependencies:[],collaboration:[{from:'e',to:'m',requirement:'Exact | pipe\nsecond line'}]}
engineeringOrder(spec)
for(const graph of ['topology','dag']){
 const source=exportEngineeringMermaid(spec,graph),parsed=parseEngineeringMermaid(source,graph),merged={...spec,...mergeEngineeringGraph(spec,graph,parsed)}
 assert.deepEqual(merged,spec);assert.match(source,/n_end|n_e/);assert.ok(!source.includes('Different task \\"'))
}
const path='C:'+String.fromCharCode(92)+'new'+String.fromCharCode(92);assert.equal(parseEngineeringMermaid('flowchart LR\ne["'+path+'"]:::employee','dag').tasks[0].title,path)
const long='a'.repeat(64),large={...spec,roles:spec.roles.map(role=>role.key==='e'?{...role,key:long}:role),tasks:[{...spec.tasks[0],key:long,prompt:'Long but valid text\n'.repeat(15000)}],collaboration:[]};assert.equal(mergeEngineeringGraph(large,'dag',parseEngineeringMermaid(exportEngineeringMermaid(large,'dag'),'dag')).tasks[0].prompt,large.tasks[0].prompt)
assert.throws(()=>parseEngineeringMermaid('flowchart TD\nx["Unranked"]','topology'),/Specify/);assert.throws(()=>parseEngineeringMermaid('flowchart LR\na["A"]:::employee\na --> missing','dag'),/Declare both/)
console.log('PASS valid Mermaid entity escaping, reserved/64-character keys, Windows paths, exact multiline metadata, large prompts and role/task-name-preserving round trips')
