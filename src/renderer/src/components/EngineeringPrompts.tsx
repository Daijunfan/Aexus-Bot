import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import type {Engineering} from '../../../shared/engineering'
import {api} from '../api'
import {engineeringError} from './engineering-error'
import {translate as t} from '../i18n'
import {onPluginFlush} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
import {useDialogFocus} from '../office/useDialogFocus'
import {Icon} from './Icon'

export function EngineeringPrompts({project,onClose}:{project:Engineering;onClose:()=>void}){
 const [files,setFiles]=useState<string[]>([]),[selected,setSelected]=useState('overview.md'),[loaded,setLoaded]=useState<{path:string;content:string;version:string}>(),[content,setContent]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[discard,setDiscard]=useState<string|null>(null),ticket=useRef(0)
 const dirty=!!loaded&&content!==loaded.content
 useDialogFocus('.engineering-prompts',true);useBeforeUnloadGuard(dirty||pending)
 useEffect(()=>onPluginFlush(async()=>{if(dirty||pending){setError(t('Save or discard prompt changes before leaving.'));throw Error(t('Save or discard prompt changes before leaving.'))}}),[dirty,pending])
 useEffect(()=>{let alive=true;void api.call<{files:{path:string}[]}>('engineering.prompts',{id:project.id}).then(value=>{if(alive)setFiles(value.files.map(file=>file.path))}).catch(cause=>{if(alive)setError(engineeringError(cause))});return()=>{alive=false}},[project.id])
 useEffect(()=>{const current=++ticket.current;setPending(true);setError('');void api.call<{path:string;content:string;version:string}>('engineering.prompts',{id:project.id,path:selected}).then(value=>{if(ticket.current===current){setLoaded(value);setContent(value.content)}}).catch(cause=>{if(ticket.current===current)setError(engineeringError(cause))}).finally(()=>{if(ticket.current===current)setPending(false)});return()=>{ticket.current++}},[project.id,selected])
 const leave=(target:string)=>{if(pending)return;if(dirty)setDiscard(target);else if(target==='close')onClose();else setSelected(target)}
 const save=async()=>{if(!loaded||pending)return;setPending(true);setError('');try{const value=await api.call<typeof loaded>('engineering.prompts',{id:project.id,path:loaded.path,content,expectedVersion:loaded.version});setLoaded(value)}catch(cause){setError(engineeringError(cause))}finally{setPending(false)}}
 return createPortal(<div className="engineering-overlay" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();if(discard)setDiscard(null);else leave('close')}}}><div className="engineering-backdrop" onClick={()=>leave('close')}/><section className="engineering-dialog engineering-prompts" role="dialog" aria-modal="true" aria-label={t('Engineering prompt folder')}>
  <header><span className="engineering-dialog-symbol"><Icon name="notebook"/></span><div><small>{project.name}</small><h2>{t('Engineering prompt folder')}</h2><p>{t('One shared router. Editable roles, node instructions and acceptance criteria.')}</p></div><button className="engineering-icon" aria-label={t('Close prompt editor')} disabled={pending} onClick={()=>leave('close')}><Icon name="close"/></button></header>
  {discard&&<div className="engineering-confirm" role="alert"><strong>{t('Discard unsaved prompt changes?')}</strong><button onClick={()=>setDiscard(null)}>{t('Keep editing')}</button><button onClick={()=>{const target=discard;setDiscard(null);if(target==='close')onClose();else setSelected(target)}}>{t('Discard changes')}</button></div>}
  <div className="engineering-prompts-body" inert={!!discard}><nav aria-label={t('Prompt files')}>{files.map(file=><button key={file} aria-current={selected===file?'page':undefined} onClick={()=>leave(file)}><Icon name={file==='structure.json'?'json':'markdown'}/><span>{file}</span></button>)}</nav><div><div className="engineering-prompt-file"><Icon name="file-code"/><strong>{selected}</strong><span>{dirty?t('Unsaved changes'):t('Saved')}</span></div><textarea spellCheck={false} aria-label={t('Prompt file content')} readOnly={selected==='structure.json'||pending} value={content} onChange={event=>setContent(event.target.value)}/></div></div>
  {error&&<p className="engineering-error" role="alert">{error}</p>}<footer><code title={project.promptDirectory}>{project.promptDirectory}</code><button disabled={pending} onClick={()=>leave('close')}>{t('Close')}</button><button className="primary" disabled={pending||!dirty||selected==='structure.json'} onClick={()=>void save()}><Icon name={pending?'loading':'check'}/>{t('Save prompt')}</button></footer>
 </section></div>,document.body)
}
