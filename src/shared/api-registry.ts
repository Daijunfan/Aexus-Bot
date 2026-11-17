import {WORKSPACE_PDF_COMMANDS} from './workspace-pdf.ts'
import {GROUP_COLLABORATION_COMMANDS} from './group-collaboration.ts'
import {PLAN_PREFERENCE_COMMANDS} from './plan-preferences.ts'
import {MISSION_COMMANDS} from './missions.ts'
import {ENGINEERING_COMMANDS} from './engineering.ts'
import {QUESTION_COMMANDS} from './chat-questions.ts'
import {MONITOR_COMMANDS} from './script-monitors.ts'
import {BOT_COMMANDS} from './bot-workers.ts'
import {BOT_MANAGEMENT_COMMANDS} from './bot-management.ts'
import {MESSAGE_COLLABORATION_COMMANDS} from './message-collaboration.ts'
import {CONVERSATION_CONTROL_COMMANDS} from './conversation-control-schema.ts'
import {ASSET_COMMANDS} from './asset-schema.ts'
import {SOURCE_VIEW_SCHEMA} from './message-source.ts'
import {READ_ONLY_APIS,RETIRED_APIS} from './api-effects.ts'
import {booleanSchema,nonemptySchema,objectSchema,textSchema} from './api-schema.ts'
import type {CliSpec} from './cli-contract'
import {QUOTE_SCHEMA} from './message-quotes.ts'
import {STORAGE_FOLDER_SCHEMA} from './storage-folder.ts'
import {CONVERSATION_WORKSPACE_COMMANDS} from './conversation-workspaces.ts'
import {MESSENGER_COMMANDS} from './messenger.ts'
import {PLAN_COMMANDS} from './plan-schema.ts'
import {CHANNEL_COMMANDS} from './channel-schema.ts'
import {SCHEDULE_SPEC_SCHEMA} from './schedule-schema.ts'
import {PREFERENCES_PATCH_SCHEMA} from './preferences.ts'
import {WORKER_COMMANDS} from './native-worker.ts'
import {DIRECT_COMMANDS} from './direct-messages.ts'
import {CONVERSATION_FILE_COMMANDS} from './conversation-files.ts'
import {NOTEBOOK_COMMANDS} from './notebook-api.ts'
import {LIBRARY_COMMANDS} from './library-api.ts'
import {PERMISSION_MODES} from './types.ts'
const sessionMessageSchema={type:'object',additionalProperties:false,properties:{id:textSchema,employee:textSchema,text:textSchema,images:{type:'array',items:textSchema},files:{type:'array',items:textSchema},sourceView:SOURCE_VIEW_SCHEMA,clientMessageId:{type:'string',minLength:1,maxLength:160,description:'Optional stable identity for a regular message (not a slash command), shared by send and enqueue for the same authenticated sender and employee. Reuse unchanged attempts after transport loss; never automatically replay uncertain work.'},replyTo:{type:'string',minLength:1,description:'Public message ID in the destination or explicit source conversation; Core resolves the excerpt'},replyQuote:QUOTE_SCHEMA,replyConversation:textSchema,replyTextOnly:booleanSchema},anyOf:[{required:['id']},{required:['employee']}]}
/** Every command the CLI can send. Kept as data so `agents help` can list it. */
const DEFINITIONS: {
  name: string
  args: string
  summary: string
  gui: string
  cli?:CliSpec
  inputSchema?:Record<string,unknown>
}[] = [
  ...ENGINEERING_COMMANDS,...MISSION_COMMANDS,...QUESTION_COMMANDS,...PLAN_PREFERENCE_COMMANDS,
  ...NOTEBOOK_COMMANDS,
  ...LIBRARY_COMMANDS,
  ...PLAN_COMMANDS,
  ...WORKER_COMMANDS,
  ...DIRECT_COMMANDS,...BOT_COMMANDS,...BOT_MANAGEMENT_COMMANDS,...MONITOR_COMMANDS,
  ...CHANNEL_COMMANDS,
  ...MESSENGER_COMMANDS,
  ...ASSET_COMMANDS,
  ...CONVERSATION_WORKSPACE_COMMANDS,
  ...CONVERSATION_FILE_COMMANDS,...WORKSPACE_PDF_COMMANDS,
  ...CONVERSATION_CONTROL_COMMANDS,
  ...GROUP_COLLABORATION_COMMANDS,
  ...MESSAGE_COLLABORATION_COMMANDS,
  {name:'card.profile',args:'ID [--offset N] [--limit N]',summary:'Read employee identity, authorized memberships, named workspaces and paged Plan tasks without opening an engine or changing read receipts',gui:'Employee profile',cli:{positionals:['id']},inputSchema:objectSchema({id:nonemptySchema,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['id'])},
  {cli:[],"name": "view.list", "args": "", "summary": "List application views and their shared data contracts", "gui": "Shared views / group conversations", "inputSchema": objectSchema({},[])},
  {name:'view.navigation',args:'mission|plan [--expanded true|false]',summary:'Legacy navigation compatibility. Mission opens directly; disclosure requests leave the current view unchanged.',gui:'Primary navigation compatibility',cli:{positionals:['section'],booleanValues:['expanded']},inputSchema:objectSchema({section:{enum:['mission','plan']},expanded:{...booleanSchema,description:'Deprecated compatibility input; Mission has no expandable navigation.'}},['section'])},
  {"name": "view.select", "args": "library|messages|plan", "summary": "Switch between Library, Message and Mission directly.", "gui": "Main views", "inputSchema": objectSchema({"id": {"type": "string", "enum": ["library", "messages", "plan"]}, missionTab:{enum:["plan"],description:"Deprecated compatibility alias; Mission has no child destinations."},toggleNavigation:{type:"boolean",description:"Deprecated compatibility intent. Main view selections are idempotent and never expand navigation."}},["id"])},
  {cli:{},"name": "chat.list", "args": "", "summary": "List groups for the current authenticated member", "gui": "Shared views / group conversations", "inputSchema": objectSchema({},[])},
  {cli:{},"name": "chat.create", "args": "--name NAME [--members JSON] [--owner-id ID] [--storage JSON] [--client-request-id ID]", "summary": "Create a group with an Agent Owner. User/Secretary can choose local or registered-host storage, create a custom named folder or bind an existing folder; employees keep their centralized cwd. Stable clientRequestId retries the same caller-owned creation", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"name": {"type": "string", "minLength": 1, "maxLength": 80}, "ownerId": nonemptySchema, "clientRequestId": {type:"string",minLength:1,maxLength:160}, storage:STORAGE_FOLDER_SCHEMA, "members": {"type": "array", "items": nonemptySchema, "maxItems": 200}},["name"])},
  {"name": "chat.update", "args": "ID --patch JSON", "summary": "Conversation Owner/Admin: edit group name and membership; Aexus role does not confer access", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema, "name": {"type": "string", "minLength": 1, "maxLength": 80}, "members": {"type": "array", "items": nonemptySchema, "maxItems": 200}, "expectedRevision": {"type": "integer", "minimum": 1}},["id"])},
  {cli:{"positionals":["id"],"rawPositionals":true},"name": "chat.delete", "args": "ID", "summary": "Conversation Owner (or the human user) removes a group; Admin cannot dissolve it; employees and private history are retained", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema},["id"])},
  {"name": "chat.mute", "args": "ID --member EMPLOYEE_ID|all [--for SECONDS | --off]", "summary": "Conversation Owner/Admin: mute visible posts; Aexus rank grants no moderation; reading and work remain available", "gui": "Group member moderation", "inputSchema": objectSchema({"id": nonemptySchema, "member": {"type": "string", "minLength": 1, "description": "Employee ID in this group, or all (including future members)"}, "muted": booleanSchema, "durationSeconds": {"type": "integer", "minimum": 1, "description": "Omit for an indefinite mute; only valid when muted is true"}},["id", "member", "muted"])},
  {cli:{"positionals":["id"],"rawPositionals":true},"name": "chat.get", "args": "ID", "summary": "Read group metadata and member identities", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema,"topicId":nonemptySchema},["id"])},
  {cli:{"positionals":["id"]},"name": "chat.history", "args": "ID [--before SEQUENCE | --around MESSAGE_ID] [--topic-id ID --limit 50]", "summary": "Read published group messages with pagination", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema, "topicId": nonemptySchema, "around": nonemptySchema, "before": {"type": "integer", "minimum": 1}, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}},["id"])},
  {cli:{positionals:['id'],aliases:{messageId:'message',employeeIds:'members'}},name:'chat.retry',args:'ID --message MESSAGE_ID [--members JSON]',summary:'User/Secretary: retry only failed undelivered original recipients; no republishing, no completed/started task replay. Original content and sender remain; retry actor is reauthorized at dispatch',gui:'Message delivery recovery',inputSchema:objectSchema({id:nonemptySchema,messageId:nonemptySchema,employeeIds:{type:'array',items:nonemptySchema,minItems:1,maxItems:200,uniqueItems:true}},['id','messageId'])},
  {name:"chat.file",args:"ID --path PATH [--operation info|image|read|chunk] [--offset N]",summary:"Read a published group attachment as an authenticated member",gui:"Group attachments"},
  {cli:{"positionals":["id"],"aliases":{"messageId":"message"}},"name": "chat.context", "args": "ID [--message ID]", "summary": "Read published group context and concise reporting policy", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema, "messageId": nonemptySchema},["id"])},
  {"name": "chat.send", "args": "ID [--text TEXT] [--images JSON] [--files JSON] [--mentions JSON|all] [--client-message-id ID] [--reply-to ID] [--reply-quote JSON] [--reply-conversation REF] [--reply-text-only]", "summary": "Deliver to current members; mentions and user replies select work, other recipients receive context", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema, "topicId": nonemptySchema, "text": {"type": "string", "minLength": 0, "maxLength": 64000}, "images": {"type":"array","items":textSchema}, "files": {"type":"array","items":textSchema}, "mentions": {"oneOf": [{"type": "array", "items": nonemptySchema, "maxItems": 200}, {"const": "all"}], "description": "All current members receive the message. Mentions select work targets; user replies also address a current same-group Agent author. Employee work targets still require existing control authority."}, "clientMessageId": {"type": "string", "maxLength": 160, "description": "Stable retry key; duplicate payloads are not dispatched again"}, "replyTo": nonemptySchema, "replyQuote": QUOTE_SCHEMA, "replyConversation": textSchema, "replyTextOnly": booleanSchema},["id"])},
  {"name": "chat.edit", "args": "ID --message MESSAGE_ID --text TEXT [--file PATH] --expected-revision N", "summary": "User or Secretary: correct user-authored published group text or caption without changing accepted tasks or receipts", "gui": "Group message editing", "inputSchema": objectSchema({"id": nonemptySchema, "messageId": nonemptySchema, "text": {"type": "string", "maxLength": 64000, "description": "Already-trimmed text; empty only when the message has attachments. Does not change dispatched work."}, "expectedRevision": {"type": "integer", "minimum": 0, "description": "Current editRevision, or 0 for an unedited message. Same-text retries are idempotent."}},["id", "messageId", "text", "expectedRevision"])},
  {"name": "chat.post", "args": "ID [--text TEXT] [--images JSON] [--files JSON] [--kind summary|decision|blocker|question|result|message] [--reply-to ID] [--reply-quote JSON] [--reply-conversation REF] [--reply-text-only] [--client-message-id ID]", "summary": "Explicitly publish a group message; ordinary native output stays in the Agent conversation; private replies require direct.post", "gui": "Shared views / group conversations", "inputSchema": objectSchema({"id": nonemptySchema, "topicId": nonemptySchema, "text": {"type": "string", "minLength": 0, "maxLength": 64000, "description": "Explicit public text or attachment-only publication. Agents allow max 64000 Unicode characters; empty/null/undefined text without attachments is rejected. Use images/files with uploaded @workspace paths. Operators allow max 64000 characters. Core records reading receipts. Muted employees cannot publish."}, "images": {"type":"array","items":textSchema}, "files": {"type":"array","items":textSchema}, "kind": {"enum": ["summary", "decision", "blocker", "question", "result", "message"], "default": "summary", "description": "message is operator-only publication; every recipient receives context rather than a formal work task"}, "replyTo": nonemptySchema, "replyQuote": QUOTE_SCHEMA, "replyConversation": textSchema, "replyTextOnly": booleanSchema, "clientMessageId": {"type": "string", "maxLength": 160}},["id"])},
  {cli:{"positionals":["id"],"aliases":{"messageId":"message"}},"name": "chat.acknowledge", "args": "ID [--message ID | --message-ids JSON] [--topic-id ID --exact]", "summary": "User or Secretary: explicitly mark a topic or exact message set read; private and employee work receipts remain separate", "gui": "Shared views / group conversations", "inputSchema": {...objectSchema({"id": nonemptySchema, "topicId": nonemptySchema, "messageId": nonemptySchema,"messageIds":{type:"array",items:nonemptySchema,minItems:1,maxItems:200,uniqueItems:true},"exact":booleanSchema},["id"]),oneOf:[{required:["messageId"],not:{required:["messageIds"]}},{required:["messageIds"],not:{required:["messageId"]}}]}},
  {cli:[],"name": "system.info", "args": "", "summary": "Read Core host OS, architecture and deployment capabilities", "gui": "后端信息"},
  {"name": "system.directories", "args": "[--path PATH]", "summary": "Browse directories on the Core host (user or Secretary)", "gui": "后端目录选择"},
  {name:'engine.capabilities',args:'--engine codex|claude|cline|pi|opencode|kilo|deepseek|antigravity',summary:'Read adapter capabilities, workspace modes and employee kinds before hiring; no credentials or inference',gui:'创建员工能力检查'},
  {cli:{required:['engine']},name:'engine.providers',args:'--engine codex|claude|cline|pi|opencode|kilo|deepseek|antigravity',summary:'Read every native provider/router and saved profile with active model, URLs, credential fingerprints and source files; never returns keys',gui:'Native engine provider catalog',inputSchema:objectSchema({engine:{enum:['codex','claude','cline','pi','opencode','kilo','deepseek','antigravity']}},['engine'])},
  {cli:[],"name": "engine.list", "args": "", "summary": "List registered Coding Agent adapters and public configuration", "gui": "引擎管理"},
  {"name": "engine.check", "args": "--engine ID [--host-id ID] [--force]", "summary": "Check executable, protocol and authentication without inference", "gui": "引擎检测"},
  {name:'engine.probe',args:'--engine ID --confirm [--model ID]',summary:'Explicit, potentially billed OK-only inference on the Core host; temporary workspace and 45s timeout',gui:'引擎测试调用'},
  {"name": "engine.configure", "args": "--engine ID --data JSON|@file", "summary": "Set native executable/SDK paths or restore native mode (user or Secretary). Providers, keys and model defaults use the engine's native configuration.", "gui": "引擎配置"},
  {"name": "engine.install-plan", "args": "--engine ID", "summary": "Read the pinned official package and Core-host install destination", "gui": "引擎安装"},
  {"name": "engine.install", "args": "--engine ID --confirm", "summary": "Install a pinned engine into application storage, never global PATH", "gui": "引擎安装"},
  {cli:["id"],"name": "engine.install-status", "args": "ID", "summary": "Read bounded installation progress without credentials", "gui": "引擎安装"},
  {cli:["id"],"name": "engine.cancel-install", "args": "ID", "summary": "Cancel an application-owned installation", "gui": "引擎安装"},
  {"name": "engine.login", "args": "--engine codex", "summary": "Start official Codex device authorization on the Core host", "gui": "Codex 登录"},
  {cli:["id"],"name": "engine.login-status", "args": "ID", "summary": "Read device authorization progress", "gui": "Codex 登录"},
  {cli:["id"],"name": "engine.cancel-login", "args": "ID", "summary": "Cancel a pending device authorization", "gui": "Codex 登录"},
  {"name": "transfer.upload-begin", "args": "--to JSON|@file --name NAME --bytes N", "summary": "Begin a scoped upload with a hidden staging file", "gui": "浏览器文件上传"},
  {"name": "transfer.upload-chunk", "args": "ID --offset N --data BASE64|--data-file FILE", "summary": "Write the next bounded upload chunk", "gui": "浏览器文件上传"},
  {cli:["id"],"name": "transfer.upload-commit", "args": "ID", "summary": "Atomically publish a completed upload without overwriting existing files", "gui": "浏览器文件上传"},
  {cli:["id"],"name": "transfer.upload-abort", "args": "ID", "summary": "Cancel and clean an upload owned by this client", "gui": "浏览器文件上传"},
  {name:"transfer.download-save",args:"--from JSON --path PATH [--overwrite]",summary:"User-only: stream a scoped download to a Core-host file, or choose a destination in the desktop",gui:"Save attachment"},
  {"name": "transfer.download-info", "args": "--from JSON|@file", "summary": "Read download size and version", "gui": "浏览器文件下载"},
  {"name": "transfer.download-chunk", "args": "--from JSON|@file --offset N [--modified-at N]", "summary": "Read a bounded file chunk and reject a changed version", "gui": "浏览器文件下载"},
  {cli:[], name: 'auth.whoami', args: '', summary: 'Read authenticated caller and management role', gui: '管理与协同' },
  {cli:["id"], name: 'auth.agent-token', args: 'ID', summary: 'Issue or read an employee API credential (user only)', gui: '管理与协同' },
  {cli:["id"], name: 'auth.revoke', args: 'ID', summary: 'Revoke employee API credentials (user only)', gui: '管理与协同' },
  { name: 'api.list', args: '[--prefix DOMAIN --search TEXT --all --compact --offset N --limit N]', summary: 'Discover APIs by domain or keyword. compact returns paged summaries and apiRevision; describe reads one schema. all grants no execution authority', gui: '管理与协同',inputSchema:objectSchema({all:booleanSchema,prefix:{type:'string',maxLength:120},search:{type:'string',maxLength:200},compact:booleanSchema,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}) },
  { name: 'api.describe', args: 'COMMAND [--all]', summary: 'Read an API schema; --all includes commands outside the caller execution authority', gui: '管理与协同',inputSchema:objectSchema({command:textSchema,all:booleanSchema},['command']) },
  { name: 'api.docs', args: '[DOCUMENT | --document DOCUMENT]', summary: 'Read the shared documentation index or a Core/plugin document; no execution authority is granted', gui: '管理与协同',inputSchema:objectSchema({document:{type:'string',description:'index, core/api, core/permissions, core/plan, core/scheduler, core/architecture, or plugin/ID/api|schema'}}) },
  {cli:{positionals:['id']},name:'api.result',args:'ID [--path JSON_POINTER --offset N --limit N]',summary:'Read a large native-tool response already received by this caller; owner-bound, expires after 15 minutes or restart. Never repeats the source operation',gui:'原生工具结果分页',inputSchema:objectSchema({id:nonemptySchema,path:{type:'string',maxLength:1000,description:'JSON Pointer in the original response, e.g. /data/items/0; omit for the complete JSON'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:12000}},['id'])},
  {name:'avatar.list',args:'[--query NAME] [--style STYLE] [--status active|archived|all] [--all]',summary:'Read the live character catalog: enabled state, exact IDs, styles, usage counts and revision. Default returns enabled choices; omitted employee appearance chooses a random enabled character.',gui:'人物形象目录',inputSchema:objectSchema({query:textSchema,style:{type:'string',description:'Optional catalog style; discover values from the returned entries'},status:{enum:['active','archived','all']},all:{type:'boolean',description:'Compatibility alias for status=all'} })},
  {name:'avatar.get',args:'ID',summary:'Read one active or archived character, its usage count, enabled display replacement and current catalog revision; any employee may read',gui:'人物形象信息',cli:['id'],inputSchema:objectSchema({id:nonemptySchema},['id'])},
  {name:'avatar.update',args:'ID --enabled true|false [--expected-revision N]',summary:'User or Secretary: enable/archive a registered character immediately across Message, Mission and pickers; retain all source assets and saved identities',gui:'启用或归档角色',inputSchema:objectSchema({id:nonemptySchema,enabled:booleanSchema,expectedRevision:{type:'integer',minimum:0}},['id','enabled'])},
  { name: 'session.acknowledge', args: '--employee ID --reply-id ID', summary: 'User-only acknowledgement of the exact displayed reply; stale acknowledgements do not clear newer replies', gui: '可见回复已读' },
  { name: 'management.topology', args: '[--creator self|others|operator|unknown|EMPLOYEE_ID]', summary: 'Read role topology and employee nodes with creation provenance, reporting edges and allowedActions', gui: '管理与协同' },
  { name: 'management.activity', args: '', summary: 'Read live communication and delegated tasks; highlighted is a maximum 600ms visual cue, not task completion', gui: '管理交互连线' },
  {cli:[], name: 'management.roles', args: '', summary: 'List employee-owned role policies: Employee, Manager and Governor, scopes and protected lifecycle rules', gui: '职位权限' },
  {name:'management.bind',args:'--employee ID [--manager ID]',summary:'Add one persistent source-to-employee arrow; multiple managers allowed; permissions, true createdBy and positions unchanged',gui:'常驻有向连线',inputSchema:objectSchema({employee:{type:'string',minLength:1,description:'Target employee ID'},manager:{type:'string',minLength:1,description:'Source Manager/Governor ID; defaults to the calling Agent; required for user calls'}},['employee'])},
  {name:'management.unbind',args:'--employee ID [--manager ID] | RELATION_ID',summary:'Remove only the selected persistent arrow, including a creator line; does not revoke control or stop work; idempotent',gui:'取消常驻连线',inputSchema:{type:'object',additionalProperties:false,properties:{employee:nonemptySchema,manager:nonemptySchema,id:{type:'string',minLength:1,description:'Alternative relation ID from management.topology.edges'}},oneOf:[{required:['employee'],not:{required:['id']}},{required:['id'],not:{anyOf:[{required:['employee']},{required:['manager']}]}}]}},
  { name: 'management.request', args: '--employee ID [--manager ID]', summary: 'Deprecated permission request; use management.bind for a visual arrow without granting authority', gui: '已停用的管理关系操作' },
  {cli:["id","decision"], name: 'management.decide', args: 'ID approve|deny', summary: 'Deprecated permission approval; visual bindings need no approval workflow', gui: '已停用的管理关系操作' },
  { name: 'management.global', args: 'ID on|off', summary: 'User or Secretary compatibility alias: assign Governor or demote to Manager; Secretary lifecycle remains user-only', gui: '旧接口兼容' },
  {cli:["id","role"], name: 'card.management-role', args: 'ID employee|manager|governor|secretary', summary: 'Assign a role; Secretary administers the app and lower roles, only the user appoints or removes Secretaries', gui: '管理与协同' },
  {cli:["id","mode"], name: 'card.access-mode', args: 'ID trusted|isolated', summary: 'Set trusted or isolated engine execution', gui: '管理与协同' },
  { name: 'session.status', args: '[--employee ID]', summary: 'Read lightweight employee activity without full transcripts', gui: '管理与协同' },
  {cli:[], name: 'shared.info',args:'',summary:'Locate the checkout Shared directory',gui:'共享中转站物理目录'},
  { name: 'view.shared',args:'on|off',summary:'Show or hide the shared transfer drawer without closing the conversation',gui:'共享中转站侧栏'},
  { name: 'transfer.start',args:'--from JSON|@file --to JSON|@file',summary:'Copy a file or directory between local, shared and employee workspaces',gui:'跨工作区拖放复制'},
  {cli:[], name: 'transfer.list',args:'',summary:'List transfer progress and results for this service run',gui:'传输列表'},
  {cli:["id"], name: 'transfer.get',args:'ID',summary:'Read a transfer result and byte progress',gui:'传输进度'},
  {cli:["id"], name: 'transfer.cancel',args:'ID',summary:'Cancel a queued or running copy; preserve source files',gui:'取消传输'},
  {cli:[], name: 'schedule.schema', args: '', summary: 'Describe the host scheduling contract', gui: 'CLI 调度基础，供插件复用' },
  {cli:[], name: 'schedule.status', args: '', summary: 'Read scheduler health and active runs', gui: 'CLI 调度基础，供插件复用' },
  {name:'schedule.list',args:'[--employee ID --source NAMESPACE]',summary:'Read raw saved schedules, including orphan records for application administrators; prefer plan.query for people, times and capabilities',gui:"Mission database",inputSchema:objectSchema({employee:nonemptySchema,source:nonemptySchema})},
  {cli:{positionals:['id'],rawPositionals:true},name:'schedule.get',args:'ID',summary:'Read the exact saved configuration and revision, even when its employee was removed; discover IDs through plan.query',gui:"Mission task editor",inputSchema:objectSchema({id:nonemptySchema},['id'])},
  {name:'schedule.create',args:'--spec @file.json | --name NAME --employee ID|self --prompt TEXT (--after-seconds N | --at ISO | --time HH:mm | --every-seconds N | --on-event EVENT) [--enabled true|false|on|off | --paused] [--days 7 --timezone IANA --month-day last --max-occurrences N --client-request-id KEY --duration-minutes N --channel ID --event-channel ID --event-conversation REF --event-employee ID --monitor-id ID --cooldown-seconds N]',summary:'Schedule an existing employee or yourself; enabled by default; --paused or --enabled false disables automatic runs; retry-safe clientRequestId',gui:"Mission task editor",inputSchema:objectSchema({spec:SCHEDULE_SPEC_SCHEMA,clientRequestId:{type:'string',minLength:1,maxLength:160}},['spec'])},
  {name:'schedule.update',args:'ID --patch @file.json [--expected-revision N]',summary:'Update an idle schedule; full action/rule replacement, optional revision; retains execution count',gui:"Mission task editor",inputSchema:objectSchema({id:textSchema,expectedRevision:{type:'integer',minimum:0},patch:objectSchema(SCHEDULE_SPEC_SCHEMA.properties)},['id','patch'])},
  {cli:{positionals:['id'],rawPositionals:true},name:'schedule.pause',args:'ID [--expected-revision N]',summary:'Pause future triggers without stopping the current run',gui:"Mission task editor",inputSchema:objectSchema({id:nonemptySchema,expectedRevision:{type:'integer',minimum:0}},['id'])},
  {cli:{positionals:['id'],rawPositionals:true},name:'schedule.resume',args:'ID [--expected-revision N]',summary:'Resume future triggers after rechecking the current target and original delegation',gui:"Mission task editor",inputSchema:objectSchema({id:nonemptySchema,expectedRevision:{type:'integer',minimum:0}},['id'])},
  {cli:{positionals:['id'],rawPositionals:true},name:'schedule.delete',args:'[ID | --ids JSON] [--expected-revision N | --expected-revisions JSON]',summary:'Delete selected schedules, including orphaned records for Secretary; preflight all IDs and revisions before any cancellation; retain run history. Self-deletion removes future triggers and returns continuingRunIds while allowing that same current Agent turn to finish; other active runs are cancelled',gui:"Mission task editor",inputSchema:{type:'object',additionalProperties:false,properties:{id:nonemptySchema,ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:nonemptySchema},expectedRevision:{type:'integer',minimum:0},expectedRevisions:{type:'object',additionalProperties:{type:'integer',minimum:0}}},oneOf:[{required:['id'],not:{required:['ids']}},{required:['ids'],not:{required:['id']}}]}},
  {name:'schedule.preview',args:'[ID [--patch JSON|@file] | --spec @file.json] [--after ISO --count N]',summary:'Preview saved or draft occurrences without executing; a saved job retains its consumed quota',gui:"Mission preview",inputSchema:{type:'object',additionalProperties:false,properties:{id:nonemptySchema,spec:SCHEDULE_SPEC_SCHEMA,patch:objectSchema(SCHEDULE_SPEC_SCHEMA.properties),after:{type:'string',description:'Exclusive ISO instant; saved-job forecasts do not replenish remaining occurrences when the cursor advances'},count:{type:'integer',minimum:1,maximum:100,default:5}},oneOf:[{required:['id'],not:{required:['spec']}},{required:['spec'],not:{anyOf:[{required:['id']},{required:['patch']}]}}]}},
  {cli:{positionals:['id'],rawPositionals:true},name:'schedule.run',args:'ID [--expected-revision N]',summary:'Run once now; may use a model, does not consume the next occurrence',gui:"Mission task editor",inputSchema:objectSchema({id:nonemptySchema,expectedRevision:{type:'integer',minimum:0}},['id'])},
  { name: 'schedule.history', args: '[ID] [--employee ID --limit N]', summary: 'Read durable run and job IDs, exact execution times and outcomes; deletion preserves authorized history', gui: "Mission execution history",inputSchema:objectSchema({id:nonemptySchema,employee:nonemptySchema,limit:{type:'integer',minimum:1,maximum:1000}}) },
  {cli:{positionals:['id'],required:['eventId']},name:'schedule.trigger',args:'ID --event-id KEY',summary:'Submit a deduplicated signal to an event schedule; current caller and original scheduling authority are checked; native channel events cannot be forged',gui:"Mission event rule",inputSchema:objectSchema({id:textSchema,eventId:{type:'string',minLength:1,maxLength:160}},['id','eventId'])},
  {cli:{positionals:['id'],rawPositionals:true},name:'schedule.cancel',args:'ID',summary:'Cancel an active run, preserving its history',gui:"Mission task editor",inputSchema:objectSchema({id:nonemptySchema},['id'])},
  {cli:[], name: 'settings.get', args: '', summary: 'Read independent Library, Messages and Plan appearances, shared controls, workspaces root and default employee models', gui: '应用设置' },
  { name: 'engine.models', args: '--engine codex|claude|cline|pi|opencode|kilo|deepseek|antigravity [--kind worker|cloud-native-worker] [--host-id ID] [--model MODEL]', summary: 'List available models before employee creation, without inference; Cloud Native reads the selected host', gui: '创建员工和默认模型设置',inputSchema:objectSchema({engine:{enum:['codex','claude','cline','pi','opencode','kilo','deepseek','antigravity']},kind:{enum:['worker','cloud-native-worker']},hostId:nonemptySchema,model:{...nonemptySchema,description:'Native ACP only: inspect the selected model and its current effort choices without inference.'}},['engine']) },
  { name: 'settings.set', args: '[--view library|messages|plan | --view-appearance JSON|@file] [--message-wallpaper JSON|@file] [--employee-workspaces-root PATH] [--language en|zh-CN] [--theme violet|blue|mint|teal|cyan|rose|coral|amber|indigo|graphite|custom|white|light|space|black|midnight|sage] [--theme-color #RRGGBB] [--default-permission default|acceptEdits|bypassPermissions] [--explorer-width N] [--explorer-collapsed on|off] [--explorer-tree-collapsed on|off] [--asset-drawer-width N] [--terminal-height N] [--page-zoom N] [--sidebar-width N] [--default-codex-model ID] [--default-claude-model ID] [--default-cline-model ID] [--default-pi-model ID]', summary: 'Patch independent view appearances, shared settings and centralized workspace root; legacy theme flags target Messages only', gui: '外观、侧栏与工作区目录设置',inputSchema:PREFERENCES_PATCH_SCHEMA },
  {cli:[], name: 'view.get', args: '', summary: 'Read service-owned navigation, including without a window', gui: '当前面板' },
  { name: 'view.open', args: 'library|messages|plan|employee|conversation|initialization|plugin|settings [--section overview|files|search|reader|hosts] [--host-id ID] [--query TEXT] [--name NAME] [--employee ID | --chat GROUP_ID | --channel CHANNEL_ID] [--source SOURCE_ID] [--plugin ID] [--plan-view ID] [--mission-tab plan]', summary: 'Open Library sections, a form, news channel, group chat or employee conversation', gui: '打开资料或会话' },
  {cli:[], name: 'view.close', args: '', summary: 'Close the current panel after saving workspace edits; keep engines running', gui: '× / Escape / 收起面板' },
  { name: 'view.details', args: 'on|off', summary: 'Show or hide employee details inside a conversation', gui: '员工资料 / 返回会话' },
  { name: 'status', args: '', summary: 'Is the app running, and how many sessions are live', gui: 'The app window being open' },
  {cli:[],name:'session.inbox',args:'',summary:'Read bounded direct-message previews for authorized employees; no model calls, terminal startup or read acknowledgements',gui:"Message conversation list"},
  { name: 'session.list', args: '[--live] [--summary]', summary: 'List stored employee cards (or live sessions with --live)', gui: 'Employee directory' },
  { name: 'session.new', args: '[--engine claude|codex|cline|pi|opencode|kilo|deepseek|antigravity] [--folder-name NAME] [--model M]', summary: 'Create a session', gui: '创建员工' },
  {cli:["id","title"], name: 'session.rename', args: '<card-or-session-id> <title>', summary: 'Rename an employee and its one conversation without moving the folder', gui: '会话名称 / 员工名牌' },
  { name: 'session.open', args: '<cardId>', summary: 'Open a stored card (resumes its engine context)', gui: 'Clicking an employee' },
  { name: 'session.send', args: '<id> <text> | --employee ID --text TEXT [--source-view messages|plan] [--client-message-id ID] [--images JSON] [--files JSON] [--reply-to MESSAGE_ID] [--reply-quote JSON] [--reply-conversation REF] [--reply-text-only]', inputSchema:sessionMessageSchema, summary: 'Send a message to a Worker session', gui: '对话输入框' },
  {cli:["id"], name: 'host.fingerprints', args: '<id>', summary: 'Read SSH host key fingerprints without trusting them', gui: '查看主机指纹' },
  { name: 'host.trust', args: '<id> --fingerprint SHA256:...', summary: 'Trust an explicitly confirmed and matching SSH host fingerprint', gui: '确认信任主机' },
  { name: 'host.terminal-open', args: '<id> [--directory PATH --cols N --rows N]', summary: 'Open a persistent SSH PTY without an employee', gui: 'Library 云主机工作台' },
  { name: 'host.terminal-list', args: '<id>', summary: 'List host PTYs', gui: 'Library 云主机工作台' },
  { name: 'host.terminal-read', args: '<id> --terminal ID [--cursor N --wait-ms N]', summary: 'Read incremental host PTY output, optionally waiting up to 15000ms for new data', gui: 'Library 云主机工作台' },
  { name: 'host.terminal-input', args: '<id> --terminal ID --data TEXT|--file FILE [--enter]', summary: 'Send host PTY input and control keys', gui: 'Library 云主机工作台' },
  { name: 'host.terminal-resize', args: '<id> --terminal ID --cols N --rows N', summary: 'Resize a host PTY', gui: 'Library 云主机工作台' },
  { name: 'host.terminal-close', args: '<id> --terminal ID', summary: 'Close a host PTY', gui: 'Library 云主机工作台' },
  { name: 'host.exec', args: '<id> --command COMMAND|--command-file FILE [--directory PATH --timeout SECONDS]', summary: 'Execute a management command exclusively on the registered remote host', gui: '远端管理命令' },
  { name: 'host.list', args: '[--os linux|macos|windows] [--distribution ubuntu|kali|ID] [--summary] [--credentials]', summary: 'Discover the shared host registry; credentials optionally includes passwords and SSH files for authorized Manager/Governor hosts; no SSH probes', gui: 'Library 云主机工作台' },
  {cli:["id"], name: 'host.get', args: '<id>', summary: 'Read a cloud host connection record', gui: 'Library 云主机工作台' },
  { name: 'host.create', args: '--data @host.json', summary: 'Create a cloud host in the shared registry', gui: 'Library 云主机工作台' },
  { name: 'host.update', args: '<id> --data @patch.json', summary: 'Edit host connection and credentials', gui: 'Library 云主机工作台' },
  {cli:["id"], name: 'host.remove', args: '<id>', summary: 'Remove an unbound cloud host', gui: 'Library 云主机工作台' },
  {cli:["id"], name: 'host.check', args: '<id>', summary: 'Check SSH connectivity for a registered cloud host', gui: 'Library 云主机工作台与连接灯' },
  { name: 'host.directories', args: '<id> [--path PATH]', summary: 'Browse existing directories on a registered cloud host', gui: 'Library 云主机工作台' },
  {cli:["id"], name: 'host.credentials', args: '<id>', summary: 'Read authorized host password and registered private key, known_hosts and SSH config contents', gui: 'Library 云主机工作台' },
  { name: 'engine.remote-check', args: '--host-id ID --engine codex|claude [--directory PATH]', summary: 'Check a Cloud Host native CLI, protocol, authentication and workspace before hiring', gui: 'Cloud Native Worker 创建前检查' },
  { name: 'engine.remote-sessions', args: '--host-id ID --engine codex|claude', summary: 'List native sessions on the selected Cloud Host', gui: '绑定已有云端会话' },
  {cli:["id","sessionId"], name: 'card.native-bind', args: '<employee-id> <native-session-id>', summary: 'Bind an existing remote native session without taking deletion ownership', gui: '绑定远端原生会话' },
  { name: 'session.follow', args: '<id> [--raw]', summary: 'Stream a session’s events until its turn ends', gui: 'Watching the transcript' },
  { name: 'session.transcript', args: '<id> | --employee ID [--limit N] [--thinking]', summary: 'Read the full conversation by default, or its last 1–1000 items with --limit; no read acknowledgment', gui: 'The transcript pane', inputSchema:{type:'object',properties:{id:{type:'string',minLength:1,description:'Employee or live session ID'},employee:{type:'string',minLength:1,description:'Alternative employee ID'},limit:{type:'integer',minimum:1,maximum:1000,description:'Last N items; omit to read the complete conversation'},thinking:{type:'boolean',description:'Include thinking blocks in formatted text and shown items'}},anyOf:[{required:['id']},{required:['employee']}]} },
  {cli:["id"], name: 'session.interrupt', args: '<id>', summary: 'Stop the current turn', gui: 'The “■ Stop” button' },
  {cli:["id"], name: 'session.close', args: '<id>', summary: 'Close a live engine while retaining the employee and history', gui: 'CLI 显式结束引擎' },
  { name: 'session.info', args: '<id> | --employee ID', summary: 'Read employee/session information; session.status returns stable employee IDs and current sessionId', gui: 'The toolbar dropdowns',inputSchema:{...objectSchema({id:nonemptySchema,employee:nonemptySchema}),anyOf:[{required:['id']},{required:['employee']}]} },
  {cli:{positionals:["id"],rawPositionals:true}, name: 'session.activity', args: '<id> | --employee ID', summary: 'Read current activity or an unread reply by stable employee or live session ID; null when idle, without opening an engine', gui: '员工活动气泡',inputSchema:{...objectSchema({id:nonemptySchema,employee:nonemptySchema}),anyOf:[{required:['id']},{required:['employee']}]} },
  {cli:["id"], name: 'session.snapshot', args: '<id>', summary: 'Full frontend state', gui: 'The conversation and toolbar' },
  { name: 'session.search', args: '<query>', summary: 'Search employees and workspaces', gui: 'Office search' },
  {cli:["id"], name: 'approval.list', args: '<id>', summary: 'Pending tool permissions', gui: 'Permission requests' },
  { name: 'approval.respond', args: '<id> <requestId> allow|deny [--answers JSON] [--form JSON]', summary: 'Answer a tool permission', gui: 'Allow / Decline' },
  {cli:["id","engine"], name: 'config.engine', args: '<card-or-live-id> ENGINE', summary: 'Retired: always rejects; delete the employee and create a new one to choose another engine', gui: '创建后引擎固定' },
  {cli:["id","model"], name: 'config.model', args: '<id> <model>', summary: 'Change model', gui: 'Model dropdown' },
  { name: 'config.remote-admin', args: '<id> on|off', summary: 'Explicitly authorize SSH-user administration on a cloud Codex worker; never local execution', gui: '远端主机管理权限' },
  {cli:["id","mode"], name: 'config.permission', args: '<id> <mode>', summary: 'Change permission mode for an opened native session; use sessionId from session.status', gui: '🔒 dropdown',inputSchema:objectSchema({id:nonemptySchema,mode:{enum:PERMISSION_MODES.map(mode=>mode.value)}},['id','mode']) },
  {cli:["id","enabled"], name: 'config.thinking', args: '<id> on|off', summary: 'Toggle thinking', gui: '🧠 toggle' },
  { name: 'config.effort', args: '<id> <level|default>', summary: 'Change effort level', gui: '⚡ dropdown' },
  { name: 'config.plan', args: '<id> on|off', summary: 'Switch the official planning mode', gui: '计划模式' },
  {cli:["url"], name: 'external.open', args: '<https-url>', summary: 'Validate an external URL and open it when a desktop is attached', gui: '原生授权链接' },
  {cli:["id","section"], name: 'engine.inspect', args: '<id> [capabilities|skills|mcp|account|usage|config]', summary: 'Inspect an opened native session; use id=sessionId from session.status, not employeeId', gui: '引擎工具面板',inputSchema:objectSchema({id:nonemptySchema,section:{enum:['capabilities','skills','mcp','account','usage','config']}},['id']) },
  { name: 'engine.skill', args: '<id> <name> [prompt]', summary: 'Invoke a discovered engine skill', gui: '使用技能' },
  { name: 'session.steer', args: '<id> <text> [--source-view messages|plan]', summary: 'Append instructions to the active native turn with optional per-message presentation context', gui: '运行中追加', inputSchema:{type:'object',properties:{id:textSchema,employee:textSchema,text:textSchema,sourceView:SOURCE_VIEW_SCHEMA},anyOf:[{required:['id']},{required:['employee']}]} },
  {cli:["id"], name: 'session.background', args: '<id>', summary: 'List agent-owned background terminals', gui: '后台进程' },
  { name: 'session.background-stop', args: '<id> [--process ID]', summary: 'Stop one or all agent-owned background terminals', gui: '停止后台进程' },
  { name: 'session.review', args: '<id> [--base BRANCH|--commit SHA|--instructions TEXT]', summary: 'Run native Codex review for a chosen target', gui: '/review' },
  { name: 'session.enqueue', args: '<id> <text> | --employee ID --text TEXT [--source-view messages|plan] [--client-message-id ID] [--images JSON] [--files JSON] [--reply-to MESSAGE_ID] [--reply-quote JSON] [--reply-conversation REF] [--reply-text-only]', inputSchema:sessionMessageSchema, summary: 'Queue a message after the active turn', gui: '排队发送' },
  {cli:["id"], name: 'session.queue', args: '<id>', summary: 'List queued messages', gui: '待发送消息' },
  {cli:["id","messageId"], name: 'session.dequeue', args: '<id> <messageId>', summary: 'Remove a queued message', gui: '取消排队' },
  { name: 'session.export', args: '<id> [--format markdown|json] [--path RELATIVE]', summary: 'Export conversation into the employee workspace', gui: '导出会话' },
  { name: 'view.tools', args: '<skills|mcp|account|usage|config|export|off>', summary: 'Open or close the engine tools panel', gui: '引擎工具面板' },
  { name: 'config.fast', args:'<id> on|off',summary:'Set the official Fast service tier',gui:'Fast 速度开关' },
  { name: 'commands.run', args:'<id> /command [args]',summary:'Execute a discovered slash command through shared Core',gui:'斜杠命令' },
  { name: 'commands.list', args: '<id> [--filter X] [--all]', summary: 'Slash commands available to a session', gui: 'The “/” menu' },
  { name: 'commands.complete', args: '<id> <name>', summary: 'What Tab would insert', gui: 'Tab/⏎ in the “/” menu' },
  { name: 'card.rename', args: '<cardId> <title>', summary: 'Rename an employee without moving its working folder', gui: '员工资料中的名字' },
  { name: 'card.remove', args: '<cardId> [cardId ...] [--delete-workspace]', summary: 'Remove selected employees and owned sessions; optionally delete all their folders after one batch preflight', gui: '侧栏编辑 · 多选员工 · 一次确认删除' },
  { name: 'card.clone', args: '<id> --title NAME [--folder-name NAME] [--directory-mode default|bind] [--cwd PATH]', summary: 'Clone an employee with an independent native conversation', gui: '克隆员工' },
  { name: 'card.initialize', args: '<employee-id> [--model ID] [--effort LEVEL]', summary: 'Retry read-only initialization: every role reads its identity and the shared documentation index', gui: '员工重试初始化' },
  { name: 'card.create', args: '--title NAME [--folder-name NAME] [--directory-mode default|bind] [--cwd PATH] [--host-id ID --remote-dir PATH] [--character NAME --avatar-style anime|chibi | --avatar ID] [--profession TEXT] [--management-role employee|manager|governor|secretary] [--kind worker|cloud-native-worker] [--engine E] [--model ID] [--thinking on|off] [--effort LEVEL] [--client-request-id ID]', summary: 'Create an employee in Message view under the centralized local workspaces root or a selected Cloud Host; discover appearances with avatar.list and verify via session.status', gui: '添加员工',inputSchema:{type:'object',required:['title'],properties:{title:{type:'string',description:'Employee display name; defaults the workspace folder name unless --folder-name/--cwd is set'},folderName:{type:'string',description:'Optional subfolder name under the centralized employee workspaces root'},directoryMode:{type:'string',enum:['default','bind']},cwd:textSchema,hostId:{type:'string',description:'Registered cloud host ID when creating a cloud-native-worker'},remoteDir:{type:'string',description:'Remote working directory or parent directory on the selected cloud host'},character:{type:'string',description:'Exact characterId/name/alias from avatar.list; e.g. 英雄王 or gilgamesh'},avatarStyle:{type:'string',description:'Optional style from the live avatar catalog; disabled styles cannot be selected'},avatar:{type:'string',description:'Exact avatar.list id, as an alternative to character + avatarStyle; omit appearance to choose a random selectable avatar'},profession:{type:'string',description:'Occupation or responsibility; does not grant authority'},managementRole:{type:'string',enum:['employee','manager','governor','secretary'],description:'Manager creates employees; Governor creates employees/managers; Secretary also creates Governors and administers the app; only user creates Secretaries'},kind:{type:'string',enum:['worker','cloud-native-worker']},engine:{type:'string',enum:['codex','claude','cline','pi','opencode','kilo','deepseek','antigravity']},model:textSchema,thinking:booleanSchema,permissionMode:textSchema,clientRequestId:{type:'string',minLength:1,maxLength:160}}}},
  {name:'card.avatar',args:'<employee-id> [--avatar ID | --character NAME --avatar-style anime|chibi]',summary:'Set a controlled employee appearance and palette; omit appearance for a random enabled character; discover live choices with avatar.list',gui:'员工人物形象',inputSchema:{type:'object',required:['id'],properties:{id:textSchema,avatar:textSchema,character:textSchema,avatarStyle:{type:'string',description:'Optional style from avatar.list'}}}},
  { name: 'card.update', args: '<cardId> [--title NAME] [--avatar ID | --character NAME --avatar-style STYLE] [--profession TEXT]', summary: 'Edit employee profile with {id,patch:{...}}; profession is the displayed specialty, not managementRole. Supervisors use card.avatar for appearance; workspace directory and engine stay fixed.', gui: '员工资料',inputSchema:objectSchema({id:nonemptySchema,patch:{type:'object',minProperties:1,properties:{title:nonemptySchema,profession:{...textSchema,description:'Professional responsibilities; saved as employee.role'},role:{...textSchema,description:'Legacy alias for profession; does not change managementRole'},avatar:textSchema,character:textSchema,avatarStyle:{type:'string',description:'Optional style from avatar.list'},accessory:textSchema,color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}},additionalProperties:true,description:'Nest profile fields here. Existing legacy forms may include unchanged binding fields, but workspace/folder/engine cannot change. A patch with no editable fields is rejected.'}},['id','patch']) },
  {cli:[], name: 'plugin.list', args: '', summary: 'List installed software plugins', gui: '软件插件' },
  {cli:["id"], name: 'plugin.describe', args: '<id>', summary: 'Read a plugin manifest, API schema and Markdown guide', gui: '插件信息' },
  {cli:["path"], name: 'plugin.install', args: '<directory>', summary: 'Install a compatible local plugin package', gui: 'CLI 安装插件' },
  {cli:{required:['id']},name:'plugin.resources',args:'--id PLUGIN [--workspace PATH]',summary:'List plugin pages/content and effective rights; employees see only authorized resources, Secretary sees all',gui:'Plugin content authorization',inputSchema:objectSchema({id:nonemptySchema,workspace:textSchema},['id'])},
  {cli:{required:['id'],aliases:{resourceIds:'resources'}},name:'plugin.access',args:'--id PLUGIN [--workspace PATH --resources JSON --employees JSON --expected-revision N]',summary:'User or Secretary: read or replace per-employee read/write/create rights on selected plugin resources; Secretary always has full access',gui:'Plugin content authorization',inputSchema:objectSchema({id:nonemptySchema,workspace:textSchema,resourceIds:{type:'array',items:nonemptySchema,minItems:1,maxItems:1000,uniqueItems:true},employees:{type:'array',maxItems:200,items:objectSchema({employeeId:nonemptySchema,read:booleanSchema,write:booleanSchema,create:booleanSchema},['employeeId','read','write','create'])},updates:{type:'array',maxItems:200000,items:objectSchema({employeeId:nonemptySchema,resourceId:nonemptySchema,read:booleanSchema,write:booleanSchema,create:booleanSchema},['employeeId','resourceId','read','write','create'])},expectedRevision:{type:'integer',minimum:0}},['id'])},
  { name: 'plugin.call', args: '<id> <method> [--params JSON] [--raw]', summary: 'Invoke the shared plugin runtime; raw preserves the JSON-RPC error/result envelope', gui: '插件中的操作' },
  { name: 'plugin.open', args: '<id> [--workspace PATH|--employee ID]', summary: 'Open or focus an independent plugin window', gui: '独立插件窗口' },
  {cli:[], name: 'plugin.windows', args: '', summary: 'List plugin window state, also in headless mode', gui: '独立插件窗口' },
  { name: 'plugin.place', args: '<windowId> --x N --y N --width N --height N', summary: 'Move and resize a plugin window', gui: '独立插件窗口' },
  {cli:["id","mode"], name: 'plugin.mode', args: '<windowId> normal|minimized|maximized|fullscreen', summary: 'Change native plugin window state', gui: '插件窗口最小化、还原与全屏' },
  {cli:["id"], name: 'plugin.dismiss', args: '<windowId>', summary: 'Save and close an independent plugin window', gui: '独立插件窗口' },
  { name: 'plugin.view', args: '<id> [--workspace PATH|--employee ID]', summary: 'Open a plugin view in its managed root or selected scope', gui: '插件工作空间' },
  {cli:["viewId"], name: 'plugin.close', args: '<viewId>', summary: 'Close an embedded plugin view', gui: '关闭工作空间' },
  { name: 'workspace.docs', args: '--employee ID', summary: 'Prepare shared documentation and authorized CLI entry points without copying handbooks into the workspace', gui: '自动准备 Agent 文档' },
  { name: 'workspace.suggest', args: '[--title NAME] [--folder-name NAME] [--host-id ID --remote-dir PATH]', summary: 'Suggest an external centralized local or cloud workspace directory without changing files', gui: '默认工作目录' },
  { name: 'workspace.choose', args: '[--path PATH]', summary: 'Choose a folder in the desktop directory picker', gui: '选择文件夹' },
  { name: 'remote.check', args: '--employee ID | --host-id ID [--remote-dir PATH] | --remote-host HOST --remote-dir PATH', summary: 'Check SSH and the target working directory; return remote OS details', gui: '云端工作目录诊断'},
  { name: 'terminal.open', args: '--employee ID [--cols N --rows N]', summary: 'Open a PTY in the employee working directory', gui: '新建终端'},
  { name: 'terminal.list', args: '[--employee ID]', summary: 'List employee terminals', gui: '终端标签'},
  { name: 'terminal.read', args: 'ID [--cursor N]', summary: 'Read terminal output since an offset', gui: '终端输出'},
  { name: 'terminal.input', args: 'ID --data TEXT [--enter]', summary: 'Send terminal input, including control keys', gui: '终端输入'},
  { name: 'terminal.resize', args: 'ID --cols N --rows N', summary: 'Resize the PTY', gui: '终端尺寸'},
  {cli:["id"], name: 'terminal.close', args: 'ID', summary: 'Close a terminal and its shell', gui: '关闭终端'},
  {name:'workspace.reveal',args:'--from JSON|@file',summary:'User-only: reveal an existing scoped Core-host file or folder in the local desktop file manager; remote and browser paths cannot be revealed on the client',gui:'Open in Finder',cli:{required:['from']},inputSchema:objectSchema({from:objectSchema({path:nonemptySchema,worker:nonemptySchema,asset:nonemptySchema,conversation:nonemptySchema,shared:booleanSchema,employee:nonemptySchema,channel:nonemptySchema,local:booleanSchema},['path'])},['from'])},
  { name: 'workspace.list', args: '[path] [--shared|--employee ID]', summary: 'List real workspace files', gui: '文件目录' },
  { name: 'workspace.image', args: '<path> [--shared|--employee ID]', summary: 'Read a scoped image for preview or model input', gui: '图片预览和附件' },
  { name: 'workspace.read', args: '<path> [--shared|--employee ID]', summary: 'Read a workspace file', gui: '文件预览' },
  { name: 'workspace.write', args: '<path> [--shared|--employee ID] --content TEXT|--base64-file IMAGE_B64 [--hash HASH]', summary: 'Save text or a PNG/JPEG/GIF/WebP image in a workspace', gui: '保存文件或粘贴截图' },
  { name: 'workspace.mkdir', args: '<path> [--shared|--employee ID]', summary: 'Create a folder', gui: '新建文件夹' },
  { name: 'workspace.move', args: '<path> --to PATH [--shared|--employee ID]', summary: 'Rename or move a file', gui: '重命名文件' },
  { name: 'workspace.trash', args: '<path> [--shared|--employee ID]', summary: 'Move a file to recoverable workspace trash', gui: '移到回收站' },
  { name: 'workspace.restore', args: '--id ID [--shared|--employee ID]', summary: 'Restore a trashed file', gui: '撤销删除' },

  // UI inspection. These read what is actually on screen, so a test can assert
  // the interface rendered rather than only that the store changed.
  { name: 'ui.view', args: '', summary: 'Which view is showing (messages, plan, or a session)', gui: 'The screen itself' },
  { name: 'ui.dom', args: '[--sel CSS]', summary: 'Query the live interface', gui: 'The screen itself' },
  { name: 'ui.text', args: '', summary: 'All visible text, as rendered', gui: 'The screen itself' },
  { name: 'ui.click', args: '<selector>', summary: 'Click an element in the interface', gui: 'That click' },
  { name: 'ui.type', args: '<selector> <text>', summary: 'Type into an input', gui: 'That typing' },
  { name: 'ui.wait', args: '<selector> [--timeout ms]', summary: 'Wait for an element to appear', gui: 'Waiting for the UI to catch up' },
  { name: 'ui.style', args: '<selector>', summary: 'Computed styles of an element', gui: 'How it actually looks' },
  { name: 'ui.screenshot', args: '<path> [--privacy]', summary: 'Capture a fresh desktop frame; privacy hides workspace paths and activity bubbles only during export', gui: 'Rendered interface' },
  { name: 'ui.drag', args: '<selector> --dx N --dy N', summary: 'Drag a rendered component', gui: '拖动控件' },
  { name: 'ui.wheel', args: '<selector> --dx N --dy N [--zoom]', summary: 'Pan or zoom with the mouse wheel', gui: '画布滚轮' }
]

/** The shape a UI query returns. */
export type UiElement = {
  tag: string
  cls: string
  text: string
  visible: boolean
  rect: {x:number;y:number;width:number;height:number}
  image?: {complete:boolean;naturalWidth:number;naturalHeight:number}
}

export type UiSnapshot = {
  view: 'library' | 'messages' | 'plan' | 'session'
  cards: { title: string; engine: string }[]
  /** Present only in the session view. */
  session?: {
    title: string
    engine: string
    model: string
    permission: string
    thinking: string
    thinkingEnabled: boolean
    busy: boolean
    turns: number
    hasBackButton: boolean
  }
  counts: Record<string, number>
}

export type ApiPermission='worker'|'chat'|'operator'|'host.read'|'identity'|'topology'|'relation'|'employee.read'|'employee.message'|'employee.configure'|'employee.create'|'employee.delete'|'workspace'|'plugin'|'schedule';
const permissions:Record<string,ApiPermission>={};
permissions['plan.preferences']='operator';permissions['plan.archive']='schedule';
for(const command of ['notebook.status','notebook.guide','notebook.methods','notebook.resources','notebook.call','reader.status','reader.guide','reader.methods','reader.resources','reader.call','host.resources'])permissions[command]='schedule';
for(const command of MISSION_COMMANDS)permissions[command.name]='schedule';
for(const command of ENGINEERING_COMMANDS)permissions[command.name]='schedule';
for(const command of QUESTION_COMMANDS)permissions[command.name]='chat';
permissions['direct.send']='chat';permissions['direct.send-status']='chat';permissions['direct.post']='identity';permissions['direct.history']='employee.read';permissions['direct.files']='employee.read';permissions['direct.search']='employee.read';permissions['direct.storage']='employee.read';permissions['direct.clear']='operator';
for(const command of [...WORKER_COMMANDS,...MONITOR_COMMANDS])permissions[command.name]='worker';
permissions['worker.terminal']='operator';permissions['worker.upload-begin']='operator';
permissions['monitor.list']='schedule';permissions['monitor.read']='schedule';
for(const [permission,names] of Object.entries({'host.read':['host.get','host.credentials'],identity:['avatar.list','avatar.get','engine.capabilities','system.info','auth.whoami','api.list','api.describe','api.docs','api.result','management.roles'],topology:['management.topology','management.activity','host.list'],relation:['management.request','management.bind','management.unbind'], 'employee.read':['card.profile','session.status','session.info','session.snapshot','session.activity','session.transcript','session.follow','session.queue','session.list','session.inbox'], 'employee.message':['card.initialize','session.open','session.send','session.enqueue','session.dequeue','session.interrupt'], 'employee.configure':['card.avatar','config.model','config.effort','config.thinking','config.fast','config.plan'], 'employee.create':['card.create'],'employee.delete':['card.remove'],workspace:['assets.browse','assets.info','assets.preview','workspace.reveal','assets.tree','assets.children','assets.locate','assets.search','assets.file','workspace.list','workspace.read','workspace.write','workspace.mkdir','workspace.move','workspace.trash','workspace.restore','workspace.image','workspace.docs','workspace.pdf'],plugin:['plugin.call','plugin.describe','plugin.list','plugin.resources'],schedule:[...PLAN_COMMANDS.map(command=>command.name),'schedule.schema','schedule.status','schedule.list','schedule.get','schedule.create','schedule.update','schedule.pause','schedule.resume','schedule.delete','schedule.preview','schedule.run','schedule.history','schedule.cancel','schedule.trigger']}))for(const name of names)permissions[name]=permission as ApiPermission;
for(const name of [...GROUP_COLLABORATION_COMMANDS.map(command=>command.name),...CONVERSATION_WORKSPACE_COMMANDS.map(command=>command.name),...CONVERSATION_FILE_COMMANDS.map(command=>command.name),...CONVERSATION_CONTROL_COMMANDS.map(command=>command.name),...MESSAGE_COLLABORATION_COMMANDS.map(command=>command.name),'bot.list','chat.create','chat.update','chat.delete','chat.mute','chat.list','chat.get','chat.history','chat.context','chat.file','chat.send','chat.post','channel.fetch-text','channel.fetch-images','channel.search','channel.sources','channel.source-info','channel.source-order','channel.list','channel.get','channel.history','channel.timeline','channel.context','channel.post','channel.image','channel.message-post','channel.publish','channel.media-put'])permissions[name]='chat';
export const CLI_COMMANDS=DEFINITIONS
export const COMMANDS=DEFINITIONS.map(({cli,...command})=>({...command,readOnly:READ_ONLY_APIS.has(command.name),...(RETIRED_APIS[command.name]?{replacement:RETIRED_APIS[command.name]}:{}),permission:permissions[command.name]??'operator' as ApiPermission,target:command.name.startsWith('schedule.')?'schedule':command.name.startsWith('session.')||command.name.startsWith('config.')||command.name.startsWith('card.')?'session-or-employee':'request'}));
