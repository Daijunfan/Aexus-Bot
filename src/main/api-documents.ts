import {fileVersion,readSourceText} from './read-cache'
import fs from 'node:fs'
import path from 'node:path'
import {APP_HOME} from '../shared/protocol'
import {applicationRoot} from './resources'
import {listPlugins,pluginFile} from './plugins/registry'

const coreDocuments=[
 ['core/agent-context','docs/AGENT_CONTEXT.md'],
 ['core/api','API.md'],['core/permissions','PERMISSIONS.md'],['core/plan','PLAN.md'],
 ['core/avatars','docs/AVATARS.md'],['core/missions','docs/MISSIONS_AND_QUESTIONS.md'],
 ['core/engineering','docs/ENGINEERING.md'],
 ['core/scheduler','SCHEDULER.md'],['core/architecture','ARCHITECTURE.md'],
 ['core/conversation-workspaces','docs/CONVERSATION_WORKSPACES.md'],
 ['core/magazine-reading','docs/MAGAZINE_READING.md'],
 ['core/conversation-controls','docs/CONVERSATION_CONTROLS.md'],
 ['core/group-collaboration','docs/GROUP_COLLABORATION.md'],
 ['core/message-collaboration','docs/MESSAGE_COLLABORATION.md'],
 ['core/bot-workers','docs/BOT_WORKERS.md'],['core/event-tasks','docs/EVENT_TASKS.md'],
 ['core/channels','docs/CHANNELS.md'],['core/channel-filters','docs/CHANNEL_FILTERS.md'],
 ['core/secretary-api','docs/SECRETARY_API_PARITY.md']
] as const

type DocumentEntry={file:string;text:string}
type Catalog={root:string;documents:Map<string,DocumentEntry>;methods:Map<string,unknown>}
let cached:(Catalog&{sourceVersion:string;projectionVersion:string})|undefined
const projectionVersion=(catalog:Catalog)=>JSON.stringify([...catalog.documents.values()].map(entry=>fileVersion(path.join(catalog.root,entry.file))))

/** Public reference material only. Reading a document never grants execution authority. */
function materialize(){
 const root=path.join(APP_HOME,'api-docs'),source=applicationRoot(),plugins=listPlugins()
 const inputs=[...coreDocuments.map(([,file])=>path.join(source,file)),...plugins.flatMap(plugin=>[pluginFile(plugin.directory,plugin.documentation),pluginFile(plugin.directory,plugin.schema)])]
 const sourceVersion=JSON.stringify([source,plugins,inputs.map(fileVersion)])
 if(cached?.root===root&&cached.sourceVersion===sourceVersion&&cached.projectionVersion===projectionVersion(cached))return cached
 const documents=new Map<string,DocumentEntry>(),methods=new Map<string,unknown>()
 for(const [id,file] of coreDocuments)documents.set(id,{file:path.join('core',file),text:readSourceText(path.join(source,file))})
 for(const plugin of plugins){
  const prefix='plugin/'+plugin.id+'/',directory=path.join('plugins',plugin.id),schema=readSourceText(pluginFile(plugin.directory,plugin.schema))
  documents.set(prefix+'api',{file:path.join(directory,'API.md'),text:readSourceText(pluginFile(plugin.directory,plugin.documentation))})
  documents.set(prefix+'schema',{file:path.join(directory,'schema.json'),text:schema})
  const commands=JSON.parse(schema).commands as {method:string;description:string}[]
  for(const command of commands)methods.set(prefix+'command/'+command.method,command)
  documents.set(prefix+'index',{file:path.join(directory,'README.md'),text:[
   '# '+plugin.name+' API 方法索引 ('+plugin.version+')','',
   '先选择方法，再用 `agents api docs '+prefix+'command/METHOD` 读取该方法的完整真实 schema（参数、说明与示例）；不必加载整册 API。读取文档不授予操作权限。','',
   ...commands.map(command=>'- `'+command.method+'` — '+command.description.replace(/\s+/g,' ').slice(0,160)), '',
   '完整参考：[API](API.md) / [schema](schema.json)。',''
  ].join('\n')})
 }
 documents.set('index',{file:'README.md',text:[
  '# Aexus Bot API 文档索引','',
  '初始化只读 identity 和本索引。后续按当前任务选择一个文档或方法，不重复加载整册。身份和权限以 Core 实时校验为准。','',
  '| 视图 | 内容 | Core API |','| --- | --- | --- |',
  '| Team | 员工、原生会话、工作区 | `card.*`、`session.*`、`workspace.*` |',
  '| Message | 私聊、群组、外部 Worker、只读资讯 | `direct.*`、`chat.*`、`bot.*`、`channel.*` |',
  '| Mission | 持续目标、排期与提醒 | `mission.*`、`plan.*`、`schedule.*` |','',
  'MiniNotion 等插件独立于 Core 任务。先用 `plugin.resources` 发现本人获授权内容，再查插件方法。','',
  '查询入口：`api.list {prefix}` 缩小命令范围；`describe` 仅查询 Core 命令 schema，插件方法用 `document`；`document` 按下列 ID 读取。插件用 `plugin/ID/index`，再读 `plugin/ID/command/METHOD`。`--all` 只扩展公开文档，不增加执行权。','',
  '## Core 文档','',
  ...coreDocuments.map(([id])=>'- `'+id+'`'),'',
  '消息来源、回复位置、身份更新与固定规则见 `core/agent-context`；Mission 先用 `plan.query` 获取真实 ID 和 allowedActions；外刊图文与 PDF 页图见 `core/magazine-reading`。','',
  '## 已安装插件','',
  ...plugins.map(plugin=>'- **'+plugin.name+'** (`'+plugin.id+'`, '+plugin.version+') — `plugin/'+plugin.id+'/index`'),
  ...(plugins.length?[]:['当前没有已安装插件。']),''
 ].join('\n')})
 for(const {file,text} of documents.values()){
  const target=path.join(root,file)
  fs.mkdirSync(path.dirname(target),{recursive:true})
  if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('Cannot replace an API document symlink')
  if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')===text)continue
  const temporary=target+'.tmp';fs.writeFileSync(temporary,text);fs.renameSync(temporary,target)
 }
 const catalog={root,documents,methods}
 cached={...catalog,sourceVersion,projectionVersion:projectionVersion(catalog)}
 return cached
}

export function ensureApiDocuments():string{return materialize().root}

export function readApiDocument(document='index'){
 const {root,documents,methods}=materialize()
 let entry=documents.get(document)
 const single=document.match(/^plugin\/([^/]+)\/command\/(.+)$/)
 if(!entry&&single){
  const schema=documents.get('plugin/'+single[1]+'/schema')
  if(schema){
   const command=methods.get(document)
   if(!command)throw Error('Unknown plugin command: '+single[1]+'/'+single[2])
   entry={file:schema.file,text:JSON.stringify(command,null,2)+'\n'}
  }
 }
 if(!entry)throw Error('Unknown API document: '+document)
 return {markdown:entry.text,document,path:path.join(root,entry.file),catalogRoot:root}
}
