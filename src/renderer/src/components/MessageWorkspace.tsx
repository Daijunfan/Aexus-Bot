import {useEffect,useId,type CSSProperties,type HTMLAttributes,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {translate as t,useI18n} from '../i18n'
import {useDialogFocus} from '../office/useDialogFocus'
import {useSurfaceMotion} from '../chat/surfaceMotion'
import {Icon} from './Icon'
import '../styles/message-workspace.css'

type Props=Omit<HTMLAttributes<HTMLElement>,'title'|'children'>&{title:string;label?:string;subtitle?:string;icon?:string|ReactNode;className?:string;style?:CSSProperties;closeLabel?:string;onClose:()=>void;closeDisabled?:boolean;busy?:boolean;dirty?:boolean;compact?:boolean;navigation?:ReactNode;actions?:ReactNode;footer?:ReactNode;scroll?:boolean;initialFocus?:string;children:ReactNode}

/** One predictable surface for Message tools. Feature state and Core policy stay with the caller. */
export function MessageWorkspace({title,label=title,subtitle,icon='comment-discussion',className='',style,closeLabel,onClose,closeDisabled=false,busy=false,dirty=false,compact=false,navigation,actions,footer,scroll=true,initialFocus,children,...attributes}:Props){
 useI18n()
 const id='message-workspace-'+useId().replace(/:/g,''),surface=useSurfaceMotion<HTMLElement>('dialog')
 useDialogFocus('#'+id,true,undefined,initialFocus)
 const close=()=>{if(!busy&&!closeDisabled)onClose()}
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return
   const top=[...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(el=>!el.closest('[hidden],[inert],[aria-hidden="true"]')&&getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().height>0).at(-1)
   if(top?.id!==id)return
   event.preventDefault();event.stopPropagation();if(!busy&&!closeDisabled)onClose()
  }
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
 },[id,busy,closeDisabled,onClose])
 return createPortal(<div className="message-workspace-overlay">
  <div className="message-workspace-backdrop" onClick={close}/>
  <section {...attributes} ref={surface} id={id} className={'message-workspace '+className+(compact?' is-compact':'' )} style={style} role="dialog" aria-modal="true" aria-label={label} aria-busy={busy}>
   <header className="message-workspace-header">
    <button type="button" className="message-workspace-back" disabled={busy||closeDisabled} aria-label={closeLabel??t('Back to conversation')} title={closeLabel??t('Back to conversation')} onClick={close}><Icon name="arrow-left"/></button>
    <span className={'message-workspace-mark'+(typeof icon==='string'?'':' has-avatar')}>{typeof icon==='string'?<Icon name={icon}/>:icon}</span>
    <div className="message-workspace-title"><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>
    <div className="message-workspace-actions">{busy?<span className="message-workspace-progress" role="status"><span className="spinner"/>{t('Working…')}</span>:dirty?<span className="message-workspace-progress" role="status">{t('Unsaved changes')}</span>:null}{actions}</div>
   </header>
   <div className={'message-workspace-layout'+(navigation?' has-navigation':'')}>
    {navigation}
    <main className={'message-workspace-content'+(!scroll?' has-own-scroll':'')}>{children}</main>
   </div>
   {footer&&<footer className="message-workspace-footer">{footer}</footer>}
  </section>
 </div>,document.body)
}

export type MessageWorkspaceSection={id:string;label:string;icon:string|ReactNode;count?:number}
export function MessageWorkspaceNav({items,value,onChange,label,className='',disabled=false}:{items:MessageWorkspaceSection[];value:string;onChange:(id:string)=>void;label:string;className?:string;disabled?:boolean}){
 return <nav className={'message-workspace-navigation '+className} aria-label={label}>{items.map(item=><button key={item.id} type="button" aria-label={item.label} title={item.count===undefined?item.label:item.label+' · '+item.count} aria-current={value===item.id?'page':undefined} aria-pressed={value===item.id} disabled={disabled} onClick={()=>onChange(item.id)}>{typeof item.icon==='string'?<Icon name={item.icon}/>:item.icon}<span>{item.label}</span>{item.count!==undefined&&<small aria-hidden="true">{item.count}</small>}</button>)}</nav>
}
