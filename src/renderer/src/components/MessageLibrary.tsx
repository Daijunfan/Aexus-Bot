import type {Store} from '../../../shared/types'
import type {ChatGroupView} from '../../../shared/chat-groups'
import type {CSSProperties} from 'react'
import {GROUP_COLORS,groupDetails} from '../../../shared/group-collaboration'
import {GroupAvatar} from './GroupAvatar'
import '../styles/group-surfaces.css'
import {formatMessageDateTime} from '../message-time'
import {AppSelect} from './AppSelect'
import {useReadingPosition} from './useReadingPosition'
import type {ChannelEvent} from '../../../shared/channels'
import {ChannelNewsCard} from './ChannelNewsCard'
import {ChannelSourcesDialog} from './ChannelSourcesDialog'
import {MessageFile} from '../chat/MessageAttachments'
import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {useEffect,useRef,useState,useMemo} from 'react'
import {useMessenger} from './useMessenger'
import {Icon} from './Icon'
import {MessageWorkspace,MessageWorkspaceNav} from './MessageWorkspace'
import {ConversationSharedFiles} from './ConversationSharedFiles'
import {api} from '../api'
import {uploadBrowserFile} from '../web/files'
import {createRefreshQueue} from '../snapshot'
import {MessageImages,MessageGalleryContext} from '../chat/MessageImage'
import {messageLinks,plainMessagePreview,type MessengerMessage,type MessengerResults} from '../../../shared/messenger'

export function MessageLibrary({store}:{store:Store}){
  useI18n()

 const [uploading,setUploading]=useState(false)
 const [groupInfo,setGroupInfo]=useState<ChatGroupView|null>(null),filePicker=useRef<HTMLInputElement>(null)
 const messenger=useMessenger()!,config=messenger.library!
 const [query,setQuery]=useState(config.query??''),[filter,setFilter]=useState(config.filter??'all'),[author,setAuthor]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[topicId,setTopicId]=useState(config.topicId??''),[topics,setTopics]=useState<{id:string;name:string}[]>([]),[advanced,setAdvanced]=useState(!!config.topicId),[results,setResults]=useState<MessengerResults>({messages:[],total:0,hasMore:false}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[windowSize,setWindowSize]=useState(40)
 const managedFiles=filter==='files'&&!!config.conversation?.startsWith('group:')
 const authorArgs=['all','you','employee'].includes(author)?{author}:{author:'all',authorId:author},scopeArgs={...authorArgs,...(topicId?{topicId}:{}),...(from?{from:new Date(from+'T00:00:00').getTime()}:{}),...(to?{to:new Date(to+'T23:59:59.999').getTime()}:{} )}
 const queryKey=JSON.stringify([config.conversation,query,filter,author,from,to,topicId]),[resultKey,setResultKey]=useState(''),[retry,setRetry]=useState(0)
 const galleryImages=useMemo(()=>results.messages.filter(message=>!message.news).flatMap(message=>message.images.map(path=>({...(message.conversation.startsWith('employee:')?{employee:message.conversation.slice(9)}:message.conversation.startsWith('channel:')?{channel:message.conversation.slice(8)}:{group:message.conversation.slice(6)}),path,messageId:message.id,caption:message.text}))),[results.messages])
 const search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),[sourceId,setSourceId]=useState<string|null>(null),snapshot=useRef({key:'',value:results}),keepPosition=useReadingPosition(list,results)
 const failed=useRef(false),pageSize=useRef(windowSize),requestRefresh=useRef<()=>void>(()=>{});pageSize.current=windowSize
 useEffect(()=>{
  if(managedFiles)return
  let timer:ReturnType<typeof setTimeout>|undefined
  const off=api.onEvent(event=>{
   if(event.channel==='channel:changed'){
    const change=event.payload as ChannelEvent
    if(change.kind==='reads')return
    if(config.conversation&&!config.conversation.startsWith('channel:'))return
    if(change.kind!=='messages'&&(author!=='all'||!['all','saved','media','links'].includes(filter)))return
    if(config.conversation&&change.channelIds&&!change.channelIds.includes(config.conversation.slice(8)))return
   }else if(event.channel==='chat:changed'){
    if(event.payload.messageId&&!event.payload.editedMessageId)return // Receipt-only updates do not change searchable content.
    if(config.conversation&&config.conversation!=='group:'+event.payload.id)return
   }else if(['session:user','session:turn-end','session:interrupted','session:error'].includes(event.channel)){
    // Private events identify a live session, not its employee. Keep the search's employee scope.
    if(config.conversation&&!config.conversation.startsWith('employee:'))return
   }else return
   if(!timer)timer=setTimeout(()=>{timer=undefined;setRetry(value=>value+1)},80)
  })
  return()=>{off();clearTimeout(timer)}
 },[config.conversation,author,filter,managedFiles])
 useEffect(()=>{
  if(managedFiles){setLoading(false);setError('');return}
  failed.current=false
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined
  // Events queue one trailing pass instead of cancelling a slow search before it can publish.
  const refresh=createRefreshQueue(async()=>{
   if(!alive||failed.current)return
   const prior=snapshot.current.key===queryKey?snapshot.current.value.messages:[],boundary=prior.at(-1),count=Math.max(pageSize.current,prior.length),messages:MessengerMessage[]=[];let value:MessengerResults
   if(snapshot.current.key!==queryKey||pageSize.current>prior.length&&snapshot.current.value.hasMore)setLoading(true)
   try{
    const before=(message:MessengerMessage,tail:MessengerMessage)=>(tail.createdAt??0)-(message.createdAt??0)||message.conversation.localeCompare(tail.conversation)||message.id.localeCompare(tail.id)
    do{value=await api.call<MessengerResults>('messenger.search',{conversation:config.conversation,query,filter,...scopeArgs,offset:messages.length,limit:Math.min(100,Math.max(40,count-messages.length))});if(!alive)return;messages.push(...value.messages)}while(value.hasMore&&(messages.length<count||!!boundary&&!!messages.length&&before(messages.at(-1)!,boundary)<0&&!messages.some(message=>message.id===boundary.id&&message.conversation===boundary.conversation)))
    const next={...value,messages};keepPosition();snapshot.current={key:queryKey,value:next};setResults(next);setResultKey(queryKey);setError('')
   }catch(cause){if(alive){failed.current=true;setError((cause as Error).message)}}finally{if(alive)setLoading(false)}
  })
  const request=()=>{if(!timer)void refresh()};requestRefresh.current=request
  setLoading(true);timer=setTimeout(()=>{timer=undefined;void refresh()},snapshot.current.key===queryKey?0:150)
  return()=>{alive=false;clearTimeout(timer);if(requestRefresh.current===request)requestRefresh.current=()=>{}}
 },[config.conversation,query,filter,author,queryKey,keepPosition,managedFiles])
 useEffect(()=>requestRefresh.current(),[windowSize,messenger.state.revision,retry])
 useEffect(()=>{search.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('[aria-modal="true"],[role="menu"]')){event.preventDefault();event.stopImmediatePropagation();messenger.setLibrary(null)}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[messenger.setLibrary])
 useEffect(()=>{let alive=true;setGroupInfo(null);if(config.conversation?.startsWith('group:'))void api.call<ChatGroupView>('chat.get',{id:config.conversation.slice(6)}).then(value=>{if(alive)setGroupInfo(value)}).catch(()=>{});return()=>{alive=false}},[config.conversation])
 useEffect(()=>{let alive=true;if(config.conversation?.startsWith('group:')&&groupInfo&&!groupInfo.bot)void api.call<{id:string;name:string}[]>('chat.topic-list',{id:config.conversation.slice(6)}).then(value=>{if(alive)setTopics(value)}).catch(()=>{});return()=>{alive=false}},[config.conversation,!!groupInfo,groupInfo?.bot])
 const shareFiles=async(files:File[])=>{if(uploading||!files.length||!config.conversation?.startsWith('group:')||groupInfo?.bot)return;setUploading(true);setError('');try{for(const file of files)await uploadBrowserFile(api,file,{conversation:config.conversation,path:'.'});setRetry(value=>value+1)}catch(cause){setError((cause as Error).message)}finally{setUploading(false)}}

 const reveal=async(conversation:string,id:string)=>{const [kind,target]=conversation.split(':');await api.call('view.open',{kind:'messages',...(kind==='group'?{chatId:target}:kind==='channel'?{channelId:target}:{employee:target})});messenger.setJump({conversation,id});messenger.setLibrary(null)}
 const open=async(message:MessengerMessage)=>{try{await reveal(message.news?'channel:'+message.news.channelId:message.conversation,message.id)}catch(cause){setError((cause as Error).message)}}
 const contentTypes=[['all','All','comment-discussion'],['media','Media','file-media'],['audio','Audio','unmute'],['files','Files','file-text'],['links','Links','link'],['saved','Saved','bookmark'],['pinned','Pinned','pinned']]
 const contentTitle=uiText(filter==='saved'?'Saved messages':filter==='pinned'?'Pinned messages':filter==='media'?'Shared media':filter==='audio'?'Shared audio':filter==='files'?'Shared files':filter==='links'?'Shared links':'Find a message')
 return <MessageWorkspace className="message-library" data-content-filter={filter} style={groupInfo&&!groupInfo.bot?{'--group-accent':GROUP_COLORS[groupDetails(groupInfo.details,groupInfo.id).color]} as CSSProperties:undefined} title={contentTitle} subtitle={groupInfo?.name??uiText(config.conversation?'In this conversation':'Across your team')} busy={uploading} onDragOver={event=>{if(managedFiles&&!groupInfo?.bot){event.preventDefault();event.dataTransfer.dropEffect='copy'}}} onDrop={event=>{if(managedFiles&&!groupInfo?.bot){event.preventDefault();void shareFiles([...event.dataTransfer.files])}}} label={uiText(config.conversation?'Conversation content':'Search and saved messages')} icon={groupInfo&&!groupInfo.bot?<GroupAvatar group={groupInfo} store={store}/>:contentTypes.find(item=>item[0]===filter)?.[2]} closeLabel={uiText('Close message library')} onClose={()=>messenger.setLibrary(null)} scroll={false} initialFocus=".message-library-search input" navigation={<MessageWorkspaceNav className="message-library-tabs" label={uiText('Message type')} value={filter} items={contentTypes.map(([id,label,icon])=>({id,label:uiText(label),icon}))} onChange={id=>{setFilter(id);setWindowSize(40)}}/>}>
  <label className="message-library-search"><Icon name="search"/><input ref={search} value={query} aria-label={uiText(managedFiles?"Search shared files":"Search full message history")} placeholder={uiText(managedFiles?"Search files by name…":"Search all message history…")} onChange={event=>{setQuery(event.target.value);setWindowSize(40)}}/>{query&&<button aria-label={uiText("Clear history search")} onClick={()=>{setQuery('');setWindowSize(40)}}><Icon name="close"/></button>}</label>
  <input ref={filePicker} type="file" multiple hidden disabled={uploading} aria-label={uiText('Choose files to share')} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void shareFiles(files)}}/>
  {groupInfo&&!groupInfo.bot&&<div className="group-library-filter-bar"><button aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><Icon name="filter"/>{uiText('Filters')}{(topicId||from||to)&&<i/>}</button>{(topicId||from||to)&&<button onClick={()=>{setTopicId('');setFrom('');setTo('');setAuthor('all')}}>{uiText('Reset')}</button>}</div>}
  {advanced&&<div className="group-library-filters"><label>{uiText('Topic')}<AppSelect aria-label={uiText('Filter by topic')} value={topicId} onChange={event=>{setTopicId(event.target.value);setWindowSize(40)}}><option value="">{uiText('All topics')}</option>{topics.map(topic=><option key={topic.id} value={topic.id}>{topic.id==='general'&&topic.name==='General'?uiText('General'):topic.name}</option>)}</AppSelect></label><label>{uiText('From date')}<input type="date" aria-label={uiText('From date')} value={from} max={to||undefined} onChange={event=>{setFrom(event.target.value);setWindowSize(40)}}/></label><label>{uiText('To date')}<input type="date" aria-label={uiText('To date')} value={to} min={from||undefined} onChange={event=>{setTo(event.target.value);setWindowSize(40)}}/></label></div>}
  {!managedFiles&&<div className="message-library-summary"><span role="status">{loading?uiText("Searching…"):uiText(results.total===1?'{0} message':'{0} messages',[results.total])}</span><AppSelect aria-label={uiText("Filter message author")} value={author} onChange={event=>{setAuthor(event.target.value);setWindowSize(40)}}><option value="all">{uiText("Everyone")}</option><option value="you">{uiText("From you")}</option><option value="employee">{uiText("From teammates")}</option>{groupInfo?.members.map(member=><option key={member.id} value={member.id}>{member.title}</option>)}</AppSelect></div>}
  {error&&<p className="message-list-error" role="alert">{error} <button onClick={()=>{failed.current=false;setRetry(value=>value+1)}}>{uiText("Retry search")}</button></p>}
  {managedFiles?<ConversationSharedFiles conversation={config.conversation!} onShare={groupInfo&&!groupInfo.bot?()=>filePicker.current?.click():undefined} filters={scopeArgs} senders={groupInfo?.members} query={query} author={author} onAuthor={setAuthor} onMessage={id=>reveal(config.conversation!,id)}/>:<MessageGalleryContext.Provider value={{images:galleryImages,history:{conversation:config.conversation,query,...scopeArgs,author:scopeArgs.author as 'all'|'you'|'employee',order:'newest'}}}><div ref={list} inert={resultKey!==queryKey} aria-busy={loading} className={`message-library-results ${filter==='media'?'media-grid':''}`}>
   {results.messages.map(message=>message.news?<ChannelNewsCard key={message.id} post={message.news} onAuthor={setSourceId} onReveal={()=>void open(message)} onChanged={next=>{keepPosition();setResults(previous=>({...previous,total:next?previous.total:previous.total-1,messages:previous.messages.flatMap(value=>value.id!==message.id?[value]:next?[{...value,news:next}]:[])}));setRetry(value=>value+1)}}/>:<article key={message.conversation+'/'+message.id} data-message-key={message.conversation+'/'+message.id} className="message-result">
    {filter==='media'&&<MessageImages {...(message.conversation.startsWith('employee:')?{employee:message.conversation.slice(9)}:message.conversation.startsWith('channel:')?{channel:message.conversation.slice(8)}:{group:message.conversation.slice(6)})} paths={message.images} messageId={message.id} caption={message.text}/>}
    {filter==='media'&&message.files?.filter(file=>file.mimeType.startsWith('video/')).map(file=><MessageFile messageId={message.id} key={file.path} conversation={message.conversation} file={file}/>)}
    {filter==='audio'&&message.files?.filter(file=>file.mimeType.startsWith('audio/')).map(file=><MessageFile messageId={message.id} key={file.path} conversation={message.conversation} file={file}/>)}
    {filter==='files'&&message.files?.map(file=><MessageFile messageId={message.id} key={file.path} conversation={message.conversation} file={file}/>)}
    {filter==='links'&&messageLinks(message.text).map(({url,host})=><button key={url} className="message-shared-link" onClick={()=>void api.call('external.open',{url}).catch(cause=>setError(cause.message))}><span><Icon name="link"/></span><span><strong>{host}</strong><small>{url}</small></span><Icon name="arrow-up-right"/></button>)}
    <button className="message-result-open" onClick={()=>void open(message)}><span><strong>{message.conversationTitle}</strong><time>{message.createdAt?new Date(message.createdAt).toLocaleDateString(interfaceLocale(),{month:'short',day:'numeric'}):''}</time></span><small>{message.authorIdentity?.kind==='operator'?uiText('You'):!message.authorIdentity&&message.role==='user'?uiText('Original sender'):message.author}{message.preferences.saved?uiText(" · Saved"):''}{message.editedAt&&<span title={formatMessageDateTime(message.editedAt,true)}> · {uiText("Edited")}</span>}</small><p>{plainMessagePreview(message.text)||message.files?.map(file=>file.name).join(', ')||uiText("{0} photos",[message.images.length])}</p><span className="message-result-link">{uiText("Go to message")} <Icon name="arrow-up-right"/></span></button>
   </article>)}
   {!loading&&!results.messages.length&&<div className="message-library-empty"><Icon name={filter==='saved'?'bookmark':'search'}/><h3>{query?uiText("No matching messages"):filter==='saved'?uiText("Keep the good things close"):uiText("Nothing here yet")}</h3><p>{query?uiText("Try another phrase or a different filter."):filter==='saved'?uiText("Save a message from its menu. You can find it here whenever you need it."):uiText("Shared content will appear here as your conversations grow.")}</p></div>}
   {results.hasMore&&<button className="message-library-more" disabled={loading} onClick={()=>setWindowSize(Math.max(windowSize,results.messages.length)+40)}>{loading?uiText("Loading…"):uiText("Load more messages")}</button>}
  </div></MessageGalleryContext.Provider>}
  {sourceId&&<ChannelSourcesDialog sourceId={sourceId} onClose={()=>setSourceId(null)}/>}
 </MessageWorkspace>
}
