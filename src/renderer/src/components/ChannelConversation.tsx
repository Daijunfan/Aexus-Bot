import {useReadAtBottom} from '../chat/useReplyRead'
import {readingPosition,useReadingPosition} from '../chat/useReadingPosition'
import {TelegramWallpaper} from '../chat/TelegramWallpaper'
import {ChannelAdminDialog} from './ChannelAdminDialog'
import {useCatalog} from './useCatalog'
import type {SocialElement} from '../../../shared/message-categories'
import {ConversationWorkspace} from './ConversationWorkspace'
import {Fragment,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import type {ChannelPost,ChannelView,ChannelAcknowledgment} from '../../../shared/channels'
import type {Store} from '../../../shared/types'
import {api} from '../api'
import {translate as uiText,useI18n} from '../i18n'
import {MessageDate} from '../chat/MessageActions'
import {UnreadDivider} from '../chat/UnreadDivider'
import {useChannelPosts} from './useChannels'
import {useChannelReading} from './useChannelReading'
import {useMessenger} from './useMessenger'
import {ChannelAvatar,ChannelNewsCard,channelPlatform} from './ChannelNewsCard'
import {ChannelPostFeed,ChannelViewSwitch} from './ChannelPostFeed'
import {ChannelSourceTabs} from './ChannelSourceTabs'
import {ChannelProfileDialog} from './ChannelProfileDialog'
import {ChannelPostsTimeline} from './ChannelPostsTimeline'
import {ChannelPostDetail} from './ChannelPostDetail'
import type {ChannelFeedView} from './channel-post-model'
import {ChannelSourcesDialog} from './ChannelSourcesDialog'
import {Icon} from './Icon'
import {MessageMenu} from './MessageMenu'
import {usePostsZoom} from './usePostsZoom'
import {playMessageMotion} from '../chat/surfaceMotion'
import '../styles/channel-discussion.css'
import '../styles/group-message-layout.css'

export function ChannelConversation({channel,store,onBack,sourceId}:{channel:ChannelView;store:Store;onBack:()=>void;sourceId?:string}){
 useI18n()
 const [profile,setProfile]=useState<{sourceId?:string}|null>(null),[refreshing,setRefreshing]=useState(false),[accessOpen,setAccessOpen]=useState(false),[workspaceOpen,setWorkspaceOpen]=useState(false),[detailId,setDetailId]=useState<string|null>(null)
 const [options,setOptions]=useState<{x:number;y:number}|null>(null),optionsButton=useRef<HTMLButtonElement>(null),header=useRef<HTMLDivElement>(null)
 const {value:social,ready:sourcesReady}=useCatalog<SocialElement>('messenger.social',true,event=>event.channel==='channel:changed',80,{includeDisabled:true})
 const source=sourceId?social.find(item=>item.id===sourceId):undefined,title=source?.name??channel.name,displayKind=source?.platform??channel.kind,displayAvatar=sourceId?source?.avatar:channel.avatar
 useEffect(()=>{if(source&&source.channelId!==channel.id)void api.call('view.open',{kind:'messages',sourceId:source.id})},[source?.channelId,channel.id])
 const messenger=useMessenger()!,[input,setInput]=useState(''),[query,setQuery]=useState(''),[searching,setSearching]=useState(false),[saved,setSaved]=useState(false),[manager,setManager]=useState<{sourceId?:string}|null>(null),[revealed,setRevealed]=useState<ChannelPost|null>(null),[jumpError,setJumpError]=useState(''),[away,setAway]=useState(false),[markingLatest,setMarkingLatest]=useState(false),[latestError,setLatestError]=useState('')
 const latestSequence=useRef(0)
 const search=useRef<HTMLInputElement>(null),feed=useRef<HTMLDivElement>(null),following=useRef(true),positioned=useRef(false),jumping=useRef(false),jumpSequence=useRef(0),revealController=useRef<AbortController|null>(null)
 const closeSearch=()=>{setSearching(false);setInput('');setQuery('')}
 const [readPositioned,setReadPositioned]=useState(false),[unreadBoundary,setUnreadBoundary]=useState<string|null>(null),earlierRequested=useRef(false)
 const feedKey=sourceId?'source:'+sourceId:'channel:'+channel.id,savedView=messenger.channelViews[feedKey]
 const [view,setView]=useState<ChannelFeedView>(savedView?.view??'conversation'),[selectedSources,setSelectedSources]=useState<string[]>(savedView?.sourceIds??(sourceId?[sourceId]:[])),[previousSources,setPreviousSources]=useState<string[]>(savedView?.previousSourceIds??[]),viewRef=useRef<ChannelFeedView>(savedView?.view??'conversation'),viewPositions=useRef({conversation:0,board:0,posts:0}),restoreView=useRef(false)
 const zoom=usePostsZoom(feed,view==='posts',feedKey,savedView?.postsScale??1,postsScale=>messenger.rememberChannelView(feedKey,{view:viewRef.current,sourceIds:selectedSources,previousSourceIds:previousSources,postsScale}))
 const fitHeader=()=>{const node=header.current;if(!node)return;const height=node.offsetHeight+'px';if(node.parentElement?.style.getPropertyValue('--channel-header-height')!==height)node.parentElement?.style.setProperty('--channel-header-height',height)}
 useLayoutEffect(fitHeader)
 useEffect(()=>{const node=header.current;if(!node)return;const observer=new ResizeObserver(fitHeader);observer.observe(node);return()=>observer.disconnect()},[])
 useLayoutEffect(()=>{const node=feed.current;if(!node)return;const animation=playMessageMotion(node,[{opacity:.72,transform:'translateY(5px)'},{opacity:1,transform:'none'}],200);return()=>animation?.cancel()},[feedKey,view,selectedSources.join(',')])
 const availableSources=useMemo(()=>social.filter(item=>item.channelId===channel.id&&(item.enabled||item.id===sourceId)),[social,channel.id,sourceId]),selectedSourceId=selectedSources.length===1?selectedSources[0]:undefined
 const current=channel,history=useChannelPosts(channel.id,query,saved,feed,selectedSources,view),conversation='channel:'+channel.id,filtered=!!query||saved
 const timeline=useMemo(()=>[...history.posts,...(revealed&&!history.posts.some(post=>post.id===revealed.id)?[revealed]:[])].map(post=>({id:post.id,time:post.publishedAt,post})).sort((a,b)=>a.time-b.time||(a.id<b.id?-1:a.id>b.id?1:0)),[history.posts,revealed])
 const documentAlbums=useMemo(()=>{const albums=new Map<string,ChannelPost[]>();for(const entry of timeline){const post=entry.post;if(post?.telegram?.groupId&&post.files?.length){const key=post.sourceId+'/'+post.telegram.groupId;albums.set(key,[...(albums.get(key)??[]),post])}}for(const posts of albums.values())posts.sort((a,b)=>a.externalId.localeCompare(b.externalId,undefined,{numeric:true}));return albums},[timeline])
 const displayedTimeline=useMemo(()=>timeline.filter(entry=>!entry.post?.telegram?.groupId||!entry.post.files?.length||documentAlbums.get(entry.post.sourceId+'/'+entry.post.telegram.groupId)?.[0].id===entry.id),[timeline,documentAlbums])
 const postItems=useMemo(()=>timeline.flatMap(entry=>entry.post?[entry.post]:[]),[timeline])
 const reading=useChannelReading(channel.id,feed,timeline.map(entry=>entry.id),(view==='conversation'&&readPositioned||view==='posts'||view==='board'&&!detailId)&&!history.loading&&!filtered&&!searching&&!profile&&!manager&&!accessOpen&&!workspaceOpen&&!options&&!messenger.library&&!messenger.forward&&!messenger.replyTarget&&!jumping.current)
 const scopeSources=useMemo(()=>{const ids=new Set(selectedSources);return availableSources.filter(source=>ids.has(source.id))},[availableSources,selectedSources])
 const scopeSummary=selectedSources.length?{unreadCount:scopeSources.reduce((sum,source)=>sum+source.unreadCount,0),firstUnread:scopeSources.find(source=>source.firstUnread&&!timeline.some(entry=>entry.id===source.firstUnread!.id))?.firstUnread??scopeSources.find(source=>source.firstUnread)?.firstUnread}:current
 const firstUnread=timeline.find(entry=>reading.entries.get(entry.id)?.state==='unread')?.id
 const readingKey=conversation+'/timeline/'+JSON.stringify(selectedSources),savedReading=useMemo(()=>readingPosition(readingKey),[readingKey])
 const readingMemory=useReadingPosition({identity:view==='conversation'&&!filtered?readingKey:undefined,initial:savedReading,ready:sourcesReady&&!history.loading&&!history.more&&reading.ready,items:timeline,root:feed,skip:messenger.jump?.conversation===conversation,onRestore:value=>{positioned.current=true;following.current=value;setUnreadBoundary(firstUnread??null);setReadPositioned(true)}})
 const takeReadingControl=()=>{if(view!=='conversation')return;readingMemory.cancelRestore();positioned.current=true;setReadPositioned(true)}
 const dividerId=unreadBoundary??(!positioned.current?firstUnread:undefined),earlierUnread=!!scopeSummary?.firstUnread&&!timeline.some(entry=>entry.id===scopeSummary.firstUnread!.id)&&(!!history.cursor)
 const earlierCount=Math.max(0,(scopeSummary?.unreadCount??0)-timeline.filter(entry=>reading.entries.get(entry.id)?.state==='unread').length),loadingEarlier=history.more||earlierRequested.current&&!reading.ready
 const chooseSources=(ids:string[],previous=previousSources)=>{latestSequence.current++;setLatestError('');setMarkingLatest(false);setSelectedSources(ids);setPreviousSources(previous);setRevealed(null);setDetailId(null);following.current=true;positioned.current=false;setReadPositioned(false);setUnreadBoundary(null);viewPositions.current={conversation:0,board:0,posts:0};messenger.rememberChannelView(feedKey,{view,sourceIds:ids,previousSourceIds:previous});feed.current?.scrollTo({top:0,behavior:'instant'})}
 const toggleAll=()=>selectedSources.length?chooseSources([],selectedSources):chooseSources(previousSources.filter(id=>availableSources.some(source=>source.id===id)))
 useEffect(()=>{if(sourcesReady&&selectedSources.some(id=>!availableSources.some(source=>source.id===id)))chooseSources(selectedSources.filter(id=>availableSources.some(source=>source.id===id)))},[sourcesReady,availableSources])
 const refreshFeed=async()=>{if(view==='conversation'||refreshing||history.loading)return;setRefreshing(true);try{await history.refresh(true);feed.current?.scrollTo({top:0,behavior:'instant'})}finally{setRefreshing(false)}}
 const latest=()=>{following.current=true;feed.current?.scrollTo({top:feed.current.scrollHeight,behavior:'instant'});setAway(false)}
 const readLatest=async(scroll=true,passive=false)=>{
  if(scroll)latest()
  if(filtered||searching||view!=='conversation'||markingLatest||history.loading||history.more)return
  const sequence=++latestSequence.current
  setMarkingLatest(true);setLatestError('')
  try{
   const receipt=await api.call<ChannelAcknowledgment>('channel.acknowledge',{id:channel.id,all:true,...(selectedSources.length?{sourceIds:selectedSources}:{})})
   if(!receipt.acknowledged){if(passive)return;throw Error(uiText('Activate this window before marking messages as read.'))}
   if(sequence!==latestSequence.current)return
   setUnreadBoundary(null);reading.refresh()
   // A manual unread reminder is separate from the channel's real unread count.
   if(!await messenger.conversations([conversation],{unread:false}) )throw Error(uiText('Could not update the unread reminder. Try again.'))
  }catch(cause){if(sequence===latestSequence.current)setLatestError((cause as Error).message)}
  finally{if(sequence===latestSequence.current)setMarkingLatest(false)}
 }
 const bottomReadError=useReadAtBottom(feed,channel.id+'\n'+view+'\n'+selectedSources.join(','),view==='conversation'&&!filtered&&!searching&&!history.loading&&!history.more&&!profile&&!manager&&!accessOpen&&!workspaceOpen&&!options&&!detailId&&!messenger.library&&!messenger.forward&&!jumping.current&&!!(scopeSummary?.unreadCount||messenger.state.conversations[conversation]?.unread),passive=>readLatest(false,passive))
 const changeView=(next:ChannelFeedView)=>{
  if(next===viewRef.current)return
  latestSequence.current++;setLatestError('');setMarkingLatest(false)
  viewPositions.current[viewRef.current]=feed.current?.scrollTop??0;viewRef.current=next;following.current=false;restoreView.current=true;setView(next);messenger.rememberChannelView(feedKey,{view:next,sourceIds:selectedSources,previousSourceIds:previousSources});setAway(false)
 }
 useLayoutEffect(()=>{const el=feed.current;if(!restoreView.current||!el)return;restoreView.current=false;el.scrollTop=viewPositions.current[view];if(view==='conversation')setAway(el.scrollHeight-el.clientHeight-el.scrollTop>80)},[view])
 useEffect(()=>{const timer=setTimeout(()=>setQuery(input.trim()),180);return()=>clearTimeout(timer)},[input])
 useEffect(()=>{if(searching)search.current?.focus()},[searching])
 useEffect(()=>{const listener=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'&&!document.querySelector('[aria-modal="true"]')){event.preventDefault();setSearching(true);search.current?.focus()}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener)},[])
 useLayoutEffect(()=>{
  if(view!=='conversation'||!sourcesReady||history.loading||history.more||!reading.ready||readingMemory.restoring||filtered||jumping.current||messenger.jump?.conversation===conversation)return
  if(!positioned.current||earlierRequested.current){
   const target=firstUnread,marker=target&&feed.current?.querySelector<HTMLElement>(`[data-channel-unread="${CSS.escape(target)}"]`),row=target&&feed.current?.querySelector<HTMLElement>(`[data-chat-item="${CSS.escape(target)}"]`),previous=marker?marker.previousElementSibling:null,node=previous?.matches('.message-date')?previous:marker||row
   if(node&&feed.current){following.current=false;const scale=feed.current.getBoundingClientRect().height/feed.current.offsetHeight||1;feed.current.scrollTop+=(node.getBoundingClientRect().top-feed.current.getBoundingClientRect().top)/scale-(header.current?.offsetHeight??0);setUnreadBoundary(target!);setAway(feed.current.scrollHeight-feed.current.clientHeight-feed.current.scrollTop>80)}else if(!positioned.current)latest()
   earlierRequested.current=false;positioned.current=true;setReadPositioned(true)
  }else if(following.current)latest()
 },[view,timeline,sourcesReady,history.loading,history.more,reading.ready,readingMemory.restoring,firstUnread,filtered,messenger.jump])
 useEffect(()=>{const el=feed.current;if(!el||view!=='conversation')return;const observer=new ResizeObserver(()=>{if(following.current&&!jumping.current)latest()});observer.observe(el);return()=>observer.disconnect()},[view])
 useEffect(()=>()=>{latestSequence.current++;jumpSequence.current++;revealController.current?.abort();messenger.setJump(previous=>previous?.conversation===conversation?null:previous)},[conversation,messenger.setJump])
 const reveal=async(id:string)=>{
  setDetailId(null);chooseSources([]);changeView('conversation')
  const sequence=++jumpSequence.current;revealController.current?.abort();const controller=new AbortController();revealController.current=controller;following.current=false;jumping.current=true;setJumpError('');setInput('');setQuery('');setSaved(false)
  try{
   {const post=await api.call<ChannelPost>('channel.post',{id});if(sequence!==jumpSequence.current)return;if(post.channelId!==channel.id){void messenger.navigate({conversation:'channel:'+post.channelId,id});return}setRevealed(post)}
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
   if(sequence!==jumpSequence.current)return
   const node=feed.current?.querySelector<HTMLElement>(`[data-chat-item="${CSS.escape(id)}"]`)
   if(node){node.scrollIntoView({block:'center',behavior:'instant'});positioned.current=true;setReadPositioned(true);node.dataset.messageJump='true';setTimeout(()=>{if(node.isConnected)delete node.dataset.messageJump},2400)}
  }catch(cause){if(sequence===jumpSequence.current)setJumpError((cause as Error).message)}finally{if(sequence===jumpSequence.current)jumping.current=false}
 }
 useEffect(()=>{const target=messenger.jump;if(target?.conversation!==conversation)return;void reveal(target.id).finally(()=>messenger.setJump(previous=>previous===target?null:previous))},[messenger.jump,conversation])
 const changed=(id:string,post:ChannelPost|null)=>{history.changed(id,post);setRevealed(previous=>previous?.id===id?post:previous)}
 const loadEarlierUnread=async()=>{earlierRequested.current=true;following.current=false;setReadPositioned(false);if(history.cursor)await history.loadMore()}
 const loadEarlier=()=>{if(view!=='conversation'||!positioned.current||jumping.current||!history.cursor||history.loading||history.more||history.error)return;following.current=false;void history.loadMore()}
 return <section className={'message-conversation channel-conversation'+(current.engine?.kind==='external'&&current.engine.fileStorage?' telegram-document-channel':'')} data-feed-view={view} aria-label={uiText('Channel {0}',[title])}>
  <TelegramWallpaper className="channel-wallpaper" settings={store.preferences?.messageWallpaper} dark={['black','space','midnight'].includes(store.preferences?.viewAppearance?.messages?.theme??store.preferences?.theme??'')}/>
  <div ref={header} className="channel-reader-header">
  <header className="message-thread-header"><button className="message-back" aria-label={uiText('Back to conversations')} onClick={onBack}><Icon name="arrow-left"/></button><div className="message-person channel-person"><button type="button" className="channel-header-avatar" aria-label={uiText('Channel information')} onClick={()=>setProfile({})}><ChannelAvatar kind={channel.kind} avatar={channel.avatar} name={channel.name}/></button><span><strong>{channel.name}</strong><small>{uiText('{0} sources',[current.sourceCount])}</small></span></div><ChannelViewSwitch value={view} onChange={changeView}/><div className="message-thread-actions"><button aria-label={uiText('Search channel')} aria-pressed={searching} title={uiText('Search channel')} onClick={()=>searching?closeSearch():setSearching(true)}><Icon name="search"/></button><button aria-label={uiText('Saved articles')} aria-pressed={saved} title={uiText('Saved articles')} onClick={()=>{setSaved(!saved);setRevealed(null);following.current=true}}><Icon name="bookmark"/></button><button ref={optionsButton} aria-label={uiText('Channel options')} title={uiText('Channel options')} aria-haspopup="menu" aria-expanded={!!options} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();setOptions(options?null:{x:box.right-256,y:box.bottom+8})}}><Icon name={refreshing?'loading':'settings-gear'}/></button></div></header>
  {availableSources.length>0&&<ChannelSourceTabs channelId={channel.id} sources={availableSources} values={selectedSources} onChange={chooseSources} onAll={toggleAll} onAuthor={id=>setProfile({sourceId:id})}/>}
  {view==='conversation'&&!filtered&&earlierUnread&&<div className="channel-earlier-unread"><span><Icon name="mail"/>{uiText(scopeSummary?.unreadCount===1?'{0} unread update':'{0} unread updates',[scopeSummary?.unreadCount??0])}</span><button disabled={loadingEarlier||!reading.ready} onClick={()=>void loadEarlierUnread()}>{uiText(loadingEarlier?'Loading…':'Load earlier unread ({0})',[earlierCount||(scopeSummary?.unreadCount??0)])}<Icon name="arrow-up"/></button></div>}
  {searching&&<label className="channel-feed-search"><Icon name="search"/><input ref={search} value={input} aria-label={uiText('Search channel articles')} placeholder={uiText('Search articles…')} onChange={event=>{setInput(event.target.value);setRevealed(null);following.current=true}} onKeyDown={event=>{if(event.key==='Escape')closeSearch()}}/><button aria-label={uiText('Close search')} onClick={closeSearch}><Icon name="close"/></button></label>}
  {(history.error||reading.error||jumpError||latestError||bottomReadError.error)&&<p className="channel-inline-error" role="alert"><span>{uiText(history.error||reading.error||jumpError||latestError||bottomReadError.error)}</span><button onClick={()=>{if(latestError)void readLatest();else{void history.retry();reading.refresh()}}}>{uiText('Retry')}</button></p>}
  </div>
  <div className={'channel-feed '+(view==='board'?'channel-post-feed':view==='posts'?'channel-posts-timeline-feed':'channel-timeline group-transcript')} ref={feed} data-reading-key={view==='conversation'&&!filtered?readingKey:undefined} tabIndex={0} aria-label={uiText('Channel messages')} aria-busy={history.loading} onPointerDown={takeReadingControl} onTouchMove={event=>{if(event.touches.length===1)takeReadingControl()}} onKeyDown={event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)){takeReadingControl();if(['ArrowUp','PageUp','Home'].includes(event.key))following.current=false;else if(event.key==='End')following.current=true}}} onWheel={event=>{if(view==='conversation'&&event.deltaY){takeReadingControl();if(event.deltaY<0){following.current=false;if((feed.current?.scrollTop??Infinity)<120)loadEarlier()}}}} onScroll={event=>{if(view!=='conversation')return;const el=event.currentTarget,gap=el.scrollHeight-el.clientHeight-el.scrollTop;if(positioned.current&&!jumping.current)following.current=gap<5;setAway(gap>80);readingMemory.remember();if(el.scrollTop<120)loadEarlier()}}>
   {view==='conversation'&&history.cursor&&<div className="channel-earlier"><button className="channel-load-more" disabled={history.loading||history.more} onClick={()=>{following.current=false;void history.loadMore()}}>{uiText(history.more?'Loading…':'Load earlier articles')}</button></div>}
   {!(view==='conversation'?timeline.length:history.posts.length)&&<div className="channel-feed-empty"><ChannelAvatar kind={displayKind} avatar={displayAvatar} name={title} social={!!sourceId}/><h2>{uiText(history.loading?'Loading articles…':query?'No matching articles':saved?'Save something worth keeping':'Your next discovery starts here')}</h2><p>{uiText(query?'Try another phrase.':saved?'Save an article to keep a local copy.':'New articles from your followed authors will appear here.')}</p>{!history.loading&&!saved&&!query&&<button onClick={()=>setManager({})}><Icon name="person"/>{uiText('Manage authors')}</button>}</div>}
   {view==='posts'&&<ChannelPostsTimeline scrollRef={feed} posts={history.posts} sourceAvatar={channel.avatar} loading={history.loading||history.more} canLoadMore={!!history.cursor} onMore={()=>void history.loadMore()} onRefresh={()=>void refreshFeed()} onChanged={changed} onAuthor={sourceId=>setProfile({sourceId})}/>}
   {view==='board'&&postItems.length>0&&<ChannelPostFeed posts={postItems} sourceAvatar={channel.avatar} onOpen={post=>setDetailId(post.id)} onAuthor={sourceId=>setProfile({sourceId})} onChanged={changed}/>}
   {view==='board'&&history.cursor&&<button className="channel-load-more" disabled={history.loading||history.more} onClick={()=>void history.loadMore()}>{uiText(history.more?'Loading…':'Load earlier articles')}</button>}
   {view==='conversation'&&displayedTimeline.map((entry,index)=><Fragment key={entry.id}>{(!index||new Date(displayedTimeline[index-1].time).toDateString()!==new Date(entry.time).toDateString())&&<MessageDate value={entry.time}/>}{entry.id===(earlierRequested.current?firstUnread:dividerId)&&<div data-channel-unread={entry.id}><UnreadDivider/></div>}<div className="channel-news-item" data-chat-item={entry.id}><ChannelNewsCard post={entry.post} album={entry.post.telegram?.groupId?documentAlbums.get(entry.post.sourceId+'/'+entry.post.telegram.groupId):undefined} sourceAvatar={channel.avatar} onAuthor={sourceId=>setProfile({sourceId})} onChanged={next=>changed(entry.id,next)}/><span className="reply-seen-marker" data-channel-read={entry.id} aria-hidden="true"/></div></Fragment>)}
  </div>
  <div className="channel-reader-controls" hidden={view!=='conversation'}>
  {(away||markingLatest||!!latestError)&&<button className="channel-jump-latest" disabled={markingLatest||history.loading||history.more} aria-busy={markingLatest||history.loading||history.more} aria-label={uiText('Latest messages')} title={uiText('Latest messages')} onClick={()=>void readLatest()}><Icon name={markingLatest?'loading':'arrow-down'}/></button>}
  {filtered&&<div className="channel-filter-note"><button onClick={()=>{setInput('');setQuery('');setSaved(false);following.current=true}}><Icon name="arrow-left"/>{uiText('Back to channel conversation')}</button></div>}

  </div>
  {view==='board'&&detailId&&<ChannelPostDetail key={detailId} id={detailId} channelId={channel.id} sourceId={selectedSourceId} sourceAvatar={channel.avatar} blocked={!!profile||!!manager||accessOpen||workspaceOpen||!!messenger.library||!!messenger.forward||!!messenger.replyTarget} onClose={()=>setDetailId(null)} onChanged={post=>changed(detailId,post)} onAuthor={sourceId=>setProfile({sourceId})}/>}
  {options&&<MessageMenu anchor={options} trigger={optionsButton.current} label={uiText('Channel options')} className="channel-options-menu" onClose={()=>setOptions(null)}>
   <span className="messenger-menu-label">{channel.name}</span>
   {view!=='conversation'&&<button role="menuitem" disabled={history.loading||refreshing} onClick={()=>{setOptions(null);void refreshFeed()}}><Icon name="refresh"/>{uiText(view==='board'?'Refresh board':'Refresh posts')}</button>}
   <button role="menuitemcheckbox" aria-checked={saved} onClick={()=>{setOptions(null);setSaved(!saved);setRevealed(null);following.current=true}}><Icon name="bookmark"/>{uiText('Saved articles')}</button>
   <button role="menuitem" onClick={()=>{setOptions(null);setWorkspaceOpen(true)}}><Icon name="cloud-download"/>{uiText('Downloaded files')}</button>
   {view==='posts'&&<div className="channel-posts-zoom" role="group" aria-label={uiText('Posts size')}><span>{uiText('Posts size')}</span><button aria-label={uiText('Zoom out posts')} disabled={zoom.value<=.5} onClick={()=>zoom.change(zoom.value-.1)}><Icon name="zoom-out"/></button><button aria-label={uiText('Reset posts size')} title={uiText('Pinch to resize posts')} onClick={()=>zoom.change(1)}>{Math.round(zoom.value*100)}%</button><button aria-label={uiText('Zoom in posts')} disabled={zoom.value>=2} onClick={()=>zoom.change(zoom.value+.1)}><Icon name="zoom-in"/></button></div>}
   <hr/>
   <button role="menuitem" onClick={()=>{setOptions(null);setManager({})}}><Icon name="list-selection"/>{uiText('Manage channels and authors')}</button>
   <button role="menuitem" onClick={()=>{setOptions(null);setAccessOpen(true)}}><Icon name="person-add"/>{uiText('Channel access')}</button>
   <button role="menuitem" onClick={()=>{setOptions(null);setProfile({})}}><Icon name="info"/>{uiText('Channel information')}</button>
  </MessageMenu>}
  {accessOpen&&<ChannelAdminDialog channel={channel} store={store} onClose={()=>setAccessOpen(false)} onSaved={()=>{}}/>}
  {workspaceOpen&&<ConversationWorkspace channelDownloads conversation={conversation} onClose={()=>setWorkspaceOpen(false)}/>}
  {profile&&<ChannelProfileDialog sourceId={profile.sourceId} channel={channel} onClose={()=>setProfile(null)} onManage={()=>{setManager({sourceId:profile.sourceId});setProfile(null)}}/>}
  {manager&&<ChannelSourcesDialog channelId={channel.id} sourceId={manager.sourceId} onClose={()=>{setManager(null);setRevealed(null)}}/>}
 </section>
}
