import {onPluginFlush,flushPlugins} from '../plugins'
import {useBeforeUnloadGuard} from './useBeforeUnloadGuard'
import {WorkersView} from './WorkersView'
import {AgentBoard,type BoardDrafts} from './AgentBoard'
import {NativeWorkerDialog} from './NativeWorkerDialog'
import {useCatalog} from './useCatalog'
import {Icon} from './Icon'
import {EngineMark} from './EngineMark'
import type {NativeWorker} from '../../../shared/native-worker'
import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {retainEqual} from '../snapshot'
import type {ManagementInteraction} from '../../../shared/management'
import {EmployeeDeleteDialog} from './EmployeeDeleteDialog'
import {EmployeeInitialization} from './EmployeeInitialization'
import {CloneEmployeeForm} from './CloneEmployeeForm'
import type {RemoteCheck,RemoteHealth} from '../../../shared/remote'
import { memo, useCallback, useEffect,useRef, useState, type ReactNode } from 'react'
import {ALL_TEAM_VIEW,employeeReady,teamSettings,type ActivityPreview,type TeamSettings,type Store,type StoredSession,type Session} from '../../../shared/types'
import type {PluginDescriptor} from '../../../shared/plugins'
import {api} from '../api'
import type {ViewState} from '../../../shared/view'
import {SettingsPanel} from './SettingsPanel'
import {mergePreferences,presentationForView} from '../../../shared/preferences'
import {PluginDirectory} from './PluginDirectory'
import { initialBounds, planOffice, DEFAULT_VIEW, type Point, type Viewport } from '../../../shared/canvas'
import { OfficeCanvas } from '../office/OfficeCanvas'
import { useDialogFocus } from '../office/useDialogFocus'
import { EmployeeForm, TeamForm } from '../office/OfficeForms'
import { SharedDrawer } from './SharedDrawer'
import { TeamWorkspace } from './TeamWorkspace'
import {TeamViews} from './TeamViews'
import {EmployeeProfile} from './EmployeeProfile'
import {BackButton} from './BackButton'
import companyIcon from '../../../../app_icon.png'

type Action = (cmd: string, args?: Record<string, unknown>, propagateError?:boolean) => Promise<any>
type HostHealth=RemoteHealth&{checkedAt?:number;error?:string}
export const HomeView=memo(function HomeView({ groupUnread=0, store, view, sessions=[], busyIds,disconnectedIds,activities,interactions, onOpen, act, onResize, assetWidth, onAssetResize, children,underHeader }: {groupUnread?:number;children?:ReactNode;underHeader?:ReactNode;interactions:ManagementInteraction[];activities:Record<string,ActivityPreview>;store:Store;view:ViewState;sessions?:Session[];busyIds:Set<string>;disconnectedIds:Set<string>;onOpen:(card:StoredSession)=>void;act:Action;onResize:(width:number|undefined)=>void;assetWidth:number;onAssetResize:(width:number|undefined)=>void}) {
  useI18n()

  const teamTab=view.teamTab??'characters',[boardDrafts,setBoardDrafts]=useState<BoardDrafts>({}),[workerDrafts,setWorkerDrafts]=useState<BoardDrafts>({})
  const creationAttempt=useRef({panel:'',signature:'',id:crypto.randomUUID()});const formIdentity=JSON.stringify([view.kind,view.employee,view.name]);if(creationAttempt.current.panel!==formIdentity)creationAttempt.current={panel:formIdentity,signature:'',id:crypto.randomUUID()}
  const [creatingWorker,setCreatingWorker]=useState(false),[focusWorker,setFocusWorker]=useState<string>()
  const workers=useCatalog<NativeWorker>('worker.list',presentationForView(view)==='company',event=>event.channel==='workers:changed'||event.channel==='terminal:changed'||event.channel==='store:changed')
  const panel: {kind:'employee';card?:StoredSession}|{kind:'team';name?:string;settings?:TeamSettings}|null=view.kind==='team'?{kind:'team' as const,name:view.name,settings:view.settings}:view.kind==='employee'?{kind:'employee' as const,card:store.sessions.find(c=>c.id===view.employee)}:null
  const editablePanel=!!panel&&!(panel.kind==='employee'&&panel.card),formExit=useRef({dirty:false,saving:false,done:false}),panelActive=useRef(editablePanel);panelActive.current=editablePanel
  const [discardForm,setDiscardForm]=useState(false)
  useBeforeUnloadGuard(()=>panelActive.current&&!formExit.current.done&&(formExit.current.dirty||formExit.current.saving))
  useEffect(()=>{if(!editablePanel){formExit.current={dirty:false,saving:false,done:false};setDiscardForm(false)}},[editablePanel])
  useEffect(()=>onPluginFlush(async()=>{if(!panelActive.current||formExit.current.done)return;if(formExit.current.saving)throw Error('Wait for this form to finish saving.');if(formExit.current.dirty){setDiscardForm(true);throw Error('Save or discard this form before leaving.')}}),[])
  const addWorker=()=>void act('view.select',{id:'company',teamTab:'workers'}).then(value=>{if(value)setCreatingWorker(true)})
  const initializing=view.kind==='initialization'?store.sessions.find(card=>card.id===view.employee):undefined
  const cloning=view.kind==='clone'?store.sessions.find(c=>c.id===view.employee):undefined
  const workspace=view.kind==='workspace'?view.name??null:null
  const setPanel=(value:typeof panel)=>value?act('view.open',value.kind==='employee'?{kind:'employee',employee:value.card?.id}:value):act('view.close')
  const setWorkspace=(name:string|null)=>name?act('view.open',{kind:'workspace',name}):act('view.close')
  const pluginId=view.pluginId??null
  const selectedView=store.teamViews?.find(item=>item.id===store.activeTeamViewId)
  const visibleGroups=selectedView?store.groups.filter(name=>selectedView.teams.includes(name)):store.groups
  const teamEmployees=selectedView?store.sessions.filter(card=>visibleGroups.includes(card.group)):store.sessions,teamStore=selectedView?{...store,groups:visibleGroups,sessions:teamEmployees}:store
  const [editMode,setEditMode]=useState<'employee'|'team'|null>(null),[selected,setSelected]=useState<string[]>([])
  const [removal,setRemoval]=useState<{employees:StoredSession[];teams?:string[]}|null>(null)
  const selectionKey=JSON.stringify([store.activeTeamViewId,visibleGroups])
  useEffect(()=>{setSelected([])},[selectionKey])
  const selectedIds=selected.filter(id=>editMode==='team'?visibleGroups.includes(id):store.sessions.some(card=>card.id===id&&visibleGroups.includes(card.group)))
  const chooseMode=(mode:typeof editMode)=>{setSelected([]);setEditMode(mode)}
  const toggleSelection=(id:string)=>setSelected(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id])
  const deleteSelection=()=>setRemoval({employees:store.sessions.filter(card=>editMode==='team'?selectedIds.includes(card.group):selectedIds.includes(card.id)),...(editMode==='team'?{teams:[...selectedIds]}:{})})
  const [plugins,setPlugins]=useState<PluginDescriptor[]>([])
  useEffect(()=>{const load=()=>void api.call<PluginDescriptor[]>('plugin.list').then(value=>setPlugins(previous=>retainEqual(previous,value))).catch(()=>{});load();return api.onEvent(e=>{if(e.channel==='store:changed')load()})},[])
  const [cloudStatus,setCloudStatus]=useState<Record<string,HostHealth>>({})
  const cloudKey=JSON.stringify(visibleGroups.filter(name=>teamSettings(store,name).mode==='cloud').map(name=>[name,teamSettings(store,name).hostId,teamSettings(store,name).remote]))
  const [checkingHosts,setCheckingHosts]=useState(false),checkingHostsRef=useRef(false)
  useEffect(()=>{
    const teams=JSON.parse(cloudKey) as [string,string|undefined,unknown][]
    let active=true
    const update=(id:string,status:HostHealth)=>{if(active)setCloudStatus(previous=>{
      const next={...previous};for(const [name,hostId] of teams)if(hostId===id&&(status.checkedAt??0)>=(previous[name]?.checkedAt??0))next[name]=status
      return next
    })}
    // Read the last saved result only. SSH probes are explicitly requested by the user.
    void api.call<Array<{id:string;status?:HostHealth}>>('host.list').then(hosts=>{for(const host of hosts)if(host.status)update(host.id,host.status)}).catch(()=>{})
    const off=api.onEvent(event=>{if(event.channel==='host:health'){const {id,status}=event.payload as {id:string;status:HostHealth};update(id,status)}})
    return()=>{active=false;off()}
  },[cloudKey])
  const refreshHosts=async()=>{
    if(checkingHostsRef.current)return
    checkingHostsRef.current=true;setCheckingHosts(true)
    const teams=JSON.parse(cloudKey) as [string,string|undefined,unknown][]
    const hosts=new Map(teams.map(team=>[team[1]??team[0],team]))
    try{await Promise.all([...hosts.values()].map(async([name,hostId])=>{
      let status:HostHealth
      try{status=hostId?await api.call<HostHealth>('host.check',{id:hostId}):{connected:true,checkedAt:Date.now(),environment:(await api.call<RemoteCheck>('remote.check',{team:name})).environment}}
      catch(error){status={connected:false,checkedAt:Date.now(),error:(error as Error).message}}
      setCloudStatus(previous=>({...previous,...Object.fromEntries(teams.filter(team=>hostId?team[1]===hostId:team[0]===name).map(([team])=>[team,status]))}))
    }))}finally{checkingHostsRef.current=false;setCheckingHosts(false)}
  }
  const camera=useRef({view:DEFAULT_VIEW,size:{x:1200,y:800}})
  const onView=useCallback((view:Viewport,size:Point)=>{camera.current={view,size}},[])
  useDialogFocus('.office-panel',!!panel||!!cloning||view.kind==='settings')
  const showPanel=(value:NonNullable<typeof panel>)=>setPanel(value)
  const open=useCallback((card:StoredSession)=>{if(employeeReady(card))onOpen(card);else void act('view.open',{kind:'initialization',employee:card.id})},[onOpen,act])
  const edit=useCallback((name:string)=>{if(name&&store.teamRoots?.[name])setWorkspace(name);else setPanel({kind:'team',name:name||undefined})},[store.teamRoots])
  const fresh=initialBounds(store.groups.length)
  fresh.x=(camera.current.size.x/2-camera.current.view.x)/camera.current.view.zoom-fresh.width/2
  fresh.y=(camera.current.size.y/2-camera.current.view.y)/camera.current.view.zoom-fresh.height/2
  const lastEmployee=store.lastEmployeeTemplate??store.sessions.reduce<StoredSession|undefined>((latest,card)=>!latest||card.createdAt>latest.createdAt?card:latest,undefined)
  const lastTeam=store.groups.at(-1)
  return <div className="home office-home">
    <header className="company-header">
      <div className="company-brand"><img className="brand-symbol" src={companyIcon} alt="" aria-hidden="true"/><span>Aexus Bot</span></div>
      <TeamViews store={store} view={view} act={act} groupUnread={groupUnread}/>
      {presentationForView(view)==='company'&&<div className="company-actions"><button className="add-team" aria-label={uiText("Add Team")} title={uiText("Add Team")} onClick={()=>void showPanel({kind:'team'})}><Icon name="organization"/> {uiText("Add Team")}</button><button className="add-employee" aria-label={uiText("Add Employee")} title={uiText("Add Employee")} onClick={()=>void showPanel({kind:'employee'})}><Icon name="person-add"/> {uiText("Add Employee")}</button><button className="add-worker" aria-label={uiText('Add Worker')} title={uiText('Add Worker')} onClick={addWorker}><Icon name="terminal"/> {uiText('Add Worker')}</button></div>}
    </header>
    {underHeader}
    <div className={`office-layout ${view.shared?'shared-open':''}`}><PluginDirectory homeActive={view.kind==='home'&&!pluginId} settingsOpen={view.kind==='settings'} canvasTools={!children&&teamTab==='characters'} english={view.kind==='messages'} editing={editMode!==null} onToggleEdit={()=>{if(children||teamTab!=='characters')void act('view.open',{kind:'home',teamTab:'characters'});chooseMode(editMode?null:'employee')}} checkingHosts={checkingHosts} onRefreshHosts={()=>void refreshHosts()} plugins={plugins} active={pluginId} store={store} sharedOpen={!!view.shared} onOpen={id=>void act('plugin.open',{id})} onHome={()=>void act('view.open',{kind:'home'})} onSettings={()=>void act('view.open',{kind:'settings'})} onResize={onResize} act={act}/>{view.shared&&<SharedDrawer width={assetWidth} onResize={onAssetResize} onClose={()=>void act('view.shared',{enabled:false})}/>}{children??<div className="team-content">{view.teamNavigationOpen&&<nav className="team-subviews" id="team-subview-navigation" aria-label={uiText('Team views')}><div role="tablist" aria-label={uiText('Team subviews')}>{(['characters','board','workers'] as const).map(tab=><button key={tab} type="button" role="tab" id={"team-tab-"+tab} aria-controls="team-subview-panel" tabIndex={teamTab===tab?0:-1} aria-selected={teamTab===tab} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=['characters','board','workers'] as const,next=tabs[event.key==='Home'?0:event.key==='End'?2:(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:2))%3];chooseMode(null);void act('view.select',{id:'company',teamTab:next});document.getElementById('team-tab-'+next)?.focus()}} onClick={()=>{chooseMode(null);void act('view.select',{id:'company',teamTab:tab})}}><Icon name={tab==='characters'?'organization':tab==='board'?'layout':'terminal'}/>{tab==='characters'?'Characters':tab==='board'?'Board':'Workers'}</button>)}</div>{selectedView&&teamTab!=='workers'&&<div className="team-scope-pill"><span title={selectedView.name}>{selectedView.name}</span><button type="button" aria-label={uiText('Show all teams')} title={uiText('Show all teams')} onClick={()=>void act('view.select',{id:'company',teamViewId:'all',teamTab})}><Icon name="close"/></button></div>}<span>{teamTab==='workers'?<>{workers.value.length} Worker</>:<>{teamEmployees.filter(card=>!card.deleting).length} {uiText(teamEmployees.filter(card=>!card.deleting).length===1?'Agent':'Agents')}</>}</span></nav>}<div className="team-subview-panel" id="team-subview-panel" role="tabpanel" aria-label={'Team / '+teamTab} aria-labelledby={view.teamNavigationOpen?'team-tab-'+teamTab:undefined}>{teamTab==='board'?<AgentBoard catalogStore={store} store={teamStore} sessions={sessions} obscured={view.kind!=='home'||creatingWorker||!!removal} drafts={boardDrafts} setDrafts={setBoardDrafts} onOpen={open}/>:teamTab==='workers'?<WorkersView store={store} workers={workers.value} obscured={view.kind!=='home'||creatingWorker||!!removal} drafts={workerDrafts} setDrafts={setWorkerDrafts} focusWorker={focusWorker} onAdd={addWorker} refresh={workers.refresh} error={workers.error} loading={workers.loading}/>:<OfficeCanvas obscured={view.kind!=='home'||creatingWorker||!!removal} selection={editMode?{mode:editMode,ids:new Set(selectedIds),toggle:toggleSelection}:undefined} interactions={interactions} key={`${store.activeTeamViewId??ALL_TEAM_VIEW}:${selectedView?JSON.stringify(selectedView.teams):''}`} activities={activities} cloudStatus={cloudStatus} plugins={plugins} store={store} busyIds={busyIds} disconnectedIds={disconnectedIds} act={act} onOpen={open} onEdit={edit} onView={onView}/>}</div></div>}</div>
    {editMode&&!children&&teamTab==='characters'&&<aside className="canvas-edit-toolbar" role="toolbar" aria-label={uiText("Canvas editing")}>
      <div className="canvas-edit-modes"><button aria-pressed={editMode==='employee'} onClick={()=>chooseMode('employee')}>{uiText("Select employees")}</button><button aria-pressed={editMode==='team'} onClick={()=>chooseMode('team')}>{uiText("Select teams")}</button></div>
      <p>{uiText("Click on the canvas to select")}{editMode==='employee'?uiText("employee"):uiText("Team")}{uiText("for multiple selection.")}</p>
      <div className="canvas-edit-selection"><span role="status">{uiText("selected")} {selectedIds.length} {editMode==='employee'?uiText("employees"):uiText("team")}</span><button disabled={!selectedIds.length} onClick={()=>setSelected([])}>{uiText("Clear selection")}</button></div>
      <footer><button className="delete-selected" disabled={!selectedIds.length} onClick={deleteSelection}>{uiText("Delete selected")}</button><button onClick={()=>chooseMode(null)}>{uiText("Exit editing")}</button></footer>
    </aside>}
    {creatingWorker&&<NativeWorkerDialog store={store} onClose={()=>setCreatingWorker(false)} onCreated={worker=>{setFocusWorker(worker.id);setCreatingWorker(false);void workers.refresh();void act('view.select',{id:'company',teamTab:'workers'})}}/>}
    {removal&&<EmployeeDeleteDialog employees={removal.employees} teams={removal.teams} onCancel={()=>setRemoval(null)} onRemove={async deleteWorkspace=>{
      await api.call(removal.teams?'group.remove':'card.remove',{...(removal.teams?{names:removal.teams}:{ids:removal.employees.map(card=>card.id)}),deleteWorkspace})
      setRemoval(null);setSelected([])
    }}/>}
    {initializing&&<EmployeeInitialization employee={initializing} onClose={()=>void act('view.close')}/>}
    {view.kind==='settings'&&<SettingsPanel backLabel={view.returnTo?.kind==='messages'?'Back to conversation':view.returnTo?.kind==='plan'?'Back to Mission':'Back to Team'} initialView={presentationForView(view)} value={mergePreferences(store.preferences)} onSave={value=>act('settings.set',value,true)} onClose={()=>void act('view.close')}/>}
    {workspace&&<TeamWorkspace key={workspace} name={workspace} root={store.teamRoots?.[workspace]||''} settings={teamSettings(store,workspace)} onClose={()=>setWorkspace(null)} onSettings={()=>{void setPanel({kind:'team',name:workspace})}}/>}
    {cloning&&<div className="office-panel-wrap" onKeyDown={e=>{if(e.key==='Escape')void act('view.close')}}><div className="panel-backdrop" onClick={()=>void act('view.close')}/><section className="office-panel employee-clone-panel" role="dialog" aria-modal="true" aria-label={uiText("Clone employee")}><header className="employee-subpage-header"><BackButton ariaLabel="Close panel" onClick={()=>void act('view.close')}/><h2>{uiText("Clone employee")}</h2><span/></header><div className="profile-scroll profile-edit"><CloneEmployeeForm source={cloning} root={store.teamRoots?.[cloning.group]??''} onCreated={()=>void act('view.close')}/></div></section></div>}
    {panel?.kind==='employee'&&panel.card&&<div className="office-panel-wrap"><div className="panel-backdrop"/><section className="office-panel employee-profile-panel" role="dialog" aria-modal="true" aria-label={uiText('Employee details')}><EmployeeProfile key={panel.card.id} employee={panel.card} store={store} onBack={()=>void act('view.close')} backLabel={view.returnTo?.kind==='messages'?'Back to conversation':'Back to company'} onWorkspace={()=>void act('view.open',{kind:'conversation',employee:panel.card!.id})}/></section></div>}
    {panel&&!(panel.kind==='employee'&&panel.card)&&<div className="office-panel-wrap" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();void setPanel(null)}}}>
      <div className="panel-backdrop" onClick={()=>setPanel(null)}/>
      <section className={'office-panel'+(panel.kind==='employee'||panel.name===undefined?' creation-panel':'')} role="dialog" aria-modal="true" aria-label={panel.kind==='employee'?uiText("Create employee"):panel.name===undefined?uiText("Create Team"):uiText("Edit Team")}>
        <header className="panel-header"><div><h2>{panel.kind==='employee'?uiText('Create employee'):panel.name===undefined?uiText("Create Team"):uiText("{0}’s workspace",[panel.name||'待分配员工'])}</h2></div><button className="panel-close" onClick={()=>setPanel(null)} aria-label={uiText("Close panel")}>×</button></header>
        {discardForm&&<div className="creation-discard" role="alert"><p>{uiText('Discard unsaved form changes?')}</p><button type="button" onClick={()=>setDiscardForm(false)}>{uiText('Keep editing')}</button><button type="button" onClick={()=>{formExit.current.done=true;setDiscardForm(false);void setPanel(null)}}>{uiText('Discard changes')}</button></div>}
        {panel.kind==='employee'?<>{!visibleGroups.length&&<p className="workspace-note">{uiText('Create a team first')}</p>}<EmployeeForm inert={discardForm} onDirtyChange={value=>{formExit.current.dirty=value}} onSavingChange={value=>{formExit.current.saving=value}} onCancel={()=>{formExit.current.done=true;void setPanel(null)}} employee={panel.card} template={panel.card?undefined:lastEmployee} groups={panel.card?store.groups:visibleGroups} roots={store.teamRoots??{}} settings={store.teamSettings} onSave={async fields=>{
          const {teamRoot,...patch}=fields;patch.title=patch.title.trim()
          if(teamRoot&&teamRoot!==store.teamRoots?.[fields.group])await api.call('group.root',{name:fields.group,root:teamRoot,create:true})
          if(!panel.card){const signature=JSON.stringify(patch);if(signature!==creationAttempt.current.signature)creationAttempt.current={...creationAttempt.current,signature,id:crypto.randomUUID()}}
          const result=panel.card?await api.call('card.update',{id:panel.card.id,patch}):await api.call('card.create',{...patch,clientRequestId:creationAttempt.current.id})
          if(result){formExit.current.done=true;await setPanel(null)}return !!result
        }} onBound={card=>{formExit.current.done=true;void act('view.open',{kind:'conversation',employee:card.id})}}/></>:<TeamForm inert={discardForm} onDirtyChange={value=>{formExit.current.dirty=value}} onSavingChange={value=>{formExit.current.saving=value}} onCancel={panel.name===undefined?()=>{formExit.current.done=true;void setPanel(null)}:undefined} name={panel.name} root={store.teamRoots?.[panel.name??'']} settings={panel.settings??teamSettings(store,panel.name??'')} template={panel.name===undefined?(store.lastTeamTemplate??(lastTeam?{settings:teamSettings(store,lastTeam),design:store.rooms?.[lastTeam]?.design,bounds:planOffice(store).find(room=>room.name===lastTeam)?.bounds}:undefined)):undefined} plugins={plugins} employeeCount={store.sessions.filter(card=>card.group===panel.name).length} index={Math.max(0,panel.name===undefined?store.groups.length:store.groups.indexOf(panel.name))}
          layout={panel.name===undefined?{col:0,row:0,w:1,h:1,bounds:fresh}:{...(store.rooms?.[panel.name]??{col:0,row:0,w:1,h:1}),bounds:planOffice(store).find(room=>room.name===panel.name)?.bounds}}
          onSave={async(name,root,design,bounds,config)=>{
            const target=name===''?'':name.trim()
            if(panel.name!==undefined&&target!==panel.name&&store.groups.includes(target))throw new Error('同名 Team 已存在')
            if(panel.name===undefined){const values={name:target,root,...config,design},signature=JSON.stringify(values);if(signature!==creationAttempt.current.signature)creationAttempt.current={...creationAttempt.current,signature,id:crypto.randomUUID()};if(!await act('group.add',{...values,clientRequestId:creationAttempt.current.id}))return false;formExit.current.done=true;await setPanel(null);return true}
            else {
              const before=teamSettings(store,panel.name)
              if(root!==store.teamRoots?.[panel.name]||before.mode!==config.mode||before.pluginId!==config.pluginId||before.hostId!==config.hostId||before.directory!==config.directory)throw new Error('Team 工作方式和工作目录创建后不可更换')
              if(target!==panel.name&&!await act('group.rename',{name:panel.name,nextName:target}))return false
            }
            if(!await act('room.design',{name:target,design}))return false
            formExit.current.done=true;await setPanel(null);return true
          }} onRemove={panel.name?async()=>{formExit.current.done=true;if(await act('group.remove',{name:panel.name})){await setPanel(null)}else formExit.current.done=false}:undefined}/>}
      </section>
    </div>}
  </div>
})
