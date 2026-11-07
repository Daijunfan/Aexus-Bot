import {createHash} from 'node:crypto'
import type {Row} from './channel-store'
const feeds=new Map<string,string[]>()
/** Refresh changes the mix; a page cursor keeps that refresh's order stable while scrolling. */
export function discoveryPosts(rows:Row[],args:Record<string,any>,limit:number){
 if(typeof args.seed!=='string'||!args.seed||args.seed.length>120||!Number.isSafeInteger(args.snapshot)||args.snapshot<0)throw Error('A discovery feed requires its refresh seed and snapshot')
 const identity=JSON.stringify([args.seed,args.snapshot,args.channelId,args.sourceId,args.sourceIds,args.query,args.saved,args.avoidFirst]),key=createHash('sha256').update(identity).digest('hex')
 let order=feeds.get(key),after=''
 if(args.cursor){let cursor:any;try{cursor=JSON.parse(Buffer.from(args.cursor,'base64url').toString())}catch{}if(!cursor||cursor.key!==key||typeof cursor.after!=='string')throw Error('The feed cursor belongs to another refresh');after=cursor.after}
 if(!order){
  const score=(row:Row)=>{const random=createHash('sha256').update(args.seed+'\0'+row.id).digest().readUInt32BE()/0xffffffff,age=Math.max(0,(args.snapshot-row.published_at)/86400000);return .65/(1+age)+.35*random}
  const sorted=rows.map(row=>({id:row.id,score:row.id===args.avoidFirst?-1:score(row)})).sort((a,b)=>b.score-a.score||b.id.localeCompare(a.id))
  order=sorted.map(row=>row.id);feeds.set(key,order);if(feeds.size>32)feeds.delete(feeds.keys().next().value!)
 }
 const current=new Map(rows.map(row=>[row.id,row])),start=after?order.indexOf(after)+1:0
 if(after&&!start)throw Error('The feed refresh has expired; refresh again')
 const remaining=order.slice(start).flatMap(id=>current.has(id)?[current.get(id)!]:[]),page=remaining.slice(0,limit),last=page.at(-1)
 return {rows:page,nextCursor:remaining.length>limit&&last?Buffer.from(JSON.stringify({key,after:last.id})).toString('base64url'):null,total:order.filter(id=>current.has(id)).length}
}
