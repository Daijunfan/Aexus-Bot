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
export type DiscoveryFeed={order:'discovery';seed:string;snapshot:number;avoidFirst?:string}
const recentFeeds=new Map<string,{posts:ChannelPost[];cursor:string|null}>()
export function useChannelPosts(channelId:string,query:string,saved:boolean,container:RefObject<HTMLElement|null>,sources?:string|string[],discovery?:DiscoveryFeed){
  const sourceIds=typeof sources==='string'?[sources]:sources
  const key=JSON.stringify([channelId,query,saved,sourceIds,discovery]),cached=recentFeeds.get(key)
  const [posts,setPosts]=useState<ChannelPost[]>(cached?.posts??[]),[cursor,setCursor]=useState<string|null>(cached?.cursor??null),[loading,setLoading]=useState(!cached),[more,setMore]=useState(false),[error,setError]=useState('')
  const current=useRef(posts),end=useRef(cursor),identity=useRef(''),pending=useRef({full:true,ids:new Set<string>()}),keepPosition=useReadingPosition(container,posts)
  identity.current=key
  const publish=(items:ChannelPost[])=>{keepPosition();current.current=items;setPosts(previous=>retainEqual(previous,items))}
  const refresh=useMemo(()=>createRefreshQueue(async()=>{
    const work=pending.current;pending.current={full:false,ids:new Set()}
    if(!current.current.length)setLoading(true)
    try{
      if(work.full||query){
        const loaded=current.current,boundary=loaded.at(-1),count=Math.max(24,loaded.length+work.ids.size),items:ChannelPost[]=[];let next:string|null=null,head:ChannelPostPage|undefined
        do{const page:ChannelPostPage=await api.call<ChannelPostPage>('channel.posts',{channelId,...discovery,...(sourceIds?.length?{sourceIds}:{}),...(query.trim()?{query:query.trim()}:{}),saved:saved||undefined,limit:Math.min(100,Math.max(24,count-items.length)),...(next?{cursor:next}:{})});if(identity.current!==key)return;head??=page;items.push(...page.posts);next=page.nextCursor}while(next&&(items.length<count||!discovery&&!!boundary&&newestFirst(items.at(-1)!,boundary)<0))
        publish(items);end.current=next;setCursor(next);recentFeeds.delete(key);recentFeeds.set(key,{posts:head?.posts??items,cursor:head?.nextCursor??next});if(recentFeeds.size>6)recentFeeds.delete(recentFeeds.keys().next().value!)
      }else if(work.ids.size){
        const known=new Set(current.current.map(post=>post.id)),visible=new Set([...container.current?.querySelectorAll<HTMLElement>('[data-news-id]')??[]].map(node=>node.dataset.newsId)),updates=[...work.ids].filter(id=>known.has(id)&&(!visible.size||visible.has(id)))
        const changed=await Promise.all(updates.map(async id=>{try{return [id,await api.call<ChannelPost>('channel.post',{id})] as const}catch(cause){if(['Unknown news item','This news item was deleted or expired'].includes((cause as Error).message))return [id,null] as const;throw cause}}))
        if(!discovery&&[...work.ids].some(id=>!known.has(id))){const head=await api.call<ChannelPostPage>('channel.posts',{channelId,...(sourceIds?.length?{sourceIds}:{}),saved:saved||undefined,limit:24});for(const post of head.posts)changed.push([post.id,post] as const)}
        if(identity.current!==key)return
        const items=new Map(current.current.map(post=>[post.id,post])),boundary=current.current.at(-1)
        for(const [id,post] of changed){if(!post||post.channelId!==channelId||sourceIds?.length&&!sourceIds.includes(post.sourceId)||saved&&!post.saved)items.delete(id);else if(items.has(id)||!discovery&&(!end.current||!boundary||newestFirst(post,boundary)<=0))items.set(id,post)}
        publish(discovery?[...items.values()]:[...items.values()].sort(newestFirst))
      }
      if(identity.current===key)setError('')
    }catch(cause){if(identity.current===key)setError((cause as Error).message)}finally{if(identity.current===key)setLoading(false)}
  }),[channelId,query,saved,key,keepPosition])
  useEffect(()=>{identity.current=key;const previous=recentFeeds.get(key);current.current=previous?.posts??[];end.current=previous?.cursor??null;pending.current={full:true,ids:new Set()};setPosts(current.current);setCursor(end.current);setLoading(!previous);setMore(false);void refresh();let timer:ReturnType<typeof setTimeout>|undefined;const off=api.onEvent(event=>{if(event.channel!=='channel:changed')return;const change=event.payload as ChannelEvent;if(change.kind==='messages'||change.kind==='reads'||change.kind==='avatars'||change.kind==='source-order')return;if(change.channelIds&&!change.channelIds.includes(channelId))return;if(change.postIds?.length)for(const id of change.postIds)pending.current.ids.add(id);else pending.current.full=true;if(!timer)timer=setTimeout(()=>{timer=undefined;void refresh()},160)});return()=>{identity.current='';off();clearTimeout(timer)}},[channelId,key,refresh])
  const loadMore=async()=>{if(!cursor||more||loading)return;const wanted=key;setMore(true);try{const page=await api.call<ChannelPostPage>('channel.posts',{channelId,...discovery,...(sourceIds?.length?{sourceIds}:{}),...(query.trim()?{query:query.trim()}:{}),saved:saved||undefined,cursor,limit:24});if(identity.current!==wanted)return;const combined=[...current.current,...page.posts.filter(post=>!current.current.some(value=>value.id===post.id))];publish(discovery?combined:combined.sort(newestFirst));end.current=page.nextCursor;setCursor(page.nextCursor);setError('')}catch(cause){if(identity.current===wanted)setError((cause as Error).message)}finally{if(identity.current===wanted)setMore(false)}}
  const changed=useCallback((id:string,post:ChannelPost|null)=>{keepPosition();const next=current.current.flatMap(value=>value.id!==id?[value]:post&&post.channelId===channelId&&(!sourceIds?.length||sourceIds.includes(post.sourceId))&&(!saved||post.saved)?[post]:[]);current.current=next;setPosts(next)},[channelId,saved,key,keepPosition])
  return {posts,cursor,loading,more,error,refresh:(reset=false)=>{if(reset){current.current=[];end.current=null}pending.current.full=true;return refresh()},loadMore,changed}
}
