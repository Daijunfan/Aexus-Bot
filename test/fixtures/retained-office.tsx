import {useCallback,useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {OfficeCanvas} from '../../src/renderer/src/office/OfficeCanvas'
import {ConnectionLayer} from '../../src/renderer/src/office/ConnectionLayer'
import {api} from '../../src/renderer/src/api'
import {createRefreshQueue} from '../../src/renderer/src/snapshot'
import {setInterfaceLanguage} from '../../src/renderer/src/i18n'
import {planOffice,type Viewport,type Point} from '../../src/shared/canvas'
import {employeeActivity} from '../../src/shared/activity'
import {AvatarCatalogContext} from '../../src/renderer/src/components/AvatarCatalog'
import {ManagementPanel} from '../../src/renderer/src/components/ManagementPanel'
import type {Store,Session} from '../../src/shared/types'
import type {ManagementActivity} from '../../src/shared/management'
import type {OfficeConnection} from '../../src/shared/office-connections'

// An isolated host for retained components, not a restored primary destination.
// Every record and operation still uses the real, authenticated temporary Core.
const primary=document.getElementById('root')!,previous=primary.style.display,host=document.createElement('div')
host.id='retained-office-fixture'
Object.assign(host.style,{position:'fixed',inset:'0',zIndex:'100',display:'none'})
document.body.appendChild(host)
const root=createRoot(host)
type FixtureMode='canvas'|'connections'|'management'
let requestedMode:FixtureMode='canvas',requestedEmployee:string|undefined,requestedCloudMembers:string[]=[],requestedOffline:string|undefined,selectMode:((mode:FixtureMode)=>void)|undefined,setEmployee:((id:string|undefined)=>void)|undefined,setScale:((zoom:number)=>void)|undefined,setCloudMembers:((ids:string[])=>void)|undefined,setOffline:((id:string|undefined)=>void)|undefined
const hide=()=>{host.style.display='none';primary.style.display=previous}
const fixture={show:(mode:FixtureMode='canvas',employee?:string)=>{requestedMode=mode;requestedEmployee=employee;selectMode?.(mode);setEmployee?.(employee);primary.style.display='none';host.style.display='block'},hide,setZoom:(zoom:number)=>setScale?.(zoom),visualCloudMembers:(ids:string[],offlineId?:string)=>{if(offlineId&&!ids.includes(offlineId))throw Error('Visual offline identity must be a visual cloud member');requestedCloudMembers=[...ids];requestedOffline=offlineId;setCloudMembers?.(requestedCloudMembers);setOffline?.(offlineId)},viewport:undefined as {view:Viewport;size:Point}|undefined,unmount:()=>{hide();root.unmount();host.remove()}}
;(window as any).retainedOfficeFixture=fixture

function Fixture(){
 const [mode,changeMode]=useState<FixtureMode>(requestedMode),[employee,changeEmployee]=useState(requestedEmployee),[zoom,changeZoom]=useState(.52),[cloudMembers,changeCloudMembers]=useState(requestedCloudMembers),[offline,changeOffline]=useState(requestedOffline),[state,setState]=useState<{store:Store;sessions:Session[];layout:{connections:OfficeConnection[]};activity:ManagementActivity}>(),[error,setError]=useState('')
 selectMode=changeMode;setEmployee=changeEmployee;setScale=changeZoom;setCloudMembers=changeCloudMembers;setOffline=changeOffline
 useEffect(()=>{
  let alive=true
  const refresh=createRefreshQueue(async()=>{
   try{
    const [store,sessions,layout,activity]=await Promise.all([api.call<Store>('session.list'),api.call<Session[]>('session.list',{live:true,summary:true}),api.call<{connections:OfficeConnection[]}>('office.layout'),api.call<ManagementActivity>('management.activity')])
    if(alive){setInterfaceLanguage(store.preferences?.language??'en');setState({store,sessions,layout,activity});setError('')}
   }catch(cause){if(alive)setError((cause as Error).message)}
  })
  void refresh()
  const off=api.onEvent(event=>{if(['store:changed','view:changed','management:activity','client:connected'].includes(event.channel)||event.channel.startsWith('session:'))void refresh()})
  return()=>{alive=false;off()}
 },[])
 const remember=useCallback((view:Viewport,size:Point)=>{fixture.viewport={view,size}},[])
 if(error)return <p role="alert">{error}</p>
 if(!state)return <p role="status">Loading retained component…</p>
 const {sessions,layout,activity}=state
 // Only the visual source case uses cloud badges. Stable identities/cwds stay
 // real; this DTO is never persisted and cannot authorize remote execution.
 const store:Store=cloudMembers.length?{...state.store,sessions:state.store.sessions.map(card=>cloudMembers.includes(card.id)?{...card,kind:'cloud-native-worker',workEnvironment:'team'}:card),teamSettings:{...state.store.teamSettings,...Object.fromEntries([...new Set(state.store.sessions.filter(card=>cloudMembers.includes(card.id)).map(card=>card.group))].map(group=>[group,{mode:'cloud',hostId:'visual-only',remote:{host:'fixture.invalid',os:'linux',directory:'/visual/metadata-only'}}]))}}:state.store
 const rooms=planOffice(store),live=new Map(sessions.map(session=>[session.cardId??session.id,session]))
 const activities=Object.fromEntries(store.sessions.flatMap(card=>{const value=employeeActivity(card,live.get(card.id));return value?[[card.id,value]]:[]}))
 const points=layout.connections.flatMap(connection=>connection.points),left=Math.min(0,...points.map(point=>point.x))-40,top=Math.min(0,...points.map(point=>point.y))-40,width=Math.max(600,...points.map(point=>point.x))-left+80,height=Math.max(500,...points.map(point=>point.y))-top+80
 const act=(command:string,args:Record<string,unknown>={})=>{if(cloudMembers.length&&!command.startsWith('view.'))throw Error('Visual cloud metadata cannot mutate Core');return api.call(command,args)}
 const managed=state.store.sessions.find(card=>card.id===employee)
 return <AvatarCatalogContext.Provider value={store.avatarCatalog}><section className="app in-office" aria-label="Retained office component host" data-fixture-mode={mode} style={{height:'100vh',display:'flex',flexDirection:'column',paddingTop:api.mode==='desktop'?52:0}}>
  <header style={{flex:'none',padding:'4px 12px',fontSize:11}}>Retained component validation · {mode}{cloudMembers.length?' · visual cloud metadata only':''}<button type="button" onClick={hide}>Return to the real Team</button></header>
  {mode==='management'?<div className="office-panel" style={{maxWidth:640,margin:'24px auto',padding:24}}>{managed&&!cloudMembers.length?<ManagementPanel employee={managed} cloud={managed.kind==='cloud-native-worker'}/>:<p role="alert">Select a real employee for management validation.</p>}</div>:mode==='canvas'?<OfficeCanvas store={store} interactions={activity.interactions} activities={activities} busyIds={new Set(sessions.filter(session=>session.busy).map(session=>session.cardId??session.id))} disconnectedIds={new Set([...sessions.filter(session=>session.error).map(session=>session.cardId??session.id),...(offline&&cloudMembers.includes(offline)?[offline]:[])])} cloudStatus={{}} plugins={[]} act={act} onOpen={card=>{hide();void api.call('view.open',{kind:'conversation',employee:card.id})}} onEdit={()=>{}} onView={remember}/>:<div className="retained-connection-scroll" style={{position:'relative',flex:1,overflow:'auto'}}><div style={{position:'relative',width:width*zoom+80,height:height*zoom+80}}><div className="canvas-world" style={{left:40-left*zoom,top:40-top*zoom,transform:`scale(${zoom})`}}><ConnectionLayer connections={layout.connections} rooms={rooms} settings={store.connectorAnchors} zoom={zoom} bounds={{x:left,y:top,width,height}} onPreview={()=>{}} onSave={value=>act('connector.set',{manager:value.managerId,employee:value.employeeId,source:value.source,target:value.target,route:value.route})}/></div></div></div>}
 </section></AvatarCatalogContext.Provider>
}
root.render(<Fixture/> )
