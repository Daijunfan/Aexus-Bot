import {formatMessageDateTime} from '../message-time'
import {useEffect,useState} from 'react'
import type {ChannelSourceInfo,ChannelView} from '../../../shared/channels'
import {api} from '../api'
import {translate as uiText,interfaceLocale} from '../i18n'
import {ChannelAvatar,ChannelImage,channelPlatform} from './ChannelNewsCard'
import {Icon} from './Icon'
import {MessageWorkspace} from './MessageWorkspace'
import '../styles/channel-profile.css'

export function ChannelProfileDialog({sourceId,channel,onClose,onManage}:{sourceId?:string;channel:ChannelView;onClose:()=>void;onManage:()=>void}){
 const [source,setSource]=useState<ChannelSourceInfo>(),[error,setError]=useState('')
 useEffect(()=>{let alive=true;if(sourceId)void api.call<ChannelSourceInfo>('channel.source-info',{id:sourceId}).then(value=>{if(alive)setSource(value)}).catch(cause=>alive&&setError(cause.message));return()=>{alive=false}},[sourceId])
 const title=source?.name??channel.name,platform=source?.plugin??channel.kind,avatar=sourceId?source?.sourceAvatar:channel.avatar
 return <MessageWorkspace className="channel-profile-dialog" title={uiText(sourceId?'Author information':'Channel information')} subtitle={title+' · '+channelPlatform(platform)} icon="info" closeLabel={uiText('Close information')} onClose={onClose} footer={<>{source?.authorUrl&&<button type="button" onClick={()=>void api.call('external.open',{url:source.authorUrl}).catch(cause=>setError(cause.message))}><Icon name="arrow-up-right"/>{uiText('View original profile')}</button>}{(!sourceId||source?.canManage)&&<button type="button" className="primary" onClick={onManage}><Icon name="settings-gear"/>{uiText(sourceId?'Manage author':'Channel settings')}</button>}</>}>
  <div className="channel-profile-avatar">{source?.avatar?<ChannelImage channelId={source.channelId} postId={source.avatar.postId} mediaId={source.avatar.mediaId} maxEdge={96} alt=""/>:<ChannelAvatar kind={platform} avatar={avatar} social={!!sourceId} name={title}/>}</div><h2>{title}</h2><p className="channel-profile-platform">{channelPlatform(platform)}</p>
  {sourceId&&!source&&!error&&<p role="status">{uiText('Loading…')}</p>}
  {source&&<p className="channel-profile-locator">{source.locator}</p>}
  {(!sourceId||source)&&<dl><div><dt>{uiText('Published articles')}</dt><dd>{new Intl.NumberFormat(interfaceLocale()).format(source?.postCount??channel.postCount)}</dd></div>{source?.lastPublishedAt&&<div><dt>{uiText('Latest publication')}</dt><dd>{formatMessageDateTime(source.lastPublishedAt,true)}</dd></div>}{!sourceId&&<div><dt>{uiText('Sources')}</dt><dd>{channel.sourceCount}</dd></div>}{source&&<div><dt>{uiText('Channel')}</dt><dd>{source.channelName}</dd></div>}</dl>}
  {error&&<p role="alert">{error}</p>}
 </MessageWorkspace>
}
