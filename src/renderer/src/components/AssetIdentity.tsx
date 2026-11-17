import {useId} from 'react'
import type {AssetNode} from '../../../shared/asset-schema'
import {TeamOSIcon} from '../office/TeamOSIcon'
import {EmployeePortrait} from './EmployeePortrait'
import {Icon} from './Icon'
import {translate as t} from '../i18n'
export const assetOwnerLine=(node:AssetNode)=>{
 const title=node.label??node.name
 const viewLabel=node.owner?.view?t(node.owner.view):undefined
 const variety=node.directory
  ? node.kind==='employee'
    ? t('Workspace')
    : node.kind==='group'
      ? t('Group')
      : node.kind==='channel'
        ? t('Channel')
        : node.kind==='direct'
          ? t('Private chat')
          : undefined
  : undefined
 const conv=node.owner?.conversationName&&node.owner.conversationName!==title?node.owner.conversationName:undefined
 const emp=!(node.directory&&(node.kind==='member'||node.kind==='employee'||node.kind==='direct'||node.id.startsWith('published:direct:')))&&node.owner?.employeeName!==title?node.owner?.employeeName:undefined
 const rawLabel=!conv&&!emp&&node.owner?.label&&node.owner.label!==title?t(node.owner.label):undefined
 return [viewLabel,variety,conv,emp,rawLabel].filter((value,index,all)=>value&&all.indexOf(value)===index).join(' · ')
}
export function AssetHostBadge({node}:{node:AssetNode}){
 if(!node.host&&!node.storage)return null
 const remote=node.storage==='remote'||node.storage==='cloud',label=remote?node.host?.name??t('Remote host'):t('Local'),os=node.host?.os
 return <span className={'asset-host-badge '+(remote?'is-remote':'is-local')} data-storage={node.storage??'local'} data-host-id={node.host?.id} title={[remote?t(node.storage==='cloud'?'Cloud only':'Remote host'):t('Core host'),label,os==='macos'?'macOS':os==='windows'?'Windows':os==='linux'?'Linux':undefined].filter(Boolean).join(' · ')}>{os?<TeamOSIcon os={os} distribution={node.host?.distribution}/>:<Icon name={remote?'server':'device-desktop'}/>}<span>{label}</span>{node.storage==='cloud'&&<Icon name="cloud"/>}</span>
}
function FolderArt(){const id=useId();return <svg viewBox="0 0 120 96" className="asset-folder-art" fill="none" aria-hidden="true"><defs><linearGradient id={id+'b'} x1="60" y1="8" x2="60" y2="90" gradientUnits="userSpaceOnUse"><stop stopColor="var(--folder-back)"/><stop offset="1" stopColor="var(--folder-front)"/></linearGradient><linearGradient id={id+'f'} x1="60" y1="32" x2="60" y2="87" gradientUnits="userSpaceOnUse"><stop stopColor="var(--folder-light)"/><stop offset="1" stopColor="var(--folder-front)"/></linearGradient></defs><path d="M11 22a9 9 0 0 1 9-9h28l12 11h40a9 9 0 0 1 9 9v45a9 9 0 0 1-9 9H20a9 9 0 0 1-9-9Z" fill={'url(#'+id+'b)'}/><path d="M20 31h80v43H20z" fill="var(--folder-paper)"/><path d="M9 44a8 8 0 0 1 8-9h86a8 8 0 0 1 8 9l-4 35a9 9 0 0 1-9 8H22a9 9 0 0 1-9-8Z" fill={'url(#'+id+'f)'} stroke="var(--folder-edge)" strokeWidth=".8"/><path d="M18 39h84" stroke="#fff" strokeOpacity=".52" strokeLinecap="round"/></svg>}
const FOLDER_EMBLEMS:Record<string,string>={
 'study-set':'layers',
 reader:'book',
 shared:'globe',
 group:'organization',
 channel:'megaphone',
 notebook:'checklist',
 exports:'package',
 published:'bookmark',
 'cloud-host':'server-environment',
}
const STRUCTURAL_VIEWS:Record<string,string>={
 agents:'Agents',
 messages:'Messages',
 groups:'Messages',
 channels:'Messages',
 direct:'Messages',
 plan:'Plan',
 reader:'Reader',
 hosts:'Hosts',
}
const STRUCTURAL_KINDS:Record<string,string>={
 groups:'group',
 channels:'channel',
 direct:'direct',
 plan:'notebook',
}
export function AssetGlyph({node,large=false}:{node:AssetNode;large?:boolean}){
 const effectiveView=node.owner?.view??STRUCTURAL_VIEWS[node.id]
 const effectiveKind=node.kind??STRUCTURAL_KINDS[node.id]
 const personal=!!node.owner?.employee&&(effectiveKind==='member'||effectiveKind==='employee'||effectiveKind==='direct'||node.id.startsWith('published:direct:')),icon=effectiveKind==='image'?'file-media':effectiveKind==='audio'?'music':effectiveKind==='video'?'play-circle':effectiveKind==='code'?'code':/\.pdf$/i.test(node.name)?'file-pdf':'file-text'
 const folderEmblem=node.directory&&!personal&&node.host?.kind!=='remote'&&effectiveKind?FOLDER_EMBLEMS[effectiveKind]:undefined
 return <span className={'asset-identity '+(large?'large ':'')+(node.directory?'is-folder':'is-file')} data-view={effectiveView} data-kind={effectiveKind}>
  {node.directory?<FolderArt/>:<span className="asset-document-art"><Icon name={icon}/><small>{node.name.split('.').at(-1)?.toUpperCase().slice(0,7)}</small></span>}
  {personal&&<span className="asset-owner-portrait" aria-label={node.owner?.employeeName}><EmployeePortrait employeeId={node.owner?.employee} avatar={node.owner?.avatar} color={node.owner?.color} large={large}/></span>}
  {node.directory&&!personal&&node.host?.kind==='remote'&&<span className="asset-folder-emblem">{node.host.os?<TeamOSIcon os={node.host.os} distribution={node.host.distribution}/>:<Icon name="server"/>}</span>}
  {folderEmblem&&<span className="asset-folder-emblem is-kind-emblem"><Icon name={folderEmblem}/></span>}
 </span>
}
export function assetError(message:string){return message.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s'"<>]+/g,t('storage location'))}
