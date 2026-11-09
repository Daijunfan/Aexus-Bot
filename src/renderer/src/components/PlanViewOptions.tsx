import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {PLAN_TABLE_PROPERTIES,planFilterCount,type PlanViewSpec} from '../../../shared/plan'
import type {Store} from '../../../shared/types'
import {translate as t} from '../i18n'
import {useDialogFocus} from '../office/useDialogFocus'
import {AppSelect} from './AppSelect'
import {Icon} from './Icon'
import {PlanFilterFields} from './PlanFilterFields'

/** Per-view presentation controls never mutate a task or its execution settings. */
export function PlanViewOptions({store,value,onChange,onSave,saveExisting=false}:{store:Store;value:PlanViewSpec;onChange:(next:PlanViewSpec)=>void;onSave:()=>void;saveExisting?:boolean}){
 const [open,setOpen]=useState(false),[tab,setTab]=useState<'display'|'filters'>('display'),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),[position,setPosition]=useState({left:8,top:8,maxWidth:innerWidth-16,maxHeight:innerHeight-16})
 const hasDisplay=['table','board','list','gallery'].includes(value.layout),filterCount=planFilterCount(value.filter)
 useDialogFocus('.plan-view-options',open,()=>trigger.current)
 useEffect(()=>{if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing&&!document.querySelector('.app-select-menu')){event.preventDefault();setOpen(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[open])
 useLayoutEffect(()=>{if(!open)return;const place=()=>{if(!trigger.current||!panel.current)return;const scale=parseFloat(getComputedStyle(document.documentElement).zoom)||1,box=trigger.current.getBoundingClientRect(),maxWidth=innerWidth/scale-16,maxHeight=innerHeight/scale-16,width=Math.min(panel.current.offsetWidth,maxWidth),height=Math.min(panel.current.offsetHeight,maxHeight);setPosition({left:Math.max(8,Math.min(box.right/scale-width,innerWidth/scale-width-8)),top:Math.max(8,Math.min(box.bottom/scale+8,innerHeight/scale-height-8)),maxWidth,maxHeight})};place();const resize=new ResizeObserver(place);resize.observe(panel.current!);window.addEventListener('resize',place);return()=>{resize.disconnect();window.removeEventListener('resize',place)}},[open])
 const options=(patch:Partial<NonNullable<PlanViewSpec['options']>>)=>onChange({...value,options:{...value.options,...patch}})
 return <>
  <button ref={trigger} className="plan-options-trigger" type="button" aria-label={t('View options')} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(!open)}><Icon name="settings-gear"/>{t('View')}{filterCount>0&&<b>{filterCount}</b>}</button>
  {open&&createPortal(<div className="plan-view-options-overlay"><div className="plan-view-options-backdrop" onClick={()=>setOpen(false)}/><section ref={panel} className="plan-view-options" role="dialog" aria-modal="true" aria-label={t('View options')} style={position}>
   <header><div><strong>{t('View options')}</strong><small>{t('Customize this view without changing your tasks.')}</small></div><button type="button" aria-label={t('Close view options')} onClick={()=>setOpen(false)}><Icon name="close"/></button></header>
   {hasDisplay&&<div className="plan-view-option-tabs" role="group" aria-label={t('View settings section')}><button type="button" aria-pressed={tab==='display'} onClick={()=>setTab('display')}><Icon name="table"/>{t('Display')}</button><button type="button" aria-pressed={tab==='filters'} onClick={()=>setTab('filters')}><Icon name="filter"/>{t('View filters')}{filterCount>0&&<b>{filterCount}</b>}</button></div>}
   <div className="plan-view-options-body">
    {tab==='filters'||!hasDisplay?<><p className="plan-view-filter-note">{t('Only this view. Global filters still apply.')}</p><PlanFilterFields store={store} value={value.filter} onChange={patch=>onChange({...value,filter:{...value.filter,...patch}})}/>{(value.filter.allOf?.length||value.filter.excludeIds?.length||value.filter.channel)&&<small>{t('Additional saved conditions are active. Clear view filters to remove them.')}</small>}<button className="plan-view-filter-clear" type="button" disabled={!filterCount} onClick={()=>onChange({...value,filter:{}})}>{t('Clear view filters')}</button></>:<>
    <label>{t('Sort by')}<AppSelect aria-label={t('Plan sorting')} value={value.sort} onChange={event=>onChange({...value,sort:event.target.value as PlanViewSpec['sort']})}>{[['nextAt','Next run'],['name','Task name'],['updatedAt','Last updated'],['priority','Priority']].map(([id,name])=><option key={id} value={id}>{t(name)}</option>)}</AppSelect></label>
    <div className="plan-option-segments" role="group" aria-label={t('Sort direction')}>{(['asc','desc'] as const).map(direction=><button type="button" key={direction} aria-pressed={value.direction===direction} onClick={()=>onChange({...value,direction})}><Icon name={direction==='asc'?'arrow-up':'arrow-down'}/>{t(direction==='asc'?'Ascending':'Descending')}</button>)}</div>
    <fieldset><legend>{t('Density')}</legend><div className="plan-option-segments">{(['comfortable','compact'] as const).map(density=><button type="button" key={density} aria-pressed={(value.options?.density??'comfortable')===density} onClick={()=>options({density})}>{t(density==='compact'?'Compact':'Comfortable')}</button>)}</div></fieldset>
    {value.layout==='table'&&<fieldset className="plan-property-choices"><legend>{t('Visible properties')}</legend>{PLAN_TABLE_PROPERTIES.map(property=><label key={property.id}><Icon name={property.id==='employee'?'person':property.id==='priority'?'flag':property.id==='tags'?'tag':property.id==='rule'?'refresh':property.id==='status'?'circle-outline':'calendar'}/><span>{t(property.label)}</span><input type="checkbox" aria-label={t('Show {0}',[t(property.label)])} checked={!value.options?.hiddenProperties?.includes(property.id)} onChange={()=>options({hiddenProperties:value.options?.hiddenProperties?.includes(property.id)?value.options.hiddenProperties.filter(id=>id!==property.id):[...(value.options?.hiddenProperties??[]),property.id]})}/></label>)}<small>{t('Task titles and actions always stay visible.')}</small></fieldset>}
    </>}
   </div>
   <footer><button type="button" onClick={()=>{setOpen(false);onSave()}}><Icon name="bookmark"/>{t(saveExisting?'Save view':'Save as view')}</button><button className="primary" type="button" onClick={()=>setOpen(false)}>{t('Done')}</button></footer>
  </section></div>,document.body)}
 </>
}
