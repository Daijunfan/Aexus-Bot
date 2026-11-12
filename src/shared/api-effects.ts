/** Shared read-only classification. Unknown commands require write approval and replay protection; Core authorization is independent. */
export const READ_ONLY_APIS=new Set(`
mission.get mission.list mission.summary question.get question.list question.wait
engineering.get engineering.list engineering.activity engineering.context engineering.export engineering.parse engineering.artifact
workspace.catalog conversation.files conversation.entry conversation.download-status channel.post-trigger-list channel.post-trigger-history channel.post-trigger-batch
conversation.upload-status
direct.history direct.send-status
conversation.policy conversation.audit conversation.notice-list conversation.notice-get conversation.notice-preview conversation.notice-history
assets.browse assets.info assets.preview assets.tree assets.children assets.locate assets.search
board.categories bot.list monitor.list monitor.read
worker.commands worker.inspect worker.background worker.history worker.list worker.read worker.snapshot
status auth.whoami api.list api.describe api.docs api.result avatar.list avatar.get management.roles management.topology management.activity
system.info system.directories settings.get engine.list engine.providers engine.check engine.capabilities engine.models engine.inspect engine.install-plan engine.install-status engine.login-status
session.list session.status session.info session.snapshot session.activity session.transcript session.inbox session.queue session.background session.search commands.list commands.complete
card.profile group.list office.layout room.layout canvas.view team-view.list connector.get
plan.schema plan.query plan.views plan.calendar plan.timeline plan.analytics plan.feed
schedule.schema schedule.status schedule.list schedule.get schedule.preview schedule.history
chat.invites chat.join-requests chat.trash chat.export chat.list chat.get chat.history chat.context chat.file chat.details chat.thread chat.topic-list chat.poll-get chat.checklist-get
channel.source-info channel.fetch-text channel.fetch-images channel.search channel.subscription-status channel.list channel.get channel.sources channel.history channel.context channel.timeline channel.read-state channel.posts channel.post channel.image channel.avatar-image channel.source-image channel.connection channel.collectors channel.collector-config channel.file-status
messenger.sticker-list messenger.sticker-image messenger.directory messenger.state messenger.search messenger.gallery messenger.reference messenger.forward-status messenger.social messenger.profile-image
workspace.list workspace.read workspace.image workspace.suggest conversation.workspace conversation.workspaces
plugin.resources plugin.list plugin.describe plugin.windows host.list host.get host.fingerprints host.terminal-list host.terminal-read host.directories terminal.list terminal.read transfer.list transfer.get shared.info view.get view.list
`.trim().split(/\s+/))
export function apiReadOnly(command:string,args:Record<string,unknown>={}){
 if(command==='workspace.pdf')return args.operation!=='render'
 if(command==='engineering.prompts')return args.content===undefined
 if(command==='worker.command'){const text=typeof args.text==='string'?args.text.trim():'';return /^\/(help|status|model|effort|permissions|skills|mcp|account|usage|config|history|export|ps)$/.test(text)||/^\/(fast|thinking)(\s+status)?$/.test(text)}
 if(command==='worker.terminal')return ['list','read'].includes(String(args.operation))
 if(command==='worker.file')return ['list','read','image','info','chunk'].includes(String(args.operation))
 if(command==='worker.export')return args.path===undefined
 if(command==='plan.preferences')return args.patch===undefined
 if(command==='bot.list')return true
 if(command==='bot.access')return args.employeeIds===undefined
 if(command==='bot.appearance')return args.avatar===undefined
 if(command==='assets.naming')return !args.apply
 if(command==='conversation.file')return ['list','read','image','info','chunk'].includes(String(args.operation))
 if(command==='conversation.download-status')return !args.cancel
 if(command==='conversation.upload-status')return !args.cancel
 if(command==='conversation.transfer')return !args.cancel
 if(command==='channel.settings'||command==='channel.storage')return args.patch===undefined
 if(command==='plugin.access')return args.employees===undefined&&args.updates===undefined
 if(command==='channel.source-order')return args.sourceIds===undefined
 if(command==='channel.access')return args.employeeIds===undefined
 return READ_ONLY_APIS.has(command)
}
export const RETIRED_APIS:Record<string,string>={
 'channel.message-send':'chat.send (group discussion; channels are read-only)',
 'channel.message-post':'chat.post (group replies; channels are read-only)',
 'channel.post-trigger-set':'channel.fetch-text / channel.fetch-images / channel.search',
 'channel.post-trigger-remove':'channel.fetch-text / channel.fetch-images / channel.search',
 'management.request':'management.bind','management.decide':'management.bind','management.team':'management.roles',
 'management.global':'card.management-role','config.engine':'card.create (new employee; existing engine stays fixed)'
}
