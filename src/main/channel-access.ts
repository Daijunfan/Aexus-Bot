import {controlChanged} from './conversation-policy'
import {one,run,canonicalChannelId,transaction,changed} from './channel-store'
import {channelMemberIds} from './channel-members'
import {readStore} from './store'
import {isAppAdministrator,requireAppAdministrator} from './application-authority'
import {requestContext} from './request-context'
import type {PrincipalRef} from '../shared/management'

export function channelReaderIds(id:string){id=canonicalChannelId(id);const row=one('SELECT employee_ids FROM channel_read_access WHERE channel_id=?',id);const existing=new Set(readStore().sessions.filter(card=>!card.deleting).map(card=>card.id));return (row?JSON.parse(row.employee_ids):channelMemberIds(id)).filter((employee:string)=>existing.has(employee)) as string[]}
export function canReadChannel(id:string,principal:PrincipalRef=requestContext().principal){return isAppAdministrator(principal)||principal.kind==='agent'&&channelReaderIds(id).includes(principal.employeeId)}
export function requireChannelReader(id:string){if(!canReadChannel(id))throw Object.assign(Error('Channel access required: ask the user or Secretary to authorize you with channel.access, then use channel.fetch-text, channel.fetch-images or channel.search'),{code:'CHANNEL_ACCESS_REQUIRED'})}
/** Reading grants do not subscribe employees to messages or give them publishing authority. */
export function channelAccess(args:{id:string;employeeIds?:string[];expectedRevision?:number}){
 requireAppAdministrator();const id=canonicalChannelId(args.id),current=one('SELECT revision FROM channels WHERE id=?',id);if(!current)throw Error('Unknown news channel')
 if(args.employeeIds!==undefined){
  if(!Array.isArray(args.employeeIds)||args.employeeIds.length>200||args.employeeIds.some(id=>typeof id!=='string'))throw Error('Choose up to 200 existing employees')
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==current.revision)throw Error('Channel changed; reload before saving')
  const cards=readStore().sessions.filter(card=>!card.deleting);for(const id of args.employeeIds)if(!cards.some(card=>card.id===id))throw Error('Unknown employee: '+id)
  const ids=[...new Set(args.employeeIds)].filter(id=>cards.find(card=>card.id===id)!.managementRole!=='secretary')
  transaction(()=>{run('INSERT INTO channel_read_access VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET employee_ids=excluded.employee_ids',id,JSON.stringify(ids));run('UPDATE channels SET revision=revision+1,updated_at=? WHERE id=?',Date.now(),id);run('INSERT INTO conversation_audit(conversation,actor,action,details,created_at) VALUES(?,?,?,?,?)','channel:'+id,JSON.stringify(requestContext().principal),'access',JSON.stringify({employeeIds:ids}),Date.now())})
  changed('channels',{channelIds:[id]});controlChanged('channel:'+id)
 }
 return {id,employeeIds:channelReaderIds(id),revision:Number(one('SELECT revision FROM channels WHERE id=?',id)!.revision),automaticRoles:['secretary']}
}
