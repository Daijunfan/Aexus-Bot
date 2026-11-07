import {all,one,run,changed,transaction,canonicalChannelId} from './channel-store'
import {requireChannelReader} from './channel-access'
import {requireAppAdministrator} from './application-authority'
import type {ChannelSourceOrder} from '../shared/channels'

export function orderedChannelSources(id:string):ChannelSourceOrder{
 id=canonicalChannelId(id)
 const existing=all('SELECT id FROM sources WHERE channel_id=? ORDER BY created_at,id',id).map(row=>String(row.id)),saved=one('SELECT value FROM metadata WHERE key=?','source_order:'+id),order=saved?JSON.parse(saved.value):{revision:0,sourceIds:[]}
 return {id,revision:order.revision,sourceIds:[...order.sourceIds.filter((source:string)=>existing.includes(source)),...existing.filter(source=>!order.sourceIds.includes(source))]}
}
export function channelSourceOrder(args:{id:string;sourceIds?:string[];expectedRevision?:number}){
 const id=canonicalChannelId(args.id);if(!one('SELECT 1 FROM channels WHERE id=?',id))throw Error('Unknown news channel')
 requireChannelReader(id);const current=orderedChannelSources(id)
 if(args.sourceIds===undefined)return current
 requireAppAdministrator()
 if(args.expectedRevision!==current.revision)throw Error('Source order changed; reload before saving')
 if(!Array.isArray(args.sourceIds)||new Set(args.sourceIds).size!==args.sourceIds.length||args.sourceIds.some(source=>!current.sourceIds.includes(source)))throw Error('Choose unique sources belonging to this channel')
 const next={id,revision:current.revision+1,sourceIds:[...args.sourceIds,...current.sourceIds.filter(source=>!args.sourceIds!.includes(source))]}
 transaction(()=>run('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','source_order:'+id,JSON.stringify(next)))
 changed('source-order',{channelIds:[id]});return next
}
