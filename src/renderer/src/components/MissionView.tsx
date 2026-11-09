import type {Store} from '../../../shared/types'
import type {ViewState} from '../../../shared/view'
import {Icon} from './Icon'
import {PlanView} from './PlanView'
import {translate as t} from '../i18n'
export function MissionView({store,view,act}:{store:Store;view:ViewState;act:(command:string,args?:Record<string,unknown>)=>Promise<any>}){
 const selected=view.missionTab??'plan',tabs=['plan','engineering','research'] as const
 return <section className="mission-workspace">
  {view.missionNavigationOpen&&<nav className="mission-subviews" id="mission-subview-navigation" aria-label={t('Mission subviews')}><div role="tablist" aria-label={t('Mission subviews')} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')],index=buttons.indexOf(event.target as HTMLButtonElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;void act('view.select',{id:'plan',missionTab:tabs[next]});buttons[next].focus()}}>{tabs.map(tab=><button type="button" key={tab} role="tab" id={'mission-tab-'+tab} tabIndex={selected===tab?0:-1} aria-selected={selected===tab} aria-controls={tab==='plan'?'mission-plan-panel':'mission-placeholder-panel'} aria-expanded={tab==='plan'?selected==='plan'&&!!view.planNavigationOpen:undefined} onClick={()=>void act(tab==='plan'&&selected==='plan'?'view.navigation':'view.select',tab==='plan'&&selected==='plan'?{section:'plan'}:{id:'plan',missionTab:tab})}><Icon name={tab==='plan'?'table':tab==='engineering'?'tools':'beaker'}/>{tab==='plan'?'Plan':tab==='engineering'?'Engineering':'Research'}{tab==='plan'&&<Icon className="subview-nav-chevron" name={view.planNavigationOpen?'chevron-down':'chevron-right'}/>}</button>)}</div></nav>}
  {selected==='plan'?<div id="mission-plan-panel" className="mission-plan-panel" role="tabpanel" aria-label="Plan"><PlanView store={store} view={view} act={act}/></div>:<section id="mission-placeholder-panel" className="mission-placeholder" role="tabpanel" aria-label={selected==='engineering'?'Engineering':'Research'} data-mission-tab={selected}><h1>{selected==='engineering'?'Engineering':'Research'}</h1></section>}
 </section>
}
