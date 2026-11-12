import {Children,isValidElement,type ReactElement,type ReactNode} from 'react'
import {translate as t,useI18n} from '../i18n'
import {MessageWorkspace} from './MessageWorkspace'
import {Icon} from './Icon'

const fields:Record<string,[string,string,string]>={
 engine:['Coding agent','hubot','Fixed at employee creation.'],
 model:['Model','symbol-misc','The native model used by this employee.'],
 perm:['Permissions','shield','Native execution permissions for this employee.'],
 effort:['Reasoning','lightbulb','The coding agent’s native reasoning setting.'],
 thinking:['Thinking','sparkle','The coding agent’s native thinking control.'],
 plan:['Planning mode','checklist','The coding agent’s native planning control.'],
 'remote-admin':['Remote administration','remote','Administration applies to the existing remote host.'],
 fast:['Fast mode','zap','The provider’s native speed and usage setting.'],
 workspace:['Execution scope','folder','The employee’s current execution scope.'],
 directory:['Team workspace','folder-opened','The personal workspace assigned to this employee.']
}

/** Reuse the exact native controls; only their Message presentation changes. */
export function MessageSessionSettings({messages,open,title,onClose,children}:{messages:boolean;open:boolean;title:string;onClose:()=>void;children:ReactElement<{children?:ReactNode}>}){
 useI18n()
 if(!messages)return children
 if(!open)return null
 return <MessageWorkspace className="message-runtime-settings" title={t('Conversation settings')} subtitle={title} icon="settings-gear" onClose={onClose} closeLabel={t('Close conversation settings')} actions={<span className="message-workspace-footer-note">{t('Changes apply immediately')}</span>}>
  <div className="message-runtime-grid">{Children.toArray(children.props.children).map((child,index)=>{
   if(!isValidElement<Record<string,any>>(child))return child
   const key=child.props.control??child.props['data-control']??(String(child.props.className??'').split(' ').includes('cwd')?'directory':undefined),field=fields[key]
   if(!field)return <div className="message-runtime-note" key={index}>{child}</div>
   return <section className={'message-runtime-field'+(key==='directory'?' is-wide':'')} key={key}><h3><Icon name={field[1]}/>{t(field[0])}</h3><div className="message-runtime-control">{child}</div><p>{t(field[2])}</p></section>
  })}</div>
 </MessageWorkspace>
}
