import {useEffect,useRef,useState,type DragEvent} from 'react'
import type {PluginDescriptor} from '../../../shared/plugins'
import {translate as t,useI18n} from '../i18n'
import {api} from '../api'
import {hasFileDrop,dropFiles} from '../file-transfers'
import {Icon} from './Icon'
import {PluginIcon} from './PluginIcon'
import {MessageMenu} from './MessageMenu'

type Props={plugins:PluginDescriptor[];active:string|null;settingsOpen:boolean;canvasTools:boolean;editing:boolean;overview:boolean;sharedOpen:boolean;checkingHosts:boolean;onToggleEdit:()=>void;onRefreshHosts:()=>void;onOpen:(id:string)=>void;onHome:()=>void;onSettings:()=>void;act:(cmd:string,args?:Record<string,unknown>)=>Promise<any>}
/** Global tools occupy the header; content keeps the full window width. */
export function ApplicationLauncher({plugins,active,settingsOpen,canvasTools,editing,overview,sharedOpen,checkingHosts,onToggleEdit,onRefreshHosts,onOpen,onHome,onSettings,act}:Props){
 useI18n()
 const [menu,setMenu]=useState<{kind:'settings'|'plugins';x:number;y:number;trigger:HTMLButtonElement}|null>(null),[error,setError]=useState(''),gear=useRef<HTMLButtonElement>(null)
 useEffect(()=>setMenu(null),[active,settingsOpen,canvasTools])
 const open=(kind:'settings'|'plugins',element:HTMLButtonElement)=>{const rect=element.getBoundingClientRect();setMenu({kind,x:rect.left,y:rect.bottom+7,trigger:element})}
 const toggle=(kind:'settings'|'plugins',element:HTMLButtonElement)=>{setError('');if(menu?.kind===kind)setMenu(null);else open(kind,element)}
 const run=(action:()=>void)=>{const trigger=menu?.trigger;setMenu(null);trigger?.focus({preventScroll:true});action()}
 const drop=(event:DragEvent)=>{if(!hasFileDrop(event.dataTransfer))return;event.preventDefault();setError('');void dropFiles(event.dataTransfer,{shared:true,path:'.'}).then(()=>{setMenu(null);return act('view.shared',{enabled:true})}).catch(cause=>{setError(cause.message);if(gear.current)open('settings',gear.current)})}
 const dragOver=(event:DragEvent)=>{if(hasFileDrop(event.dataTransfer)){event.preventDefault();event.dataTransfer.dropEffect='copy'}}
 const pluginButton=(plugin:PluginDescriptor,compact=false)=><button key={plugin.id} type="button" role={compact?undefined:'menuitem'} title={plugin.name} aria-label={t('Open {0}',[plugin.name])} data-plugin={plugin.id} aria-pressed={compact?active===plugin.id:undefined} onClick={()=>compact?onOpen(plugin.id):run(()=>onOpen(plugin.id))}><PluginIcon id={plugin.id}/>{!compact&&<><span>{plugin.name}</span><Icon className="application-menu-trailing" name="link-external"/></>}</button>
 return <div className="company-launcher" data-traffic-lights={api.mode==='desktop'&&api.platform==='macos'}>
  <button ref={gear} type="button" className="application-settings-trigger" aria-label={t('Application settings')} title={t('Settings')} aria-haspopup="menu" aria-expanded={menu?.kind==='settings'} data-active={settingsOpen} onClick={event=>toggle('settings',event.currentTarget)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();open('settings',event.currentTarget)}}} onDragOver={event=>{dragOver(event);if(hasFileDrop(event.dataTransfer)&&menu?.kind!=='settings'&&gear.current)open('settings',gear.current)}} onDrop={drop}><Icon name="gear"/></button>
  <nav className="application-plugins" aria-label={t('Applications')}>{plugins.slice(0,3).map(plugin=>pluginButton(plugin,true))}</nav>
  {plugins.length>0&&<button type="button" className="application-plugins-trigger" data-overflow={plugins.length>3} aria-label={t('Applications')} title={t('Applications')} aria-haspopup="menu" aria-expanded={menu?.kind==='plugins'} onClick={event=>toggle('plugins',event.currentTarget)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();open('plugins',event.currentTarget)}}}><Icon name="extensions"/></button>}
  {menu&&<MessageMenu key={menu.kind} anchor={menu} trigger={menu.trigger} onClose={()=>setMenu(null)} label={t(menu.kind==='plugins'?'Applications':'Application menu')} className="application-menu" motion="file-menu">
   <span className="application-menu-heading">{menu.kind==='plugins'?t('Applications'):'Aexus Bot'}</span>
   {menu.kind==='plugins'?plugins.map(plugin=>pluginButton(plugin)):<>
    <button type="button" role="menuitem" onClick={()=>run(onSettings)}><Icon name="settings-gear"/><span>{t('Settings')}</span><Icon className="application-menu-trailing" name="chevron-right"/></button>
    <hr/>
    <button type="button" role="menuitemcheckbox" aria-checked={sharedOpen} className="application-files" onDragOver={dragOver} onDrop={drop} onClick={()=>run(()=>{void act('view.shared',{enabled:!sharedOpen})})}><Icon name="folder-opened"/><span>{t('Files and assets')}</span>{sharedOpen&&<Icon className="application-menu-trailing" name="check"/>}</button>
    {canvasTools&&<><button type="button" role="menuitemcheckbox" aria-checked={editing} onClick={()=>run(onToggleEdit)}><Icon name="edit"/><span>{t('Edit canvas')}</span>{editing&&<Icon className="application-menu-trailing" name="check"/>}</button><button type="button" role="menuitemcheckbox" aria-checked={overview} onClick={()=>run(()=>{void act('settings.set',{showTeamOverview:!overview})})}><Icon name="location"/><span>{t('Team overview')}</span>{overview&&<Icon className="application-menu-trailing" name="check"/>}</button></>}
    <button type="button" role="menuitem" disabled={checkingHosts} aria-busy={checkingHosts} onClick={()=>run(onRefreshHosts)}><Icon className={checkingHosts?'is-checking':''} name="refresh"/><span>{t(checkingHosts?'Checking hosts…':'Refresh host status')}</span></button>
    <hr/><button type="button" role="menuitem" onClick={()=>run(onHome)}><Icon name="home"/><span>{t('Back to Team')}</span></button>
   </>}
   {error&&<p role="alert">{error}</p>}
  </MessageMenu>}
 </div>
}
