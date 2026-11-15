// Check public documentation targets against the Git checkout, without network or runtime state.
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {unified} from 'unified'
import remarkParse from 'remark-parse'

const root=path.resolve(import.meta.dirname,'..')
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
const versioned=new Set(tracked),documents=tracked.filter(file=>file.endsWith('.md')&&(!file.includes('/')||file.startsWith('docs/')))
const parser=unified().use(remarkParse),failures=[]
let checked=0
for(const file of documents){
 const validate=(url,line)=>{
  if(!url||url.startsWith('#')||/^[a-z][\w+.-]*:/i.test(url)||url.startsWith('//'))return
  const target=path.resolve(root,path.dirname(file),decodeURIComponent(url.split(/[?#]/,1)[0]))
  const relative=path.relative(root,target).split(path.sep).join('/')
  checked++
  const present=fs.existsSync(target),publicTarget=versioned.has(relative)||present&&fs.statSync(target).isDirectory()&&tracked.some(item=>item.startsWith(relative+'/'))
  if(!present||!publicTarget)failures.push({file,line,url,reason:present?'target is not versioned':'target does not exist'})
 }
 const visit=node=>{
  if(['link','image','definition'].includes(node.type))validate(node.url,node.position.start.line)
  if(node.type==='html')for(const match of node.value.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi))validate(match[1],node.position.start.line)
  for(const child of node.children??[])visit(child)
 }
 visit(parser.parse(fs.readFileSync(path.join(root,file),'utf8')))
}
for(const failure of failures)console.error(`${failure.file}:${failure.line} ${failure.url}: ${failure.reason}`)
console.log(`Public documentation: ${documents.length} files, ${checked} local targets, ${failures.length} broken or unversioned targets`)
if(failures.length)process.exitCode=1
