import {CharacterLibrary} from './CharacterLibrary'
import {useEnabledAvatars} from './AvatarCatalog'
import {translate as uiText,useI18n} from '../i18n'
import {WallpaperSettings} from './WallpaperSettings'
import {DEFAULT_MESSAGE_WALLPAPER} from '../../../shared/message-wallpaper'
import {AppSelect} from './AppSelect'
import {EngineSettings} from './EngineSettings'
import {Icon} from './Icon'
import {BackButton} from './BackButton'
import licenseText from '../../../../LICENSE?raw'
import {useEffect,useRef,useState,type CSSProperties} from 'react'
import {usePreferencesAutosave} from './usePreferencesAutosave'
import {onPluginFlush} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
import {DEFAULT_PREFERENCES,DEFAULT_VIEW_APPEARANCE,PRESENTATION_VIEWS,COLOR_THEMES,THEMES,THEME_LABELS,mergePreferences,readableThemeAccent,type Preferences,type PreferencesPatch,type PresentationView,type ViewAppearance} from '../../../shared/preferences'
import '../styles/view-preferences.css'

const viewLabels={company:'Team',messages:'Message',plan:'Mission'},viewIcons={company:'organization',messages:'comment-discussion',plan:'checklist'}
const themeChoices:Preferences['theme'][]=[...COLOR_THEMES,...THEMES.filter(theme=>!COLOR_THEMES.some(color=>color===theme))]
type EmployeeDefaults=Pick<Preferences,'defaultPermissionMode'>
const employeeDefaults:EmployeeDefaults={defaultPermissionMode:DEFAULT_PREFERENCES.defaultPermissionMode}

export function SettingsPanel({value,onSave,onClose,initialView='company',backLabel='Back to company'}:{value:Preferences;onSave:(patch:PreferencesPatch)=>Promise<unknown>;onClose:()=>void;initialView?:PresentationView;backLabel?:string}){
 useI18n()
 const enabledCharacters=useEnabledAvatars(),[characterLibrary,setCharacterLibrary]=useState(false),[enginesVisited,setEnginesVisited]=useState(false)
 const auto=usePreferencesAutosave(onSave),[view,setView]=useState<PresentationView>(initialView),[employeeDraft,setEmployeeDraft]=useState<Partial<EmployeeDefaults>>({}),[employeeSaving,setEmployeeSaving]=useState(false),[employeeError,setEmployeeError]=useState(''),[employeeSaved,setEmployeeSaved]=useState(false),tabs=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null)
 const draft=mergePreferences(mergePreferences(value,auto.changes),employeeDraft),appearance=draft.viewAppearance[view]
 const employeePatch=Object.fromEntries(Object.entries(employeeDraft).filter(([key,next])=>next!==value[key as keyof EmployeeDefaults])) as Partial<EmployeeDefaults>,employeePending=Object.keys(employeePatch).length>0
 useBeforeUnloadGuard(employeePending||employeeSaving||auto.status==='saving'||auto.status==='error')
 const employeeSection=useRef<HTMLDetailsElement>(null)
 const employeeReady=()=>{
  if(!employeePending&&!employeeSaving)return true
  if(employeeSection.current){employeeSection.current.open=true;employeeSection.current.scrollIntoView({block:'nearest'});employeeSection.current.querySelector<HTMLButtonElement>('button[type=submit]')?.focus({preventScroll:true})}
  setEmployeeError(employeeSaving?'Wait for employee defaults to finish saving.':'Apply or discard employee defaults before leaving settings.')
  return false
 }
 useEffect(()=>onPluginFlush(async()=>{if(!employeeReady())throw Error(employeeSaving?'Wait for employee defaults to finish saving.':'Apply or discard employee defaults before leaving settings.')}),[employeePending,employeeSaving])
 const customStyle={'--custom-theme-color':appearance.themeColor,'--custom-theme-accent':readableThemeAccent(appearance.themeColor)} as CSSProperties
 const changeAppearance=(patch:Partial<ViewAppearance>,delay=0)=>auto.update({viewAppearance:{[view]:patch},...(view==='messages'&&patch.theme?{messageWallpaper:{palette:'theme' as const}}:{})},delay)
 const changeEmployee=(patch:Partial<EmployeeDefaults>)=>{setEmployeeDraft(previous=>({...previous,...patch}));setEmployeeSaved(false);setEmployeeError('')}
 useEffect(()=>{setEmployeeDraft(previous=>{const entries=Object.entries(previous).filter(([key,next])=>next!==value[key as keyof EmployeeDefaults]);return entries.length===Object.keys(previous).length?previous:Object.fromEntries(entries)})},[value.defaultPermissionMode,value.defaultCodexModel,value.defaultClaudeModel,value.defaultClineModel,value.defaultPiModel])
 const saveEmployee=async()=>{if(employeeSaving||!employeePending)return;setEmployeeSaving(true);setEmployeeError('');try{if(await onSave(employeePatch))setEmployeeSaved(true);else setEmployeeError('Settings could not be saved. Your changes are still here.')}catch(cause){setEmployeeError((cause as Error).message)}finally{setEmployeeSaving(false)}}
 const resetView=()=>auto.update({viewAppearance:{[view]:DEFAULT_VIEW_APPEARANCE[view]},...(view==='messages'?{messageWallpaper:{...DEFAULT_MESSAGE_WALLPAPER,palette:'theme',colors:['#bdcd8c'],rotation:0}}:{}),...(view==='company'?{showTeamOverview:DEFAULT_PREFERENCES.showTeamOverview}:{})})
 const resetShared=()=>auto.update({language:DEFAULT_PREFERENCES.language,pageZoom:DEFAULT_PREFERENCES.pageZoom,sidebarWidth:DEFAULT_PREFERENCES.sidebarWidth,explorerWidth:DEFAULT_PREFERENCES.explorerWidth,terminalHeight:DEFAULT_PREFERENCES.terminalHeight})
 const close=async()=>{if(employeeReady()&&await auto.flush())onClose()}
 const chooseView=(next:PresentationView)=>{setView(next);body.current?.scrollTo({top:0,behavior:'instant'})}
 const moveTab=(event:React.KeyboardEvent,index:number)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?PRESENTATION_VIEWS.length-1:(index+(event.key==='ArrowRight'?1:-1)+PRESENTATION_VIEWS.length)%PRESENTATION_VIEWS.length;chooseView(PRESENTATION_VIEWS[next]);tabs.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()}
 const themeButton=(theme:Preferences['theme'])=><button type="button" key={theme} data-theme-option={theme} aria-pressed={appearance.theme===theme} onClick={()=>changeAppearance({theme})}><span className={`settings-color-swatch theme-sample sample-${theme}`} style={theme==='custom'?customStyle:undefined} aria-hidden="true"/><span>{uiText(THEME_LABELS[theme])}</span>{appearance.theme===theme&&<Icon name="check"/>}</button>
 return <div className="office-panel-wrap" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.nativeEvent.isComposing&&!characterLibrary){event.preventDefault();void close()}}}><div className="panel-backdrop" onClick={()=>void close()}/><section className="office-panel preferences-panel view-preferences-panel" role="dialog" aria-modal="true" aria-label={uiText('Application settings')}>
  <header className="panel-header settings-back-header"><BackButton label={backLabel} ariaLabel="Close settings" disabled={employeeSaving} onClick={()=>void close()}/><h2>{uiText('Settings')}</h2><span className="settings-save-status" role="status" data-state={['saving','error'].includes(auto.status)?auto.status:employeePending?'pending':auto.status}><Icon name={auto.status==='saving'?'sync':auto.status==='error'?'warning':employeePending?'circle-filled':auto.status==='saved'?'check':'cloud-upload'}/><span>{uiText(auto.status==='saving'?'Saving…':auto.status==='error'?'Save failed':employeePending?'Employee defaults not applied':auto.status==='saved'?'Auto-saved':'Appearance and shared settings save automatically')}</span></span></header>
  <div ref={tabs} className="settings-view-tabs" role="tablist" aria-label={uiText('Settings for each view')}>{PRESENTATION_VIEWS.map((key,index)=><button key={key} id={'settings-tab-'+key} type="button" role="tab" aria-controls="settings-view-panel" aria-selected={view===key} tabIndex={view===key?0:-1} onClick={()=>chooseView(key)} onKeyDown={event=>moveTab(event,index)}><Icon name={viewIcons[key]}/>{viewLabels[key]}</button>)}</div>
  {auto.error&&<div className="settings-autosave-error" role="alert"><span>{uiText(auto.error)}</span><button type="button" onClick={auto.retry}>{uiText('Retry save')}</button></div>}
  <div ref={body} className="settings-scroll-body">
   <p className="settings-view-scope">{uiText('Appearance changes apply to {0}. Shared settings apply to every view.',[viewLabels[view]])}</p>
   <section id="settings-view-panel" className="settings-view-section" role="tabpanel" aria-labelledby={'settings-tab-'+view}>
    <div className="settings-section-heading"><h3>{uiText('Color scheme')}</h3><button type="button" onClick={resetView}>{uiText('Reset {0} settings',[viewLabels[view]])}</button></div>
    <div className={`settings-appearance-preview theme-sample sample-${appearance.theme}`} data-preview-view={view} style={customStyle} role="img" aria-label={uiText('{0} appearance preview',[viewLabels[view]])}>
     <div className="settings-preview-header" aria-hidden="true"><Icon name={viewIcons[view]}/><strong>{viewLabels[view]}</strong><span/></div>
     <div className="settings-preview-layout" aria-hidden="true"><aside><i/><i/><i/></aside><section>
      {view==='company'?<div className="settings-preview-team">{[0,1,2].map(key=><article key={key}><i/><b/><span/></article>)}</div>:view==='messages'?<div className="settings-preview-conversation"><article><b/><span/><span/></article><article><b/><span/></article><footer/></div>:<div className="settings-preview-mission"><header/><article><i/><b/><span/></article><article><i/><b/><span/></article><article><i/><b/><span/></article></div>}
     </section></div>
    </div>
    {view==='messages'&&<button type="button" className="settings-unify-appearance" onClick={()=>auto.update({viewAppearance:Object.fromEntries(PRESENTATION_VIEWS.map(key=>[key,{...appearance}]))})}><Icon name="color-mode"/>{uiText('Use this color scheme in all three views')}</button>}
    {view!=='messages'&&<button type="button" className="settings-use-message-appearance" onClick={()=>auto.update({viewAppearance:{[view]:{...draft.viewAppearance.messages}}})}><Icon name="comment-discussion"/>{uiText('Use Message appearance')}</button>}
    <div className="theme-presets" aria-label={uiText('Color scheme')}>{themeChoices.map(themeButton)}</div>
    <p className="settings-help">{uiText('Every view supports all color schemes. Message wallpaper follows the color scheme you choose.')}</p>
    <label className="custom-theme-color" htmlFor="custom-theme-color"><span>{uiText('Custom color')}</span><input id="custom-theme-color" name="themeColor" type="color" aria-label={uiText('Custom color')} value={appearance.themeColor} onChange={event=>changeAppearance({theme:'custom',themeColor:event.target.value},180)}/><output>{appearance.themeColor.toUpperCase()}</output></label>
    {view==='messages'&&<WallpaperSettings value={draft.messageWallpaper} appearance={appearance} onChange={(messageWallpaper,delay)=>auto.update({messageWallpaper},delay)}/>}
    {view==='company'&&<section className="settings-canvas-controls" aria-label={uiText('Team canvas')}><h3>{uiText('Characters')}</h3><p className="settings-help">{uiText('Automatically fits your teams. Large offices use bounded scrolling.')}</p>
     <label className="settings-toggle"><span>{uiText('Show team overview')}</span><input type="checkbox" name="showTeamOverview" checked={draft.showTeamOverview} onChange={event=>auto.update({showTeamOverview:event.target.checked})}/></label>
    </section>}
   </section>
   <section className="settings-shared" aria-label={uiText('Shared settings')}><div className="settings-section-heading"><h3>{uiText('Shared settings')}</h3><button type="button" onClick={resetShared}>{uiText('Restore shared defaults')}</button></div>
    <div className="settings-language"><label htmlFor="interface-language">{uiText('Interface language')}</label><AppSelect id="interface-language" name="language" aria-label={uiText('Interface language')} value={draft.language} onChange={event=>auto.update({language:event.target.value as Preferences['language']})}><option value="en">English</option><option value="zh-CN">简体中文</option></AppSelect></div>
    <label className="settings-range"><span>{uiText('Page size')}<output>{Math.round(draft.pageZoom*100)}%</output></span><input aria-label={uiText('Page size')} title={uiText('⌘ + to zoom in, ⌘ − to zoom out, ⌘ 0 to reset. Applies to text, controls and terminals.')} type="range" min="0.75" max="1.5" step="0.05" value={draft.pageZoom} onChange={event=>auto.update({pageZoom:+event.target.value},180)}/></label>
   </section>
   <section className="settings-character-library"><div><h3>{uiText('Characters')}</h3><p>{uiText('{0} enabled characters',[enabledCharacters.length])}</p></div><button type="button" onClick={()=>setCharacterLibrary(true)}><Icon name="person"/>{uiText('Manage characters')}</button></section>
   <details ref={employeeSection} className="settings-disclosure settings-employee-defaults"><summary><span>{uiText('Employee defaults')}</span>{employeePending&&<small>{uiText('Not applied')}</small>}<Icon name="chevron-down"/></summary><form onSubmit={event=>{event.preventDefault();void saveEmployee()}}><fieldset disabled={employeeSaving}>
    <label>{uiText('Default permissions')}<AppSelect aria-label={uiText('Default permissions')} value={draft.defaultPermissionMode} onChange={event=>changeEmployee({defaultPermissionMode:event.target.value as Preferences['defaultPermissionMode']})}><option value="default">{uiText('Ask · Approve when needed')}</option><option value="acceptEdits">{uiText('Workspace write · Allow workspace edits')}</option><option value="bypassPermissions">{uiText('Full access · Trust the engine’s system account')}</option></AppSelect><small>{uiText('Full access keeps all capabilities but does not provide operating-system isolation. Existing employee permissions are not raised automatically.')}</small></label>
    <p className="settings-help">{uiText('Employee defaults require Apply. They affect newly created employees.')} {uiText("Model defaults come from the native Coding Agent configuration.")}</p>
    {employeeError&&<p className="settings-employee-error" role="alert">{uiText(employeeError)}</p>}
    <div className="settings-employee-actions"><button type="button" className="settings-reset" onClick={()=>changeEmployee(employeeDefaults)}>{uiText('Restore employee defaults')}</button>{employeePending&&<button type="button" onClick={()=>{setEmployeeDraft({});setEmployeeError('');setEmployeeSaved(false)}}>{uiText('Discard changes')}</button>}<button type="submit" className="btn primary" disabled={employeeSaving||!employeePending}>{uiText(employeeSaving?'Saving…':'Apply employee defaults')}</button></div>{employeeSaved&&!employeePending&&<small className="settings-employee-saved" role="status">{uiText('Employee defaults saved')}</small>}
   </fieldset></form></details>
   <details className="settings-disclosure settings-engines" onToggle={event=>{if(event.currentTarget.open)setEnginesVisited(true)}}><summary><span>{uiText('Coding agent engines')}</span><Icon name="chevron-down"/></summary>{enginesVisited&&<EngineSettings/>}</details>
   <details className="settings-disclosure settings-license"><summary><span>{uiText('Open-source license')}</span><Icon name="chevron-down"/></summary><p>{uiText('Aexus Bot is distributed under GNU GPL v3, with modification and redistribution permitted under its terms and no warranty. Character assets and third-party components retain their own notices. Coding agent runtimes are installed separately under their own licenses.')}</p><details><summary>{uiText('Read GNU GPL v3')}</summary><pre>{licenseText}</pre></details></details>
  </div>
 </section>{characterLibrary&&<CharacterLibrary onClose={()=>setCharacterLibrary(false)}/>}</div>
}
