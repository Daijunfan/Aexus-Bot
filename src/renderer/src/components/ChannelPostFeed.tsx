import {formatMessageDateTime} from '../message-time'
import {useLayoutEffect,useMemo,useRef} from 'react'
import type {ChannelPost,ChannelView} from '../../../shared/channels'
import {translate as uiText,useI18n,interfaceLocale} from '../i18n'
import {ChannelAvatar,ChannelImage,channelPlatform} from './ChannelNewsCard'
import {newestPosts,postExcerpt,postPhotos,type ChannelFeedView} from './channel-post-model'
import {Icon} from './Icon'
import {ChannelPostActions} from './ChannelPostActions'
import '../styles/channel-posts.css'

export function ChannelViewSwitch({value,onChange}:{value:ChannelFeedView;onChange:(value:ChannelFeedView)=>void}){
 return <div className="channel-view-switch" role="group" aria-label={uiText('Channel display')}>
  <button type="button" aria-label={uiText('Channel view')} title={uiText('Channel view')} aria-pressed={value==='conversation'} onClick={()=>onChange('conversation')}><Icon name="comment-discussion"/><span>{uiText('Channel')}</span></button>
  <button type="button" aria-label={uiText('Board view')} title={uiText('Board view')} aria-pressed={value==='board'} onClick={()=>onChange('board')}><Icon name="layout"/><span>{uiText('Board')}</span></button>
  <button type="button" aria-label={uiText('Posts view')} aria-pressed={value==='posts'} onClick={()=>onChange('posts')}><Icon name="list-flat"/><span>{uiText('Posts')}</span></button>
 </div>
}

export function ChannelPostFeed({posts,sourceAvatar,onOpen,onAuthor,onChanged}:{posts:readonly ChannelPost[];sourceAvatar?:ChannelView['avatar'];onOpen:(post:ChannelPost)=>void;onAuthor:(id:string)=>void;onChanged:(id:string,post:ChannelPost|null)=>void}){
 useI18n()
 const shown=useMemo(()=>newestPosts(posts),[posts]),grid=useRef<HTMLDivElement>(null)
 // Row-first masonry keeps chronological DOM/keyboard order, unlike CSS columns.
 useLayoutEffect(()=>{
  const root=grid.current;if(!root)return
  const fit=(card:HTMLElement)=>{const row=card.parentElement;if(row)row.style.gridRowEnd='span '+Math.ceil(card.getBoundingClientRect().height+16)}
  const observer=new ResizeObserver(entries=>{for(const entry of entries)fit(entry.target as HTMLElement)})
  for(const card of root.querySelectorAll<HTMLElement>('.channel-post-content')){fit(card);observer.observe(card)}
  return()=>observer.disconnect()
 },[shown])
 return <div className="channel-post-browser">
  <div ref={grid} className="channel-post-grid" role="list" aria-label={uiText('Board')}>
   {shown.map(post=><ChannelPostCard key={post.id} post={post} sourceAvatar={sourceAvatar} onOpen={()=>onOpen(post)} onAuthor={()=>onAuthor(post.sourceId)} onChanged={value=>onChanged(post.id,value)}/>)}
  </div>
 </div>
}

function ChannelPostCard({post,sourceAvatar,onOpen,onAuthor,onChanged}:{post:ChannelPost;sourceAvatar?:ChannelView['avatar'];onOpen:()=>void;onAuthor:()=>void;onChanged:(post:ChannelPost|null)=>void}){
 const photos=postPhotos(post),cover=photos[0],text=postExcerpt(post.body),author=post.authorName||post.sourceName,identity=post.sourceAvatar??sourceAvatar,heading=post.title||(cover?text:''),date=new Date(post.publishedAt)
 return <article className="channel-post-card" role="listitem" data-news-id={post.id} data-platform={post.plugin} data-source-key={post.plugin+':'+post.sourceId}>
  <div className="channel-post-content"><button type="button" className="channel-post-open" onClick={onOpen} aria-label={uiText('Open post from {0}: {1}',[author,post.title||text.slice(0,90)||uiText('Photos')])}>
   <div className={'channel-post-cover'+(cover?'':' is-text')}>
    {cover?<ChannelImage channelId={post.channelId} postId={post.id} mediaId={cover.id} alt={cover.name}/>:<div className="channel-post-text"><p>{text||post.title}</p></div>}
    {cover&&post.plugin==='youtube'&&<span className="channel-post-play" aria-hidden="true"><Icon name="play"/></span>}
    {photos.length>1&&<span className="channel-post-album" aria-label={uiText('{0} photos',[photos.length])}><Icon name="files"/>{photos.length}</span>}
    {post.saved&&<span className="channel-post-saved" title={uiText('Saved')} aria-label={uiText('Saved')}><Icon name="bookmark"/></span>}
   </div>
   {cover&&heading&&<div className="channel-post-details"><h3>{heading}</h3></div>}
  </button>
  <button type="button" className="channel-post-author" aria-label={uiText('Author information {0}',[author])} onClick={onAuthor}><span className="channel-author-avatar">{post.plugin!=='telegram'&&post.avatarMediaId?<ChannelImage channelId={post.channelId} postId={post.id} mediaId={post.avatarMediaId} alt="" maxEdge={96}/>:<ChannelAvatar social kind={post.plugin} avatar={identity?.sourceId===post.sourceId?identity:undefined} name={author}/>}</span><span>{author}</span></button>
  <div className="channel-post-meta"><span>{channelPlatform(post.plugin)}</span><time dateTime={date.toISOString()} title={formatMessageDateTime(post.publishedAt,true)}>{date.toLocaleDateString(interfaceLocale(),{month:'short',day:'numeric'})}</time></div><span className="reply-seen-marker" data-channel-read={post.id} aria-hidden="true"/><ChannelPostActions post={post} onChanged={onChanged} onAuthor={onAuthor}/>
  </div>
 </article>
}
