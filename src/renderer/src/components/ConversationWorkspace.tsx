import {AppSelect} from './AppSelect'
import {useEffect,useState} from 'react'
import type {ConversationWorkspace as Workspace} from '../../../shared/conversation-workspaces'
import {api} from '../api'
import {flushPlugins} from '../plugins'
import {translate as uiText} from '../i18n'
import {FileWorkspace} from './FileWorkspace'
import {MessageWorkspace} from './MessageWorkspace'
import '../assets/plugins.css'

/** One file browser over the same authenticated Core workspace APIs used by Agents. */
export function ConversationWorkspace({conversation,onClose,initialFolder='',backLabel='Back to conversation',channelDownloads=false}:{conversation:string;onClose:()=>void;initialFolder?:string;backLabel?:string;channelDownloads?:boolean}){
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[error,setError]=useState(''),[folder,setFolder]=useState(initialFolder),[closing,setClosing]=useState(false)
 useEffect(()=>{let active=true;void api.call<Workspace>('conversation.workspace',{conversation}).then(value=>{if(active)setWorkspace(value)}).catch(cause=>{if(active)setError(cause.message)});return()=>{active=false}},[conversation])
 const leave=async()=>{if(closing)return;setClosing(true);try{await flushPlugins();onClose()}catch(cause){setError((cause as Error).message)}finally{setClosing(false)}}
 const choose=async(value:string)=>{try{await flushPlugins();setFolder(value);setError('')}catch(cause){setError((cause as Error).message)}}
 return <MessageWorkspace className="conversation-workspace" title={uiText(channelDownloads?'Downloaded files':'Shared workspace')} subtitle={workspace?.name??uiText('Loading…')} icon="files" closeLabel={uiText(channelDownloads?'Close downloaded files':'Close shared workspace')} closeDisabled={closing} onClose={()=>void leave()} scroll={false}>
   {error&&<div className="workspace-error" role="alert">{error}</div>}
   {workspace&&<>{!channelDownloads&&<div className="conversation-workspace-locations"><label>{uiText('Folder')}<AppSelect aria-label={uiText('Shared workspace folder')} value={folder} onChange={event=>void choose(event.target.value)}><option value="">{uiText('User uploads and shared files')}</option>{workspace.members.map(member=><option key={member.employeeId} value={member.directory}>{member.name} · {member.directory}</option>)}</AppSelect></label><small>{uiText(conversation.startsWith('group:')?'All group members share full file access. Download to your workspace, edit, then upload your changes.':'Members can edit their own named folder. Only a member Secretary can also edit direct root files.')}</small></div>}<FileWorkspace key={conversation+'/'+folder} conversation={conversation} initialFolder={folder}/></>}
 </MessageWorkspace>
}
