import {formatMessageClock,formatMessageDateTime} from '../message-time'
import {ChannelDocument} from './ChannelDocument'
import {useEffect,useRef,useState} from 'react'
import {RichMessageText} from '../chat/RichMessageText'
import type {ChannelPost,ChannelView} from '../../../shared/channels'
import type {GalleryImage} from '../../../shared/messenger'
import {api} from '../api'
import {MessageImageViewer} from '../chat/MessageImageViewer'
import {translate as uiText,useI18n,interfaceLocale} from '../i18n'
import {Icon} from './Icon'
import {ChannelPostActions} from './ChannelPostActions'
import {useMessageOwner,useMessageRowState} from '../chat/MessageViewport'
import xLogo from '../assets/channel-icons/x.svg'
import youtubeLogo from '../assets/channel-icons/youtube.png'
import telegramLogo from '../assets/channel-icons/telegram.svg'

export const channelPlatform=(kind:ChannelView['kind'])=>kind==='youtube'?'YouTube':kind==='telegram'?'Telegram':kind==='x'?'X':kind==='employee'?uiText('Employee'):kind==='process'?uiText('External process'):uiText('Channel')
const imageCache=new Map<string,{src:string;bytes:number}>(),imagePending=new Map<string,Promise<string>>()
let imageBytes=0,imageActive=0
const imageWaiters:(()=>void)[]=[],IMAGE_BYTES=16*1024*1024
async function cachedImage(key:string,read:()=>Promise<{data:string;mimeType:string}>){
 const cached=imageCache.get(key);if(cached){imageCache.delete(key);imageCache.set(key,cached);return cached.src}
 const pending=imagePending.get(key);if(pending)return pending
 const request=(async()=>{if(imageActive>=8)await new Promise<void>(resolve=>imageWaiters.push(resolve));else imageActive++;try{const value=await read(),src=`data:${value.mimeType};base64,${value.data}`,bytes=src.length*2;imageCache.set(key,{src,bytes});imageBytes+=bytes;while(imageBytes>IMAGE_BYTES&&imageCache.size>1){const first=imageCache.keys().next().value!;imageBytes-=imageCache.get(first)!.bytes;imageCache.delete(first)}return src}finally{const wake=imageWaiters.shift();if(wake)wake();else imageActive--}})().finally(()=>imagePending.delete(key));imagePending.set(key,request);return request
}
function readSourceImage(avatar:NonNullable<ChannelView['avatar']>){
 const identity=avatar.channelId?'channel:'+avatar.channelId:avatar.sourceId
 return cachedImage('avatar:'+identity+':'+avatar.sha256,()=>api.call<{data:string;mimeType:string}>(avatar.channelId?'channel.avatar-image':'channel.source-image',avatar.channelId?{id:avatar.channelId}:{sourceId:avatar.sourceId}))
}
export function ChannelAvatar({kind,avatar,name='',social=false}:{kind:ChannelView['kind'];avatar?:ChannelView['avatar'];name?:string;social?:boolean}){
 const box=useRef<HTMLSpanElement>(null)
 const custom=!!avatar?.channelId,identity=!!avatar||social||kind==='telegram',key=String(social)+':'+kind+':'+(avatar?(avatar.channelId??avatar.sourceId)+':'+avatar.sha256:''),[image,setImage]=useState({key:'',src:'',failed:false}),src=image.key===key?image.src:'',failed=image.key===key&&image.failed
 useEffect(()=>{let active=true,visible=false,started=false;setImage({key,src:'',failed:false});if(!identity||!avatar)return;const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(!visible){started=false;setImage({key,src:'',failed:false});return}if(started)return;started=true;void readSourceImage(avatar).then(src=>{if(active&&visible)setImage({key,src,failed:false})}).catch(()=>{if(active&&visible)setImage({key,src:'',failed:true})})},{rootMargin:'160px'});if(box.current)observer.observe(box.current);return()=>{active=false;observer.disconnect()}},[key])
 const initials=name.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]??'').join('')||'T'
 return <span ref={box} className="channel-avatar" data-platform={kind} data-avatar-state={identity?(src?'ready':avatar?(failed?'error':'loading'):'placeholder'):undefined} aria-hidden="true">{src?<img className="channel-identity-image" src={src} alt="" decoding="async" onError={()=>setImage({key,src:'',failed:true})}/>:identity&&avatar?<Icon name={failed?'error':'loading'}/>:!social&&(kind==='x'||kind==='youtube')?<img className="channel-brand-icon" src={kind==='x'?xLogo:youtubeLogo} alt=""/>:!social&&kind==='telegram'?<img className="channel-brand-icon" src={telegramLogo} alt="" draggable={false}/>:social||kind==='telegram'||kind==='employee'?<span className="channel-avatar-initials">{initials}</span>:<Icon name={kind==='process'?'server':'radio-tower'}/>}</span>
}
export async function readChannelImage(channelId:string,postId:string,mediaId:string,maxEdge?:number){return cachedImage(channelId+':'+postId+':'+mediaId+':'+(maxEdge??0),()=>api.call<{data:string;mimeType:string}>('channel.image',{channelId,postId,mediaId,...(maxEdge?{maxEdge}:{})}))}
/** Only published local media is read, and only as a card reaches the viewport. */
export function ChannelImage({channelId,postId,mediaId,alt,onReady,onRelease,maxEdge=1280}:{channelId:string;postId:string;mediaId:string;alt:string;onReady?:(src:string)=>void;onRelease?:()=>void;maxEdge?:number}){
 const box=useRef<HTMLSpanElement>(null),[src,setSrc]=useState(''),[failed,setFailed]=useState(false),ready=useRef(onReady),release=useRef(onRelease);ready.current=onReady;release.current=onRelease
 useEffect(()=>{let alive=true,visible=false,started=false;setSrc('');setFailed(false);const load=()=>{if(started)return;started=true;void readChannelImage(channelId,postId,mediaId,maxEdge).then(value=>{if(alive&&visible){setSrc(value);ready.current?.(value)}}).catch(()=>{if(alive&&visible)setFailed(true)})};const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(visible)load();else{started=false;setSrc('');release.current?.()}},{rootMargin:'240px'});if(box.current)observer.observe(box.current);return()=>{alive=false;observer.disconnect();release.current?.()}},[channelId,postId,mediaId,maxEdge])
 return <span ref={box} className={'channel-local-image'+(failed?' unavailable':'')}>{src?<img src={src} alt={alt} decoding="async" onError={()=>{setSrc('');setFailed(true)}}/>:<Icon name="file-media"/>}</span>
}

export function ChannelNewsCard({post,onAuthor,onChanged,onReveal,onReply,sourceAvatar,album,fullContent=false,postMode=false}:{post:ChannelPost;postMode?:boolean;fullContent?:boolean;album?:ChannelPost[];onAuthor:(sourceId:string)=>void;onChanged:(post:ChannelPost|null)=>void;onReveal?:()=>void;onReply?:()=>void;sourceAvatar?:ChannelView['avatar']}){
 useI18n()
 const entries=album??[post],documents=entries.flatMap(entry=>(entry.files??[]).map(file=>({post:entry,file}))),telegram=entries.slice().reverse().find(entry=>entry.telegram?.reactions?.length)?.telegram??entries.at(-1)?.telegram
 const [error,setError]=useState(''),[expanded,setExpanded]=useMessageRowState('channel-expanded',false),[gallery,setGallery]=useState<{index:number;mediaIds:string}|null>(null),images=useRef(new Map<string,string>()),buttons=useRef(new Map<string,HTMLButtonElement>()),alive=useRef(true)
 useMessageOwner(!!gallery)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const photos=post.media.filter(media=>media.id!==post.avatarMediaId&&!post.files?.some(file=>file.thumbnailMediaId===media.id)&&media.mimeType.startsWith('image/')),items:GalleryImage[]=photos.map(media=>({path:media.id+'/'+media.name,messageId:post.id,caption:post.title||post.body})),author=post.authorName||post.sourceName
 const identity=post.sourceAvatar??sourceAvatar
 const age=Math.max(0,Math.floor((Date.now()-post.publishedAt)/60000)),relative=age<1?uiText('now'):age<60?age+'m':age<1440?Math.floor(age/60)+'h':new Date(post.publishedAt).toLocaleDateString(interfaceLocale(),{month:'short',day:'numeric'}),handle=post.authorUrl?.match(post.plugin==='youtube'?/youtube\.com\/@([^/?#]+)/:/(?:x\.com|twitter\.com)\/@?([^/?#]+)/)?.[1]
 const mediaIds=JSON.stringify(photos.map(media=>media.id)),galleryPhoto=gallery?.mediaIds===mediaIds?photos[gallery.index]:undefined
 // The viewer snapshots its album. Close it when refreshed news changes that album.
 useEffect(()=>{setGallery(current=>current&&current.mediaIds!==mediaIds?null:current)},[mediaIds])
 const expand=async()=>{if(expanded){setExpanded(false);return}if(!post.bodyTruncated){setExpanded(true);return}try{const value=await api.call<ChannelPost>('channel.post',{id:post.id});if(alive.current){onChanged(value);setExpanded(true);setError('')}}catch(cause){if(alive.current)setError((cause as Error).message)}}
 const photoGrid=!!photos.length&&<div className="channel-news-images" data-count={Math.min(photos.length,4)}>{(fullContent?photos:photos.slice(0,4)).map((media,index)=><button key={media.id} ref={element=>{if(element)buttons.current.set(media.id,element);else buttons.current.delete(media.id)}} aria-label={uiText('Preview {0}',[media.name])} onClick={()=>setGallery({index,mediaIds})}><ChannelImage channelId={post.channelId} postId={post.id} mediaId={media.id} alt={media.name} maxEdge={postMode&&post.plugin==='youtube'?960:1280} onReady={src=>images.current.set(media.id,src)} onRelease={()=>images.current.delete(media.id)}/>{!fullContent&&index===3&&photos.length>4&&<span className="channel-image-more">+{photos.length-4}</span>}</button>)}</div>
 return <article className={'channel-news-card'+(documents.length?' telegram-document-message':'')} data-platform={post.plugin} data-telegram-album={post.telegram?.groupId} data-news-id={post.id}>
  <header><button className="channel-author" aria-label={uiText('Author information {0}',[author])} onClick={()=>onAuthor(post.sourceId)}><span className="channel-author-avatar">{post.plugin!=='telegram'&&post.avatarMediaId?<ChannelImage channelId={post.channelId} postId={post.id} mediaId={post.avatarMediaId} alt="" maxEdge={96}/>:<ChannelAvatar social kind={post.plugin} avatar={identity?.sourceId===post.sourceId?identity:undefined} name={author}/>}</span><span><strong>{author}</strong><small>{postMode&&handle?'@'+handle:channelPlatform(post.plugin)}<b>·</b><time dateTime={new Date(post.publishedAt).toISOString()} title={formatMessageDateTime(post.publishedAt,true)}>{postMode?relative:formatMessageDateTime(post.publishedAt)}</time></small></span></button></header>
  {fullContent&&photoGrid}
  {post.title&&!(post.files?.length===1&&post.files[0].name===post.title)&&<h2>{post.title}</h2>}
  {!!documents.length&&<div className="channel-news-documents">{documents.map(({post:owner,file})=><ChannelDocument key={owner.id+'/'+file.id} postId={owner.id} channelId={owner.channelId} file={file} preview={file.thumbnailMediaId?<ChannelImage channelId={owner.channelId} postId={owner.id} mediaId={file.thumbnailMediaId} alt=""/>:undefined} onSaved={()=>owner.id===post.id&&void api.call<ChannelPost>('channel.post',{id:post.id}).then(onChanged)}/>)}</div>}
  {post.body&&<><RichMessageText className={'channel-news-body'+(!fullContent&&!expanded&&post.body.length>700?' collapsed':'')} text={post.body} images={false}/>{!fullContent&&post.body.length>700&&<button className="channel-read-more" aria-expanded={expanded} onClick={()=>void expand()}>{uiText(expanded?'Show less':'Read more')}<Icon name={expanded?'chevron-up':'chevron-down'}/></button>}</>}
  {!fullContent&&photoGrid}
  {!!documents.length&&<div className="telegram-document-bottom"><div className="telegram-original-reactions">{telegram?.reactions?.map(reaction=><span key={reaction.emoji}><span>{reaction.emoji}</span>{reaction.count}</span>)}</div><span className="telegram-original-stats">{telegram?.views!==undefined&&<><Icon name="eye"/>{new Intl.NumberFormat(interfaceLocale(),{notation:'compact',maximumFractionDigits:1}).format(telegram.views)}</>}<time dateTime={new Date(post.publishedAt).toISOString()}>{formatMessageClock(post.publishedAt)}</time></span></div>}
  {error&&<p className="channel-inline-error" role="alert">{uiText(error)}</p>}
  <ChannelPostActions post={post} onChanged={onChanged} onAuthor={onAuthor} onReply={onReply} onReveal={onReveal}/>
  {gallery&&galleryPhoto&&<MessageImageViewer items={items} initialIndex={gallery.index} initialSrc={images.current.get(galleryPhoto.id)??''} readImage={item=>readChannelImage(post.channelId,post.id,item.path.split('/')[0])} origin={item=>buttons.current.get(item.path.split('/')[0])??null} onClose={()=>setGallery(null)}/>}
 </article>
}
