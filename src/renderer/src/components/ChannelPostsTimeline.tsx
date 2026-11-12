import {useEffect,useRef,type RefObject} from 'react'
import {MessageViewport,type MessageViewportHandle} from '../chat/MessageViewport'
import type {ChannelPost,ChannelView} from '../../../shared/channels'
import {ChannelNewsCard} from './ChannelNewsCard'
import {translate as uiText} from '../i18n'

/** One refresh has a stable cursor; arriving items never reshuffle a reader's current scroll. */
export function ChannelPostsTimeline({posts,scrollRef,sourceAvatar,loading,canLoadMore,onMore,onRefresh,onChanged,onAuthor}:{posts:ChannelPost[];scrollRef:RefObject<HTMLDivElement|null>;sourceAvatar?:ChannelView['avatar'];loading:boolean;canLoadMore:boolean;onMore:()=>void;onRefresh:()=>void;onChanged:(id:string,post:ChannelPost|null)=>void;onAuthor:(id:string)=>void}){
 const viewport=useRef<MessageViewportHandle|null>(null)
 const sentinel=useRef<HTMLDivElement>(null),touch=useRef<number|null>(null)
 useEffect(()=>{const node=sentinel.current;if(!node||loading||!canLoadMore)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))onMore()},{rootMargin:'500px'});observer.observe(node);return()=>observer.disconnect()},[loading,canLoadMore,posts.length])
 return <div className="channel-posts-timeline" onTouchStart={event=>{const scroll=event.currentTarget.parentElement;touch.current=event.touches.length===1&&scroll&&scroll.scrollTop<5?event.touches[0].clientY:null}} onTouchCancel={()=>{touch.current=null}} onTouchEnd={event=>{if(touch.current!==null&&!loading&&event.changedTouches[0].clientY-touch.current>75)onRefresh();touch.current=null}}>
  <MessageViewport items={posts} scrollRef={scrollRef} apiRef={viewport} enabled renderAllBelow={80} following={()=>false} onProgrammaticScroll={()=>{}} renderItem={post=><div className="channel-posts-item" data-chat-item={post.id} key={post.id}><ChannelNewsCard postMode post={post} sourceAvatar={sourceAvatar} onChanged={value=>onChanged(post.id,value)} onAuthor={onAuthor}/><span className="reply-seen-marker" data-channel-read={post.id} aria-hidden="true"/></div>}/>
  <div ref={sentinel} className="channel-posts-sentinel">{loading?<span>{uiText('Loading…')}</span>:canLoadMore?<button onClick={onMore}>{uiText('Load more posts')}</button>:posts.length>0?<span>{uiText('You are all caught up. Refresh for a new mix.')}</span>:null}</div>
 </div>
}
