import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {EngineeringView} from '../../src/renderer/src/components/EngineeringView'
import {api} from '../../src/renderer/src/api'
import {setInterfaceLanguage} from '../../src/renderer/src/i18n'
import {createRefreshQueue} from '../../src/renderer/src/snapshot'
import type {Store} from '../../src/shared/types'
import type {ViewState} from '../../src/shared/view'
import type {Engineering} from '../../src/shared/engineering'

// The retired primary destination stays absent. This only mounts the retained
// component beside the real App, using its existing authenticated transport.
const primary=document.getElementById('root')!,previousDisplay=primary.style.display
const host=document.createElement('div')
host.id='engineering-component-fixture'
Object.assign(host.style,{position:'fixed',inset:'0',zIndex:'100',display:'none'})
document.body.appendChild(host)
const root=createRoot(host)
const show=()=>{primary.style.display='none';host.style.display='block'}
const hide=()=>{host.style.display='none';primary.style.display=previousDisplay}

function Fixture(){
 const [state,setState]=useState<{store:Store;view:ViewState}>()
 const [error,setError]=useState('')
 useEffect(()=>{
  let active=true
  const refresh=createRefreshQueue(async()=>{
   try{
    const [store,view]=await Promise.all([api.call<Store>('session.list'),api.call<ViewState>('view.get')])
    if(active){setInterfaceLanguage(store.preferences?.language??'en');setState({store,view})}
   }catch(cause){if(active)setError((cause as Error).message)}
  })
  void refresh()
  const off=api.onEvent(event=>{if(['store:changed','view:changed','engineering:changed','client:connected'].includes(event.channel))void refresh()})
  return()=>{active=false;off()}
 },[])
 const act=async(command:string,args:Record<string,unknown>={})=>{
  if(command==='view.select'&&args.teamTab==='engineering'&&typeof args.engineeringId==='string'){
   // A standalone host supplies the real Team scope; it does not revive the
   // retired primary destination or synthesize an Engineering mutation result.
   const project=await api.call<Engineering>('engineering.get',{id:args.engineeringId})
   if(!project.viewId)throw Error('The fixture project has no Team view')
   const result=await api.call<ViewState>(command,{...args,teamViewId:project.viewId})
   const saved=await api.call<Store>('session.list'),selected=saved.teamViews?.find(view=>view.id===project.viewId)
   if(result.teamTab!=='board'||result.engineeringId!==project.id||saved.activeTeamViewId!==project.viewId||!selected?.teams.includes(project.team)||project.roles.some(role=>!role.employeeId||saved.sessions.find(person=>person.id===role.employeeId)?.group!==project.team))throw Error('Engineering selection did not retain its real project and Team scope: '+JSON.stringify({view:result,active:saved.activeTeamViewId,scope:selected?.teams,expected:{id:project.id,viewId:project.viewId,team:project.team}}))
   return result
  }
  const result=await api.call(command,args)
  if(command.startsWith('view.')&&args.teamTab!=='engineering')hide()
  return result
 }
 return <div className="app in-office" style={{height:'100vh',paddingTop:api.mode==='desktop'?52:0}}>
  {error?<p role="alert">{error}</p>:state?<EngineeringView store={state.store} view={state.view} act={act}/>:<p role="status">Loading component…</p>}
 </div>
}

;(window as any).engineeringFixture={show,hide,unmount:()=>{hide();root.unmount();host.remove()}}
root.render(<Fixture/> )
show()
