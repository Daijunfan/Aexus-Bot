import {useEffect,useRef,useState,type ReactNode} from 'react'
import type {PrincipalRef} from '../../../shared/management'
import type {Item,Store,StoredSession} from '../../../shared/types'
import {messageKey} from '../../../shared/messenger'
import type {MessengerProfile,ProfileImageInput} from '../../../shared/messenger'
import {CHANNEL_IMAGE_LIMIT} from '../../../shared/channels'
import {AVATAR_LABELS,type AvatarKind} from '../../../shared/office'
import {api} from '../api'
import {translate as uiText,useI18n} from '../i18n'
import {EmployeePortrait} from './EmployeePortrait'
import {useEnabledAvatars} from './AvatarCatalog'
import {Icon} from './Icon'
import {MessageWorkspace,MessageWorkspaceNav} from './MessageWorkspace'
import {useMessenger} from './useMessenger'
import '../styles/message-identity.css'

const images=new Map<string,Promise<string>>()
function profileImage(sha256:string){
 let image=images.get(sha256)
 if(!image){image=api.call<ProfileImageInput>('messenger.profile-image',{sha256}).then(value=>`data:${value.mimeType};base64,${value.data}`);images.set(sha256,image);void image.catch(()=>images.delete(sha256))}
 return image
}
export function UserMessageAvatar({profile,preview}:{profile?:MessengerProfile;preview?:ProfileImageInput}){
 const key=profile?.image?.sha256,[image,setImage]=useState({key:'',src:''}),src=preview?`data:${preview.mimeType};base64,${preview.data}`:image.key===key?image.src:''
 useEffect(()=>{let active=true;if(key)void profileImage(key).then(src=>{if(active)setImage({key,src})}).catch(()=>{});return()=>{active=false}},[key])
 return <span className="message-user-avatar" data-user-avatar={src?'image':profile?.avatar??'default'}>{src?<img src={src} alt=""/>:profile?.avatar?<EmployeePortrait avatar={profile.avatar}/>:<Icon name="person"/>}</span>
}
/** Author identity selects the portrait; the currently open employee never supplies it. */
export function MessageAuthorAvatar({author,authorName,store}:{author:PrincipalRef;authorName:string;store:Store}){
 const messenger=useMessenger(),employee=author.kind==='agent'?store.sessions.find(card=>author.employeeId===card.id):undefined
 return <span className="message-author-avatar" data-author-kind={author.kind} data-author-id={author.kind==='agent'?author.employeeId:undefined} aria-label={author.kind==='operator'?uiText('You'):authorName}>{author.kind==='operator'?<UserMessageAvatar profile={messenger?.state.profile}/>:employee?<EmployeePortrait employeeId={employee.id} avatar={employee.avatar??(employee.engine==='codex'?'robot':'cat')} color={employee.color}/>:<span className="message-former-avatar">{Array.from(authorName.trim())[0]||<Icon name="person"/>}</span>}</span>
}
/** Private and group messages use the same real author portraits, outside their bubbles. */
export function PrivateMessageRow({item,employee,store,bubbleGroup,children}:{item:Item;employee?:StoredSession;store:Store;bubbleGroup?:string;children:ReactNode}){
 const messenger=useMessenger()
 if(!employee||item.role==='notice'||messenger?.state.messages[messageKey('employee:'+employee.id,item.id)]?.hidden)return children
 if(item.role==='assistant'&&!item.questionId&&!item.blocks.some(block=>block.kind==='text'&&block.text.trim())&&!item.images?.length&&!item.files?.length)return children
 const author:PrincipalRef=item.role==='assistant'?{kind:'agent',employeeId:employee.id}:item.author??{kind:'operator'},outgoing=author.kind==='operator',name=outgoing?uiText('You'):author.kind==='agent'?store.sessions.find(card=>card.id===author.employeeId)?.title??uiText('Former teammate'):employee.title
 return <div className={'private-message-row '+(outgoing?'is-outgoing':'is-incoming')} data-bubble-group={bubbleGroup}><MessageAuthorAvatar author={author} authorName={name} store={store}/>{children}</div>
}
export function MessageProfileEditor({onClose}:{onClose:()=>void}){
 useI18n()
 const [mode,setMode]=useState('image'),[query,setQuery]=useState(''),[page,setPage]=useState(0),[discard,setDiscard]=useState(false)
 const available=useEnabledAvatars()
 const messenger=useMessenger()!,input=useRef<HTMLInputElement>(null),[draft,setDraft]=useState<AvatarKind|ProfileImageInput|null>(null),[changed,setChanged]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [photo,setPhoto]=useState<ProfileImageInput|null>(null),[crop,setCrop]=useState({zoom:1,x:0,y:0}),[size,setSize]=useState({width:0,height:0}),picture=useRef<HTMLImageElement>(null),drag=useRef<{id:number;x:number;y:number;crop:typeof crop}|null>(null)
 const choose=(value:typeof draft)=>{setDraft(value);setChanged(true);setError('');setPhoto(null)}
 const editPhoto=(value:ProfileImageInput)=>{choose(value);setPhoto(value);setCrop({zoom:1,x:0,y:0});setSize({width:0,height:0})}
 const moveCrop=(value:typeof crop)=>{const min=Math.min(size.width,size.height)||1;setCrop({...value,x:Math.max(-(size.width/min*value.zoom-1)/2,Math.min((size.width/min*value.zoom-1)/2,value.x)),y:Math.max(-(size.height/min*value.zoom-1)/2,Math.min((size.height/min*value.zoom-1)/2,value.y))})}
 const upload=async(file?:File)=>{
  if(!file)return;setBusy(true);setError('')
  try{
   if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)||!file.size||file.size>CHANNEL_IMAGE_LIMIT)throw Error('Upload a PNG, JPEG, GIF or WebP image up to 8 MiB')
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the selected image'));reader.readAsDataURL(file)})
   editPhoto({name:file.name,mimeType:file.type,data})
  }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
 }
 const save=async()=>{setBusy(true);setError('');try{let value=draft;if(photo&&(crop.zoom!==1||crop.x!==0||crop.y!==0)){const image=picture.current;if(!image?.naturalWidth)throw Error('Could not read the selected image');const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const context=canvas.getContext('2d')!,scale=512/Math.min(image.naturalWidth,image.naturalHeight)*crop.zoom;context.drawImage(image,256-image.naturalWidth*scale/2+crop.x*512,256-image.naturalHeight*scale/2+crop.y*512,image.naturalWidth*scale,image.naturalHeight*scale);value={name:'avatar.png',mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1]}}await api.call('messenger.profile',value&&typeof value==='object'?{image:value}:{avatar:value});await messenger.refresh();onClose()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
 const profile=changed?typeof draft==='string'?{avatar:draft}:{}:messenger.state.profile
 const matches=available.filter(avatar=>(uiText(AVATAR_LABELS[avatar])+' '+avatar).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),pages=Math.max(1,Math.ceil(matches.length/12)),shown=matches.slice(Math.min(page,pages-1)*12,(Math.min(page,pages-1)+1)*12)
 const close=()=>{if(discard)setDiscard(false);else if(changed)setDiscard(true);else onClose()}
 return <MessageWorkspace className="message-profile-editor" title={uiText('Your message profile')} subtitle={uiText('Your avatar appears beside your private, group and channel messages.')} icon="person" closeLabel={uiText('Close')} onClose={close} busy={busy} dirty={changed} navigation={<MessageWorkspaceNav label={uiText('Profile appearance')} value={mode} disabled={busy||discard} items={[{id:'image',label:uiText('Your image'),icon:'file-media'},{id:'characters',label:uiText('Choose a character'),icon:'person'}]} onChange={setMode}/>} footer={<><button disabled={busy} onClick={onClose}>{uiText('Cancel')}</button><button className="primary" disabled={busy||!changed||!!photo&&!size.width||discard} onClick={()=>void save()}>{uiText(busy?'Saving…':'Save changes')}</button></>}>
  {discard&&<div className="message-workspace-discard" role="alert"><p>{uiText('Discard unsaved profile changes?')}</p><button onClick={()=>setDiscard(false)}>{uiText('Keep editing')}</button><button onClick={onClose}>{uiText('Discard changes')}</button></div>}
  <div className={'message-identity-content '+mode} inert={discard}>
   <div className="message-profile-preview"><UserMessageAvatar profile={profile} preview={changed&&draft&&typeof draft==='object'?draft:undefined}/><strong>{uiText('You')}</strong><p>{uiText('Your avatar appears beside your private, group and channel messages.')}</p></div>
   <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" aria-label={uiText('Upload your avatar')} disabled={busy} onChange={event=>{void upload(event.target.files?.[0]);event.target.value=''}}/>
   {mode==='image'&&<><div className="message-profile-actions"><button className="primary" disabled={busy} onClick={()=>input.current?.click()}><Icon name="cloud-upload"/>{uiText('Upload your avatar')}</button>{messenger.state.profile?.image&&!photo&&<button disabled={busy} onClick={async()=>{setBusy(true);try{editPhoto(await api.call<ProfileImageInput>('messenger.profile-image',{sha256:messenger.state.profile!.image!.sha256}))}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}}><Icon name="edit"/>{uiText('Edit uploaded image')}</button>}<button disabled={busy} onClick={()=>choose(null)}>{uiText('Use default image')}</button></div>
   {photo&&<div className="message-profile-crop"><div className="message-profile-crop-area" aria-label={uiText('Drag to position your avatar')} onPointerDown={event=>{if(busy||!size.width)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,crop};event.preventDefault()}} onPointerMove={event=>{const start=drag.current;if(!start||start.id!==event.pointerId)return;const width=event.currentTarget.getBoundingClientRect().width;moveCrop({...start.crop,x:start.crop.x+(event.clientX-start.x)/width,y:start.crop.y+(event.clientY-start.y)/width})}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}><img ref={picture} draggable={false} alt={uiText('Avatar crop preview')} src={`data:${photo.mimeType};base64,${photo.data}`} onLoad={event=>setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setError(uiText('Could not read the selected image'))} style={{width:size.width?size.width/Math.min(size.width,size.height)*crop.zoom*100+'%':'100%',left:50+crop.x*100+'%',top:50+crop.y*100+'%'}}/></div><label><Icon name="zoom-in"/><input type="range" aria-label={uiText('Avatar zoom')} min="1" max="3" step=".05" value={crop.zoom} disabled={busy||!size.width} onChange={event=>moveCrop({...crop,zoom:Number(event.target.value)})}/><output>{Math.round(crop.zoom*100)}%</output></label><small>{uiText('Drag to position. Cropped images are saved as PNG.')}</small></div>}
   <small className="message-profile-hint">PNG · JPEG · GIF · WebP · {uiText('Up to 8 MiB')}</small></>}
   {mode==='characters'&&<section className="message-profile-catalog"><label className="message-character-search"><Icon name="search"/><input aria-label={uiText('Search characters')} placeholder={uiText('Search by character name…')} value={query} onChange={event=>{setQuery(event.target.value);setPage(0)}}/></label><div className="message-profile-characters">{shown.map(avatar=><button key={avatar} disabled={busy} aria-label={uiText(AVATAR_LABELS[avatar])} aria-pressed={profile?.avatar===avatar} title={uiText(AVATAR_LABELS[avatar])} onClick={()=>choose(avatar)}><EmployeePortrait avatar={avatar}/><span>{uiText(AVATAR_LABELS[avatar])}</span></button>)}</div>{!matches.length&&<p className="message-characters-empty">{uiText('No matching characters')}</p>}<div className="message-character-pages"><button disabled={page===0} onClick={()=>setPage(value=>Math.max(0,value-1))}><Icon name="chevron-left"/>{uiText('Previous')}</button><span>{Math.min(page,pages-1)+1} / {pages}</span><button disabled={page>=pages-1} onClick={()=>setPage(value=>value+1)}>{uiText('Next')}<Icon name="chevron-right"/></button></div></section>}
   {error&&<p className="group-error" role="alert">{uiText(error)}</p>}
  </div>
 </MessageWorkspace>
}
