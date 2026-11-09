import {translate as t} from './i18n'
import './styles/desktop-quit.css'

/** Shared by the main shell, remote Web shell and plugin host. Native shortcuts
 * stay available while a save guard reports how to resolve a blocked quit. */
export function installDesktopQuitNotice(){
 const lifecycle=(window as any).agentsDesktopQuit as {onState:(handler:(state:{phase:string;message?:string})=>void)=>()=>void}|undefined
 if(!lifecycle)return
 let notice:HTMLElement|undefined;const inert=new Map<HTMLElement,boolean>()
 const restore=()=>{for(const [element,was] of inert)element.inert=was;inert.clear()}
 lifecycle.onState(state=>{
  restore();notice?.remove()
  notice=document.createElement('aside');notice.className='desktop-quit-notice';notice.dataset.phase=state.phase;notice.setAttribute('role',state.phase==='blocked'?'alert':'status')
  const card=document.createElement('div');card.className='desktop-quit-card'
  const title=document.createElement('strong');title.textContent=t(state.phase==='blocked'?'Could not quit Aexus Bot':state.phase==='saving'?'Saving before quitting…':'Stopping tasks and quitting…');card.append(title)
  const detail=document.createElement('p');detail.textContent=state.phase==='blocked'?t(state.message||'Save or discard pending changes, then press Command+Q again.'):t(state.phase==='saving'?'Your drafts and open files are being saved.':'Waiting for owned tasks and processes to stop.');card.append(detail)
  if(state.phase==='blocked'){const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent=t('Dismiss');dismiss.addEventListener('click',()=>{notice?.remove();notice=undefined});card.append(dismiss)}
  else{for(const element of document.body.children)if(element instanceof HTMLElement){inert.set(element,element.inert);element.inert=true}}
  notice.append(card);document.body.append(notice)
 })
}
