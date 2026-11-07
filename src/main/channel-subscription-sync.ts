import type {ChannelCollector,ChannelSubscriptionStatus} from '../shared/channels'
import {all,one,run,revision} from './channel-store'
import {channelEngine,collectorAllowsSource} from './channel-engines'
import {requireAppAdministrator} from './authorization'

const fail=(message:string,code='INVALID_SUBSCRIPTION_SYNC',status=400)=>Object.assign(Error(message),{code,status})
export function collectorReceived(id:string,version:number){
 run('INSERT INTO collector_sync(collector_id,delivered_revision) VALUES(?,?) ON CONFLICT(collector_id) DO UPDATE SET delivered_revision=MAX(delivered_revision,excluded.delivered_revision)',id,version)
}
export const collectorDelivery=(id:string)=>one('SELECT delivered_revision FROM collector_sync WHERE collector_id=?',id)?.delivered_revision as number|undefined
/** Only the authenticated collector capability can acknowledge its own applied snapshot. */
export function acknowledgeSubscriptions(collector:ChannelCollector,args:Record<string,unknown>){
 if(Object.keys(args).some(key=>key!=='revision')||!Number.isSafeInteger(args.revision)||Number(args.revision)<0)throw fail('Provide the applied subscription revision')
 const version=Number(args.revision),delivered=collectorDelivery(collector.id)
 if(delivered===undefined||version>delivered)throw fail('This subscription revision was not delivered to this collector','CONFIG_NOT_DELIVERED',409)
 run('UPDATE collector_sync SET applied_at=CASE WHEN applied_revision IS NULL OR applied_revision<? THEN ? ELSE applied_at END,applied_revision=MAX(COALESCE(applied_revision,-1),?) WHERE collector_id=?',version,Date.now(),version,collector.id)
 const row=one('SELECT applied_revision,applied_at FROM collector_sync WHERE collector_id=?',collector.id)!
 return {revision:row.applied_revision,appliedAt:row.applied_at}
}
export function subscriptionStatus(args:{channelId?:string}={}):ChannelSubscriptionStatus{
 requireAppAdministrator()
 if(Object.keys(args).some(key=>key!=='channelId'))throw fail('Unknown subscription status field')
 if(args.channelId!==undefined&&(typeof args.channelId!=='string'||!one('SELECT id FROM channels WHERE id=?',args.channelId)))throw fail('Unknown channel')
 const current=revision('config_revision'),sources=all('SELECT * FROM sources'+(args.channelId?' WHERE channel_id=?':''),...(args.channelId?[args.channelId]:[]))
 const bound=args.channelId?channelEngine(args.channelId):undefined
 const rows=all('SELECT c.*,s.applied_revision,s.applied_at,a.last_seen_at FROM collectors c LEFT JOIN collector_sync s ON s.collector_id=c.id LEFT JOIN collector_activity a ON a.collector_id=c.id WHERE c.revoked_at IS NULL ORDER BY c.created_at,c.id')
 return {revision:current,collectors:rows.filter(row=>!args.channelId||bound?.kind==='external'&&bound.collectorId===row.id||sources.some(source=>collectorAllowsSource(source,{id:row.id,name:row.name,sourceIds:JSON.parse(row.source_ids),createdAt:row.created_at}))).map(row=>{
  const online=!!row.last_seen_at&&Date.now()-row.last_seen_at<90000
  return {id:row.id,name:row.name,state:!online?'offline':row.applied_revision===current?'synced':'pending',...(row.last_seen_at?{lastSeenAt:row.last_seen_at}:{}),...(row.applied_revision!==null?{appliedRevision:row.applied_revision,appliedAt:row.applied_at}:{})}
 })}
}
