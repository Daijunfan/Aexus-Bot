import {affectsMembers} from '../../../shared/store-changes'
import {useCatalog} from './useCatalog'
import {useCallback,useEffect,useMemo,useRef,useState,type RefObject} from 'react'
import {useReadingPosition} from './useReadingPosition'
import type {ChannelEvent,ChannelPost,ChannelPostPage,ChannelView} from '../../../shared/channels'
import {api} from '../api'
import {createRefreshQueue,retainEqual} from '../snapshot'

export function useChannelCatalog(enabled:boolean){
 const {value:channels,...state}=useCatalog<ChannelView>('channel.list',enabled,event=>event.channel==='channel:changed'||event.channel==='store:changed'&&affectsMembers(event.payload))
 return {channels,...state}
}

const newestFirst=(a:ChannelPost,b:ChannelPost)=>b.publishedAt-a.publishedAt||(a.id<b.id?1:a.id>b.id?-1:0)
/** Only changed publications are re-read; the loaded cursor and reading tail stay intact. */
const recentFeeds=new Map<string,{posts:ChannelPost[];cursor:string|null}>()
export function useChannelPosts(channelId:string,query:string,saved:boolean,container:RefObject<HTMLElement|null>,sources?:string|string[],view='conversation'){
  const sourceIds=typeof sources==='string'?[sources]:sources
  const key=JSON.stringify([channelId,query,saved,sourceIds,view]),cached=recentFeeds.get(key)
  const scope=useMemo(()=>Symbol(key),[key])
  const [posts,setPosts]=useState<ChannelPost[]>(cached?.posts??[]),[cursor,setCursor]=useState<string|null>(cached?.cursor??null),[loading,setLoading]=useState(!cached),[more,setMore]=useState(false),[error,setError]=useState('')
  const current=useRef(posts),end=useRef(cursor),identity=useRef<symbol|null>(scope),dataKey=useRef(key),generation=useRef(0),paging=useRef(false),failedPage=useRef(false),pending=useRef({full:true,more:false,reset:false,ids:new Set<string>()}),keepPosition=useReadingPosition(container,posts)
  identity.current=scope
  const publish=(items:ChannelPost[],includeStart=false)=>{keepPosition(includeStart);items.sort(newestFirst);current.current=items;setPosts(previous=>retainEqual(previous,items));recentFeeds.delete(key);recentFeeds.set(key,{posts:items,cursor:end.current});if(recentFeeds.size>6)recentFeeds.delete(recentFeeds.keys().next().value!)}
  const refresh=useMemo(()=>createRefreshQueue(async()=>{
    if(identity.current!==scope)return
    const version=generation.current,valid=()=>identity.current===scope&&generation.current===version
    const work=pending.current;pending.current={full:false,more:false,reset:false,ids:new Set()}
    if(work.reset){current.current=[];end.current=null}
    if(!current.current.length)setLoading(true)
    try{
      if(work.full||query&&!work.more||[...work.ids].some(id=>!current.current.some(post=>post.id===id))){
        const loaded=current.current,boundary=loaded.at(-1),count=Math.max(24,loaded.length+work.ids.size+(work.more?24:0)),items:ChannelPost[]=[];let next:string|null=null
        do{const page:ChannelPostPage=await api.call<ChannelPostPage>('channel.posts',{channelId,order:'newest',...(sourceIds?.length?{sourceIds}:{}),...(query.trim()?{query:query.trim()}:{}),saved:saved||undefined,limit:Math.min(100,Math.max(24,count-items.length)),...(next?{cursor:next}:{})});if(!valid())return;items.push(...page.posts);next=page.nextCursor}while(next&&(items.length<count||!!boundary&&newestFirst(items.at(-1)!,boundary)<0))
        end.current=next;setCursor(next);publish(items,work.more)
      }else if(work.more&&end.current){
        const page=await api.call<ChannelPostPage>('channel.posts',{channelId,order:'newest',...(sourceIds?.length?{sourceIds}:{}),...(query.trim()?{query:query.trim()}:{}),saved:saved||undefined,cursor:end.current,limit:24})
        if(!valid())return
        const known=new Set(current.current.map(post=>post.id)),items=[...current.current,...page.posts.filter(post=>!known.has(post.id))]
        end.current=page.nextCursor;setCursor(page.nextCursor);publish(items,true)
      }else if(work.ids.size){
        const known=new Set(current.current.map(post=>post.id)),updates=[...work.ids].filter(id=>known.has(id))
        const changed=await Promise.all(updates.map(async id=>{try{return [id,await api.call<ChannelPost>('channel.post',{id})] as const}catch(cause){if(['Unknown news item','This news item was deleted or expired'].includes((cause as Error).message))return [id,null] as const;throw cause}}))
        if(!valid())return
        const items=new Map(current.current.map(post=>[post.id,post]))
        for(const [id,post] of changed){if(!post||post.channelId!==channelId||sourceIds?.length&&!sourceIds.includes(post.sourceId)||saved&&!post.saved)items.delete(id);else items.set(id,post)}
        publish([...items.values()])
      }
      if(valid())setError('')
    }catch(cause){if(valid()){failedPage.current=work.more;setError((cause as Error).message)}}finally{if(valid()){if(work.more){paging.current=false;setMore(false)}setLoading(false)}}
  }),[channelId,query,saved,key,keepPosition])
  useEffect(()=>{generation.current++;identity.current=scope;dataKey.current=key;paging.current=false;failedPage.current=false;const previous=recentFeeds.get(key);current.current=previous?.posts??[];end.current=previous?.cursor??null;pending.current={full:true,more:false,reset:false,ids:new Set()};setPosts(current.current);setCursor(end.current);setLoading(!previous);setMore(false);setError('');void refresh();let timer:ReturnType<typeof setTimeout>|undefined;const off=api.onEvent(event=>{if(event.channel==='client:connected'){pending.current.full=true;void refresh();return}if(event.channel!=='channel:changed')return;const change=event.payload as ChannelEvent;if(change.kind==='messages'||change.kind==='reads'||change.kind==='avatars'||change.kind==='source-order')return;if(change.channelIds&&!change.channelIds.includes(channelId))return;if(change.postIds?.length)for(const id of change.postIds)pending.current.ids.add(id);else pending.current.full=true;if(!timer)timer=setTimeout(()=>{timer=undefined;void refresh()},160)});return()=>{identity.current=null;generation.current++;off();clearTimeout(timer)}},[channelId,key,refresh])
  const loadMore=()=>{if(!end.current||paging.current||loading)return;paging.current=true;failedPage.current=false;pending.current.more=true;setMore(true);return refresh()}
  const changed=useCallback((id:string,post:ChannelPost|null)=>{const next=current.current.flatMap(value=>value.id!==id?[value]:post&&post.channelId===channelId&&(!sourceIds?.length||sourceIds.includes(post.sourceId))&&(!saved||post.saved)?[post]:[]);publish(next)},[channelId,saved,key,keepPosition])
  return {...(dataKey.current===key?{posts,cursor,loading,more,error}:{posts:cached?.posts??[],cursor:cached?.cursor??null,loading:!cached,more:false,error:''}),refresh:(reset=false)=>{pending.current.reset||=reset;pending.current.full=true;return refresh()},retry:()=>{if(failedPage.current)return loadMore();pending.current.full=true;return refresh()},loadMore,changed}
}
