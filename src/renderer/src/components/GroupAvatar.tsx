import type {ChatGroupView} from '../../../shared/chat-groups'
import type {Store} from '../../../shared/types'
import {BotAvatar} from './BotWorkers'
import {EmployeePortrait} from './EmployeePortrait'
import {Icon} from './Icon'

/** Group identity uses up to four actual members; cells own their portrait sizing. */
export function GroupAvatar({group,store,large=false}:{group:ChatGroupView;store:Store;large?:boolean}){
 if(group.bot)return <span className={`group-avatar bot-group-avatar ${large?'large':''}`} aria-hidden="true"><BotAvatar provider={group.bot.provider} bot={group.bot}/></span>
 const people=group.members.flatMap(member=>{const card=store.sessions.find(card=>card.id===member.id);return card?[card]:[]}).slice(0,4)
 return <span className={`group-avatar ${large?'large ':''}${people.length>1?'group-portrait-grid':people.length?'group-portrait-single':''}`} data-member-count={people.length} aria-hidden="true">{people.length?people.map(card=><span className="group-avatar-cell" data-group-avatar-member={card.id} key={card.id}><EmployeePortrait avatar={card.avatar??(card.engine==='codex'?'robot':'cat')} color={card.color}/></span>):<Icon name="organization"/>}</span>
}
