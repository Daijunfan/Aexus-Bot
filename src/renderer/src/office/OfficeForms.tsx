import {StorageFolderFields} from '../components/StorageFolderFields'
import {defaultStorageFolderName,type StorageFolderInput} from '../../../shared/storage-folder'
import {AvatarPicker} from '../components/AvatarPicker'
import {useEnabledAvatars} from '../components/AvatarCatalog'
import {directoryName} from '../../../shared/directory-names'
import {displayAvatar,randomAvatar} from '../../../shared/avatars'
import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {ENGINE_DEFINITIONS,assertEngineWorkspace} from '../../../shared/engines'
import {managementRoles,rolePolicy,type ManagementRole} from '../../../shared/roles'
import {Icon} from '../components/Icon'
import {ModelSelect} from '../components/ModelSelect'
import {AppSelect} from '../components/AppSelect'
import {EmployeeFolderPicker} from './EmployeeFolderPicker'
import { useEffect,useState,useRef } from 'react'
import {EmployeePortrait} from '../components/EmployeePortrait'
import {api} from '../api'
import { currentAvatar, SPRITE_COLORS, ROOM_THEMES, roomDesign, employeeDirectoryName, type RoomDesign } from '../../../shared/office'
import {ENGINES,canBindNativeSession,type Engine,type EmployeeKind,type RoomLayout,type StoredSession,type TeamSettings } from '../../../shared/types'
import type {PluginDescriptor} from '../../../shared/plugins'
import { Mascot } from './Mascot'
import { initialBounds, DEFAULT_POLYGON, MIN_ROOM_HEIGHT, type RoomBounds } from '../../../shared/canvas'
import { EngineMark } from '../components/EngineMark'

const THEMES = ['苔绿', '海蓝', '玫瑰', '琥珀', '暮紫', '岩灰']
export type EmployeeFields = Partial<StoredSession> & { title: string; engine: Engine; group: string; teamRoot?:string; directoryMode?:'default'|'bind' }
export function EmployeeForm({ employee, template, groups, roots = {}, settings={}, onSave,onBound,appearanceInitiallyOpen=false,onDirtyChange,onSavingChange,onConfigure,onCancel,inert=false }: {
  inert?:boolean;onCancel?:()=>void;onConfigure?:()=>void;appearanceInitiallyOpen?:boolean;onDirtyChange?:(dirty:boolean)=>void;onSavingChange?:(saving:boolean)=>void;employee?: StoredSession;template?:Partial<StoredSession>; groups: string[]; roots?: Record<string,string>; settings?:Record<string,TeamSettings>;onSave: (fields: EmployeeFields) => Promise<boolean>;onBound?:(card:StoredSession)=>Promise<void>|void
}) {
  useI18n()

  const availableAvatars=useEnabledAvatars()
  const [templateAvatar]=useState(()=>randomAvatar(availableAvatars))
  const [fields, setFields] = useState<EmployeeFields>({ title: '', engine: template?.engine??'codex',kind:'worker', group: template?.group&&groups.includes(template.group)?template.group:groups[0]??'', avatar: templateAvatar, accessory:template?.accessory??'none', color:SPRITE_COLORS[currentAvatar(templateAvatar)],role:template?.role??'',model:template?.model,effort:template?.effort,permissionMode:template?.permissionMode,thinking:template?.thinking,planMode:template?.planMode,fastMode:template?.fastMode,workEnvironment:'team',managementRole:'employee',...employee,...(employee&&!roots[employee.group]?{cwd:settings[employee.group]?.mode==='work'?employeeDirectoryName(employee.title):'.'}:{}) })
  const [saving, setSaving] = useState(false),[appearanceOpen,setAppearanceOpen]=useState(appearanceInitiallyOpen)
  const editBaseline=useRef(fields)
  useEffect(()=>{
    if(availableAvatars.includes(currentAvatar(fields.avatar??templateAvatar))||employee&&fields.avatar===employee.avatar)return
    const avatar=displayAvatar(fields.avatar??templateAvatar,availableAvatars)
    setFields(previous=>({...previous,avatar,color:SPRITE_COLORS[currentAvatar(avatar)]}))
  },[availableAvatars,fields.avatar,employee?.avatar,templateAvatar])

  useEffect(()=>{onSavingChange?.(saving);return()=>onSavingChange?.(false)},[saving,onSavingChange])
  const [folder,setFolder]=useState(''),[error,setError]=useState('')
  const localWorkspace=settings[fields.group]?.mode==='cloud'&&fields.workEnvironment==='local'
  const workspaceRoot=localWorkspace?folder:roots[fields.group]??folder
  const [directoryMode,setDirectoryMode]=useState<'default'|'bind'>(employee?.directoryMode??'default')
  useEffect(()=>{
    if(employee||!fields.group||groups.includes(fields.group))return
    setFields(previous=>({...previous,group:'',cwd:'',remote:undefined}));setDirectoryMode('default')
  },[groups,fields.group,employee])
  const [pickerOpen,setPickerOpen]=useState(false)
  const [engineCheck,setEngineCheck]=useState<{state:'idle'|'checking'|'ready'|'error';message:string}>({state:'idle',message:''})
  const [nativeSessions,setNativeSessions]=useState<{id:string;cwd:string;preview:string}[]>([]),[nativeId,setNativeId]=useState(''),[nativeBusy,setNativeBusy]=useState(false)
  const creationTouched=useRef(false),submitActive=useRef(false)
  useEffect(()=>{onDirtyChange?.(employee?['title','avatar','color','accessory','role'].some(key=>fields[key as keyof EmployeeFields]!==editBaseline.current[key as keyof EmployeeFields]):creationTouched.current||!!fields.title.trim())},[fields,folder,directoryMode,nativeId,employee,onDirtyChange])
  const report=(error:unknown)=>setError(String((error as Error).message||error).replace(/^Error invoking remote method '[^']+': Error: /,''))
  useEffect(()=>{let active=true;if(localWorkspace&&employee?.group===fields.group&&employee.localWorkspaceRoot){setFolder(employee.localWorkspaceRoot);return}if(!localWorkspace&&roots[fields.group]){setFolder(roots[fields.group]);return}setFolder('');if(fields.group)void api.call<{path:string}>('workspace.suggest',{team:fields.group,workEnvironment:fields.workEnvironment}).then(result=>{if(active)setFolder(result.path)}).catch(report);return()=>{active=false}},[fields.group,fields.workEnvironment,roots[fields.group]])
  useEffect(()=>setPickerOpen(false),[fields.group])
  useEffect(()=>{
    if(fields.kind!=='cloud-native-worker'||employee&&fields.engine===employee.engine){setEngineCheck({state:'ready',message:''});return}
    if(settings[fields.group]?.mode!=='cloud'){setEngineCheck({state:'error',message:'请先选择已绑定主机的云端 Team'});return}
    try{assertEngineWorkspace(fields.engine,'cloud',fields.kind)}catch(error){setEngineCheck({state:'error',message:(error as Error).message});return}
    let active=true;setEngineCheck({state:'checking',message:'正在检查云端 Coding Agent…'})
    void api.call<{version:string;authentication:string}>('engine.remote-check',{team:fields.group,engine:fields.engine}).then(result=>{if(active)setEngineCheck({state:'ready',message:`${result.version} · 认证 ${result.authentication}`})}).catch(error=>{if(active)setEngineCheck({state:'error',message:(error as Error).message})})
    return()=>{active=false}
  },[fields.kind,fields.group,fields.engine,employee?.engine,settings[fields.group]?.hostId])
  const patch = (next: Partial<EmployeeFields>) => {creationTouched.current=true;setFields((prev) => ({ ...prev, ...next }))}
  const work=settings[fields.group]?.mode==='work'
  const teamCloud=settings[fields.group]?.mode==='cloud'
  const cloud=teamCloud&&!localWorkspace
  const engineWorkspaceError=(engine:Engine)=>{try{assertEngineWorkspace(engine,work?'work':cloud?'cloud':'build',fields.kind??'worker');return ''}catch(error){return (error as Error).message}}
  const binding=!employee&&!cloud&&!roots[fields.group]
  const choose=async()=>{try{const result=await api.call<{path:string|null}>('workspace.choose',{path:fields.cwd||workspaceRoot});if(result.path){patch({cwd:result.path});setDirectoryMode('bind');setError('')}}catch(e){report(e)}}
  const nameField=<label>{uiText("Employee name")}<input name="title" autoFocus={!employee} required value={fields.title} onChange={(e) => patch({ title: e.target.value })} placeholder={uiText("e.g. Codey")} />{employee&&<small className="name-lock-note">{uiText("Only changes the display name; the working folder keeps its original name")}</small>}</label>
  return <form inert={inert} onChangeCapture={()=>{creationTouched.current=true}} className={'employee-form'+(!employee?' creation-form':'')} onSubmit={async (e) => { e.preventDefault();if(submitActive.current)return;if(!employee&&!groups.includes(fields.group)){setError('请选择当前视图中仍然存在的 Team');return} submitActive.current=true;setSaving(true);setError('');try { const saved=await onSave(employee?{title:fields.title,engine:fields.engine,group:employee.group,avatar:fields.avatar,accessory:fields.accessory,color:fields.color,role:fields.role}:{...fields,managementRole:fields.managementRole??'employee',accessMode:'trusted',remote:undefined,...(binding?{teamRoot:folder.trim()}:{}),directoryMode,cwd:directoryMode==='default'?undefined:fields.cwd?.trim()});if(!saved)setError('保存未完成，请检查目录配置。') } catch(error){report(error)} finally { submitActive.current=false;setSaving(false) } }}>
    <div className="creation-identity"><div className="employee-preview"><div className="preview-halo"/>{employee?<EmployeePortrait avatar={fields.avatar} color={fields.color} large/>:<Mascot kind={fields.avatar} accessory={fields.accessory} color={fields.color}/>}</div><div className="creation-identity-fields">{!employee&&nameField}<div className="appearance-actions">{!employee&&<button type="button" className="profile-change-character random-appearance" title={uiText("Random appearance")} aria-label={uiText("Random appearance")} onClick={()=>{const avatar=randomAvatar(availableAvatars);patch({avatar,color:SPRITE_COLORS[currentAvatar(avatar)],accessory:'none'});setAppearanceOpen(false)}}><Icon name="refresh"/></button>}<button type="button" className="profile-change-character" aria-expanded={appearanceOpen} onClick={()=>setAppearanceOpen(true)}><Icon name="edit"/>{uiText("Change character")}</button></div></div></div>
    {appearanceOpen&&<AvatarPicker value={fields.avatar??templateAvatar} onApply={avatar=>patch({avatar,color:SPRITE_COLORS[currentAvatar(avatar)],accessory:'none'})} onClose={()=>setAppearanceOpen(false)}/>}
    {employee&&nameField}
    <div className="form-row"><label>{uiText("Team membership")}<AppSelect name="group" disabled={!!employee} value={fields.group} onChange={(e) => {patch({ group: e.target.value,workEnvironment:settings[e.target.value]?.mode==='work'?'team':fields.workEnvironment, cwd: '',remote:undefined,...(fields.kind==='cloud-native-worker'?{model:undefined}:{}) });setDirectoryMode('default')}}><option value="" disabled>{uiText("Choose Team")}</option>{groups.filter(g=>fields.kind!=='cloud-native-worker'||settings[g]?.mode==='cloud').map((g) => <option key={g} value={g}>{g}{roots[g] ? '' : uiText("(Configure the directory below)")}</option>)}</AppSelect></label>{!employee&&<label>{uiText("Role")}<AppSelect name="managementRole" value={fields.managementRole??'employee'} onChange={event=>{const managementRole=event.target.value as ManagementRole;patch({managementRole})}}>{managementRoles().map(role=><option key={role.value} value={role.value} disabled={role.requiresLocal&&(cloud||fields.kind==='cloud-native-worker')}>{uiText(role.label)}</option>)}</AppSelect></label>}</div>
    <section className="creation-section creation-engine"><h3>{uiText("Coding engine")}<button type="button" className="creation-engine-settings" aria-label={uiText("Configure engines")} title={uiText("Configure engines")} onClick={()=>onConfigure?onConfigure():void api.call('view.open',{kind:'settings'})}><Icon name="settings-gear"/></button></h3>
    {employee?<div className="employee-engine-fixed"><EngineMark engine={employee.engine} size={22}/><span>{ENGINE_DEFINITIONS[employee.engine].label}<small>{uiText("The engine is fixed at creation. To change it, delete the employee and create a new one.")}</small></span></div>:<div className="engine-choices" role="group" aria-label={uiText("Coding engine")}>{ENGINES.map(({value:engine}) => <button type="button" key={engine} aria-label={ENGINE_DEFINITIONS[engine].label} data-engine={engine} aria-pressed={engine===fields.engine} disabled={!!engineWorkspaceError(engine)} title={engineWorkspaceError(engine)||undefined} className={engine === fields.engine ? 'selected' : ''} onClick={() => patch({ engine,model:undefined,thinking:false,effort:undefined,planMode:ENGINE_DEFINITIONS[engine].capabilities.plan?fields.planMode:false,fastMode:false })}><EngineMark engine={engine} size={22} /><span>{ENGINE_DEFINITIONS[engine].label}</span></button>)}</div>}
    {!employee&&<ModelSelect engine={fields.engine} kind={fields.kind} team={fields.kind==='cloud-native-worker'?fields.group:undefined} value={fields.model} onChange={model=>patch({model:model||undefined})}/>}
    </section>
    <details className="employee-advanced-settings" open={employee?true:undefined}><summary><Icon name="settings-gear"/>{uiText("Folder and advanced settings")}<Icon name="chevron-down"/></summary>
    <label>{uiText("Execution location")}<AppSelect name="kind" disabled={!!employee} value={fields.kind??'worker'} onChange={e=>{const kind=e.target.value as EmployeeKind;patch({kind,workEnvironment:kind==='cloud-native-worker'?'team':fields.workEnvironment,model:undefined,group:kind==='cloud-native-worker'&&settings[fields.group]?.mode!=='cloud'?'':fields.group,cwd:''});setDirectoryMode('default')}}><option value="worker">{uiText("Local engine")}</option><option value="cloud-native-worker">{uiText("Cloud engine")}</option></AppSelect></label>
    {teamCloud&&fields.kind!=='cloud-native-worker'&&<label>{uiText("Work environment")}<AppSelect name="workEnvironment" disabled={!!employee} value={fields.workEnvironment??'team'} onChange={event=>{const workEnvironment=event.target.value as 'team'|'local';patch({workEnvironment,cwd:''});setDirectoryMode('default')}}><option value="team">{uiText("Team folder")}</option><option value="local">{uiText("Local folder")}</option></AppSelect></label>}
    {employee&&<div className="profile-fixed-role" aria-label={uiText('Employee role')}><Icon name="lock"/><span><small>{uiText('Role')}</small><strong>{uiText(rolePolicy(employee.managementRole).label)}</strong></span><small>{uiText('Read-only in employee details')}</small></div>}


    {!employee&&engineWorkspaceError(fields.engine)&&<p className="employee-form-error" role="alert">{engineWorkspaceError(fields.engine)}</p>}
    {!employee&&<label>{uiText("Execution permissions")}<AppSelect name="permissionMode" value={fields.permissionMode??'default'} onChange={e=>patch({permissionMode:e.target.value as StoredSession['permissionMode']})}><option value="default">{uiText(fields.engine==='deepseek'?'Read only · Inspect without file changes':"Ask · Approve when needed")}</option><option value="acceptEdits">{uiText("Workspace write · Workspace edits")}</option><option value="bypassPermissions">{uiText("Full access · Trust the host account")}</option></AppSelect></label>}

    {fields.kind==='cloud-native-worker'&&<p className={`native-engine-check ${engineCheck.state}`} role="status">{engineCheck.message}</p>}
    {employee?.kind==='cloud-native-worker'&&<section className="native-session-bind"><strong>{uiText("Remote native session")}</strong>{(employee.threadId||employee.claudeSessionId)&&<p>{uiText("Linked")} {employee.engine==='codex'?'Codex':'Claude Agent'}  {uiText("Conversations")} <code>{employee.threadId??employee.claudeSessionId}</code>{employee.nativeOwnership==='external'?uiText(" · 外部会话，移除员工不会删除远端原件"):''}</p>}{canBindNativeSession(employee)&&<><p>{uiText("Start a new conversation, or bind an existing session on this cloud host in the same working directory.")}</p><button type="button" className="btn" disabled={nativeBusy||fields.engine!==employee.engine} onClick={async()=>{setNativeBusy(true);try{const result=await api.call<{sessions:{id:string;cwd:string;preview:string}[]}>('engine.remote-sessions',{team:fields.group,engine:employee.engine});setNativeSessions(result.sessions.filter(value=>value.cwd===employee.cwd&&value.id!==(employee.threadId??employee.claudeSessionId)));setError('')}catch(error){report(error)}finally{setNativeBusy(false)}}}>{nativeBusy?uiText("Reading sessions…"):uiText("Read existing sessions")}</button>{!!nativeSessions.length&&<><AppSelect name="nativeSession" value={nativeId} onChange={e=>setNativeId(e.target.value)}><option value="" disabled>{uiText("Choose a session in the same directory")}</option>{nativeSessions.map(value=><option key={value.id} value={value.id}>{value.preview||value.id}</option>)}</AppSelect><button type="button" className="btn" disabled={!nativeId||nativeBusy} onClick={async()=>{setNativeBusy(true);try{const result=await api.call<{card:StoredSession}>('card.native-bind',{id:employee.id,sessionId:nativeId});await onBound?.(result.card);setError('')}catch(error){report(error)}finally{setNativeBusy(false)}}}>{uiText("Bind selected session")}</button></>}{!nativeBusy&&nativeSessions.length===0&&<small>{uiText("Only sessions in the current working directory are shown.")}</small>}</>}</section>}
    <div className="workspace-contract"><span>{uiText("Team folder")}</span><code>{workspaceRoot||uiText("Choose a Team first")}</code>
      {employee?<label>{uiText("Fixed working directory")}<code className="default-employee-path">{employee.cwd}</code></label>:<><div className="directory-mode-options" role="group" aria-label={uiText("Employee directory mode")}>{(['default','bind'] as const).map(mode=><button type="button" key={mode} data-directory-mode={mode} aria-pressed={directoryMode===mode} className={directoryMode===mode?'selected':''} onClick={()=>{setDirectoryMode(mode);setPickerOpen(mode==='bind'&&(cloud||work));if(mode==='bind'){patch({cwd:''});if(!cloud&&!work)void choose()}setError('')}}>{mode==='default'?uiText("Create automatically"):uiText("Bind an existing folder")}</button>)}</div>
      {directoryMode==='default'?<label>{uiText("Default working directory")}<code className="default-employee-path" data-default-cwd>{`${workspaceRoot}/${fields.title.trim()?directoryName(fields.title,'employee'):'employee'}`}</code></label>:<><label>{uiText("Folder")}<div className="folder-input"><input name="cwd" required readOnly value={fields.cwd??''} placeholder={uiText("Choose an existing folder")}/><button type="button" onClick={()=>cloud||work?setPickerOpen(true):void choose()}>{uiText("Browse")}</button></div></label>{pickerOpen&&fields.group&&roots[fields.group]&&<EmployeeFolderPicker team={fields.group} cloud={cloud} windows={cloud&&settings[fields.group]?.remote?.os==='windows'} selected={fields.cwd??''} onSelect={cwd=>{patch({cwd});setError('')}} onClose={()=>setPickerOpen(false)}/>}</>}
</>}</div>
    </details>
    {error&&<p className="employee-form-error" role="alert">{error}</p>}
    <div className="form-footer">{onCancel&&<button type="button" className="btn creation-cancel" onClick={onCancel} disabled={saving}>{uiText("Cancel")}</button>}<button className="btn primary save-employee" disabled={saving || !fields.title.trim() || (!employee&&!!engineWorkspaceError(fields.engine)) || !groups.includes(fields.group) || (localWorkspace&&!workspaceRoot) || (binding&&!folder.trim()) || (!employee&&directoryMode==='bind'&&!fields.cwd?.trim()) || (fields.kind==='cloud-native-worker'&&engineCheck.state!=='ready')}>{saving ? uiText("Saving…") : employee ? uiText("Save changes") : uiText("Create employee")}</button></div>
  </form>
}

export function TeamForm({ name, index, layout, root = '', settings={mode:'build'}, template, plugins=[], employeeCount=0, onSave, onRemove,onCancel,onDirtyChange,onSavingChange,inert=false }: {
  inert?:boolean;onCancel?:()=>void;onDirtyChange?:(dirty:boolean)=>void;onSavingChange?:(saving:boolean)=>void;name?: string; index: number; layout?: RoomLayout; root?: string;settings?:TeamSettings;template?:{settings:TeamSettings;design?:Partial<RoomDesign>;bounds?:RoomBounds};plugins?:PluginDescriptor[];employeeCount?:number;
  onSave: (name: string, root: string, design: RoomDesign, bounds: RoomBounds,settings:TeamSettings) => Promise<boolean>; onRemove?: () => Promise<void>
}) {
  useI18n()

  const creationTouched=useRef(false),submitActive=useRef(false)
  const [title, setTitle] = useState(name === '' ? '自由工位' : name ?? '')
  useEffect(()=>setTitle(name === '' ? '自由工位' : name ?? ''),[name])
  const [design, updateDesign] = useState(roomDesign(index, name===undefined?undefined:layout?.design)),setDesign=(value:Parameters<typeof updateDesign>[0])=>{creationTouched.current=true;updateDesign(value)}
  const [bounds, updateBounds] = useState(()=>initialBounds(index,layout)),setBounds=(value:Parameters<typeof updateBounds>[0])=>{creationTouched.current=true;updateBounds(value)}
  const [folder,setFolder]=useState(root)
  const [config,setConfig]=useState<TeamSettings>(name===undefined?(template?.settings?.mode==='cloud'?template.settings:{mode:'build',directoryMode:'default'}):settings)
  const [storage,setStorage]=useState<StorageFolderInput>({mode:'create',...(name===undefined&&template?.settings?.hostId?{hostId:template.settings.hostId,directory:template.settings.parentDirectory}:{})})
  const directoryMode=name===undefined?(storage.mode==='create'?'default':'bind'):config.directoryMode??'bind'
  const [suggested,setSuggested]=useState(''),[deleting,setDeleting]=useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [folderError,setFolderError]=useState('')
  const formValue=JSON.stringify([title,design,bounds,folder,config,directoryMode,storage]),initialValue=useRef(formValue)
  useEffect(()=>{onDirtyChange?.(name===undefined?creationTouched.current||!!title.trim():formValue!==initialValue.current)},[formValue,onDirtyChange])
  useEffect(()=>{onSavingChange?.(saving||deleting);return()=>onSavingChange?.(false)},[saving,deleting,onSavingChange])

  useEffect(()=>{let active=true;if(name!==undefined){setFolder(root);return}if(config.mode==='cloud'){setFolder(storage.directory??'');return}void api.call<{path:string}>('workspace.suggest',{team:title||'Project',mode:'build'}).then(result=>{if(!active)return;setSuggested(result.path);const base=storage.directory??result.path.replace(/[\\/][^\\/]+$/,'');setFolder(storage.mode==='bind'?storage.directory??'':base.replace(/[\\/]+$/,'')+'/'+(storage.folderName??defaultStorageFolderName(title)))}).catch(cause=>active&&setFolderError(cause.message));return()=>{active=false}},[title,config.mode,storage,root,name])

  return <form inert={inert} onChangeCapture={()=>{creationTouched.current=true}} className={'team-form'+(name===undefined?' creation-form':'')} onSubmit={async (e) => { e.preventDefault();if(submitActive.current)return;submitActive.current=true;setSaving(true);try { await onSave(name === '' ? '' : title, folder.trim(), design, bounds,{...config,directoryMode,...(name===undefined?config.mode==='cloud'?{hostId:storage.hostId,directory:storage.directory,folderName:storage.mode==='create'?storage.folderName??defaultStorageFolderName(title):undefined}:{folderName:storage.mode==='create'?storage.folderName??defaultStorageFolderName(title):undefined,parentDirectory:storage.mode==='create'?storage.directory??suggested.replace(/[\\/][^\\/]+$/,''):undefined}:{})}) } catch(error){setFolderError((error as Error).message)} finally { submitActive.current=false;setSaving(false) } }}>
    {name!==undefined&&<div className={`sign-preview theme-${design.theme}`}><i /><span>{title || uiText("New team")}<small>{design.subtitle}</small></span><b>01</b></div>}
    <label className="creation-name">{uiText("Team name")}<input name="team-name" autoFocus={name===undefined} required readOnly={name===''} value={title} onChange={e=>setTitle(e.target.value)} placeholder={uiText("e.g. Engineering")}/></label>
    {name===undefined?<>
    <section className="creation-section"><h3>{uiText("Workspace type")}</h3><div className="team-mode-options creation-team-types" role="group" aria-label={uiText("Team type")}>{([
      {mode:'build',icon:'folder',label:'Local project'},
      {mode:'cloud',icon:'server',label:'Cloud project'}
    ] as const).map(choice=><button type="button" key={choice.mode} data-mode={choice.mode} aria-pressed={config.mode===choice.mode} className={config.mode===choice.mode?'selected':''} onClick={()=>{setConfig(choice.mode==='cloud'?{mode:'cloud'}:{mode:'build',directoryMode:'default'});setStorage({mode:'create'});setFolderError('')}}><span className="creation-type-icon"><Icon name={choice.icon}/></span><strong>{uiText(choice.label)}</strong><Icon name={config.mode===choice.mode?'check':'circle-outline'}/></button>)}</div></section>
    <section className="creation-section creation-workspace"><h3><Icon name={config.mode==='cloud'?'server':config.mode==='work'?'extensions':'folder'}/>{uiText(config.mode==='cloud'?'Host and folder':config.mode==='work'?'Plugin workspace':'Working folder')}</h3>
    <StorageFolderFields value={storage} onChange={next=>{setStorage(next);setFolderError('')}} name={title} location={config.mode==='cloud'?'remote':'local'} localDefault={suggested.replace(/[\\/][^\\/]+$/,'')} disabled={saving}/>

    </section>
    </>:<div className="workspace-contract"><span>{uiText(config.mode==='work'?'Local plugin':config.mode==='cloud'?'Cloud project':'Local project')}</span><code>{root}</code></div>}
    {folderError&&<p className="employee-form-error" role="alert">{folderError}</p>}
    {name!==undefined&&<>
    <label>{uiText("Team motto")}<input name="subtitle" value={design.subtitle} onChange={(e) => setDesign({ ...design, subtitle: e.target.value })} /></label>
    <fieldset className="appearance-settings"><legend>{uiText("Team background and decoration")}</legend>
    <div className="form-section"><div className="field-heading">{uiText("Space palette")}</div><div className="theme-options">{ROOM_THEMES.map((theme, i) => <button type="button" key={theme} className={`theme-${theme} ${design.theme === theme ? 'selected' : ''}`} onClick={() => setDesign({ ...design, theme })}><i />{THEMES[i]}</button>)}</div></div>
    <div className="room-background-options"><label>{uiText("Background color")}<div className="room-color-picker"><input type="color" aria-label={uiText("Team background color")} value={design.background||'#e5edf5'} onChange={e=>setDesign({...design,background:e.target.value})}/><code>{design.background||uiText("Follow theme")}</code><button type="button" onClick={()=>setDesign({...design,background:''})}>{uiText("Follow theme")}</button></div></label><label>{uiText("Background texture")}<AppSelect name="pattern" value={design.pattern} onChange={e=>setDesign({...design,pattern:e.target.value as RoomDesign['pattern']})}><option value="boards">{uiText("Wood flooring")}</option><option value="grid">{uiText("Tile grid")}</option><option value="dots">{uiText("Dots")}</option><option value="plain">{uiText("Solid color")}</option></AppSelect></label></div>
    <label className="scenery-toggle"><input type="checkbox" name="scenery" checked={design.scenery} onChange={e=>setDesign({...design,scenery:e.target.checked})}/>{uiText("Show walls and decorations")}</label>
    <div className="form-row"><label>{uiText("Walls")}<AppSelect name="wall" value={design.wall} onChange={(e) => setDesign({ ...design, wall: e.target.value as RoomDesign['wall'] })}><option value="windows">{uiText("Floor-to-ceiling window · City sunset")}</option><option value="panels">{uiText("Wood panels · Warm tones")}</option><option value="brick">{uiText("Vintage brick · Studio")}</option></AppSelect></label><label>{uiText("Desks")}<AppSelect name="desk" value={design.desk} onChange={(e) => setDesign({ ...design, desk: e.target.value as RoomDesign['desk'] })}><option value="walnut">{uiText("Walnut")}</option><option value="oak">{uiText("Light oak")}</option><option value="cloud">{uiText("Cloud white")}</option></AppSelect></label></div>
    <div className="form-section"><div className="field-heading">{uiText("Individual decorations")}</div><div className="decoration-options">{([['plants','绿植'],['shelf','书架'],['lamp','吊灯'],['art','海报']] as const).map(([key, label]) => <label key={key}><input type="checkbox" name={key} checked={design[key]} onChange={(e) => setDesign({ ...design, [key]: e.target.checked })} /><span>{label}</span></label>)}</div></div>
    </fieldset>
    <p className="workspace-note">{uiText('Team rooms use rectangular seats. Drag the right, bottom or corner edge to add rows and columns; employees stay in their numbered seats.')}</p>
    </>}
    {removing&&<p className="workspace-note">{uiText("This will remove the Team, its")} {employeeCount}  {uiText("employees and all their local and native Codex / Claude Agent conversations. Working folders and files will be kept.")}</p>}
    <div className="form-footer">{onRemove && <button type="button" className="text-danger" disabled={deleting||saving} onClick={async () => { if (!removing) { setRemoving(true); return } setDeleting(true);try{await onRemove()}finally{setDeleting(false)} }}>{deleting?uiText("Cleaning up conversations…"):removing ? uiText("Confirm removal of Team and all conversations") : uiText("Remove Team")}</button>}{onCancel&&<button type="button" className="btn creation-cancel" onClick={onCancel} disabled={saving}>{uiText("Cancel")}</button>}<button className="btn primary save-team" disabled={saving||deleting||!title.trim()||!folder||!!folderError||(config.mode==='cloud'&&!storage.hostId)}>{saving ? uiText("Saving…") : name === undefined ? uiText("Create Team") : uiText("Save workspace")}</button></div>
  </form>
}
