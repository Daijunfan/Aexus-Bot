import {separateRooms,moveTeamRooms} from '../../../shared/office-layout'
import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {api} from '../api'
import {cachedConnectionPlan} from './routing-cache'
import {CanvasMotion} from './motion'
import {ConnectionLayer} from './ConnectionLayer'
import {officeConnectionPlan,connectionGeometryKey} from '../../../shared/office-connections'
import {ConnectorEditor,ConnectorSelection,type ConnectionSelection} from './ConnectorEditor'
import {connectorKey,rerouteTeamConnections,rerouteEmployeeConnections,type ConnectorSetting} from '../../../shared/connector'
import {crossTeamRoutes} from '../../../shared/cross-team-routing'
import type {ManagementInteraction} from '../../../shared/management'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { teamSettings,type ActivityPreview,type Store,type StoredSession } from '../../../shared/types'
import type {PluginDescriptor} from '../../../shared/plugins'
import type {RemoteHealth} from '../../../shared/remote'
import { EMPLOYEE_SIZE, planOffice,planRoom,roomExtent,TEAM_SEAT_STEP,minimumTeamSeating,resizeTeamSeating,teamBoardCapacity,type TeamPlacement,type TeamSeating,type PlannedRoom,type Point,type Viewport } from '../../../shared/canvas'
import {DEFAULT_PREFERENCES} from '../../../shared/preferences'
import { CanvasRoom } from './CanvasRoom'
import { CanvasOverview } from './CanvasOverview'
import '../styles/company-canvas.css'

type Drag={pointerId:number;pointer?:Point;kind:'employee'|'team'|'resize';name:string;id?:string;edge?:'e'|'s'|'se';start:Point;origin:Point;zoom:number;scale:number;scroll:Point;offset:Point;room:PlannedRoom;moved:boolean;seat?:number;placement?:TeamPlacement;seating?:TeamSeating;openOnClick?:boolean;rooms:PlannedRoom[];sequence:number}
export type CanvasSelection={mode:'employee'|'team';ids:Set<string>;toggle:(id:string)=>void}
type Props={obscured?:boolean;selection?:CanvasSelection;interactions:ManagementInteraction[];activities:Record<string,ActivityPreview>;cloudStatus:Record<string,RemoteHealth>;plugins:PluginDescriptor[];store:Store;busyIds:Set<string>;disconnectedIds:Set<string>;act:(cmd:string,args?:Record<string,unknown>)=>Promise<any>;onOpen:(card:StoredSession)=>void;onEdit:(name:string)=>void;onView:(view:Viewport,size:Point)=>void}
export const OfficeCanvas=memo(function OfficeCanvas({obscured=false,selection,store,busyIds,disconnectedIds,activities,interactions:liveInteractions,cloudStatus,plugins,act,onOpen,onEdit,onView}:Props) {
  useI18n()

  const interactions=useMemo(()=>liveInteractions.filter(value=>value.highlighted!==false),[liveInteractions])
  const [windowVisible,setWindowVisible]=useState(true)
  const animated=windowVisible&&!obscured
  useEffect(()=>api.onEvent(event=>{if(event.channel==='desktop:visibility'&&typeof event.payload.visible==='boolean')setWindowVisible(event.payload.visible)}),[])
  const [connection,setConnection]=useState<ConnectionSelection|null>(null),[anchorDraft,setAnchorDraft]=useState<ConnectorSetting|null>(null),worldRef=useRef<HTMLDivElement>(null)
  const selectConnection=useCallback((value:ConnectionSelection)=>{if(selection)return;setAnchorDraft(null);setConnection(value)},[!!selection])
  const closeConnection=useCallback(()=>{setAnchorDraft(null);setConnection(null)},[])
  useEffect(()=>{if(selection)closeConnection()},[selection?.mode,closeConnection])
  const preferences={...DEFAULT_PREFERENCES,...store.preferences}
  const selectedView=store.teamViews?.find(item=>item.id===store.activeTeamViewId)
  const viewport=useRef<HTMLDivElement>(null)
  const [size,setSize]=useState({x:1200,y:800}),[scroll,setScroll]=useState({x:0,y:0})
  const dragRef=useRef<Drag|null>(null),sequence=useRef(0),frame=useRef(0)
  const [draft,setDraft]=useState<Drag|null>(null)
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[])
  useLayoutEffect(()=>{const el=viewport.current!,measure=()=>setSize({x:el.clientWidth,y:el.clientHeight}),observer=new ResizeObserver(measure);measure();observer.observe(el);return()=>observer.disconnect()},[])
  useEffect(()=>{const el=viewport.current!;const wheel=(event:WheelEvent)=>{if(event.ctrlKey||event.metaKey||dragRef.current?.kind==='resize')event.preventDefault()};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[])
  const allRooms=useMemo(()=>planOffice(store),[store.groups,store.sessions,store.rooms])
  const scale=draft?draft.zoom:(viewport.current?.offsetWidth??size.x)<450?.44:.52
  const selectedRooms=useMemo(()=>selectedView?allRooms.filter(room=>selectedView.teams.includes(room.name)):allRooms,[allRooms,selectedView?.teams])
  const baseRooms=selectedRooms
  const resolvedRooms=useMemo(()=>{
    if(!draft?.moved)return allRooms
    if(draft.kind==='team'&&draft.placement)return moveTeamRooms(allRooms,draft.name,draft.placement)
    const changed=allRooms.map(room=>{
      if(room.name!==draft.name)return room
      if(draft.kind==='resize'&&draft.seating)return resizeTeamSeating(room,draft.seating)
      if(draft.kind!=='employee'||!draft.seat)return room
      const current=room.employees.find(entry=>entry.card.id===draft.id)!.card.seatNumber
      const cards=room.employees.map(({card})=>({...card,seatNumber:card.id===draft.id?draft.seat:card.seatNumber===draft.seat?current:card.seatNumber}))
      return {...planRoom(room.name,cards,room.bounds,room.seating),slot:room.slot,placement:room.placement}
    })
    return draft.kind==='resize'?separateRooms(changed,[draft.name]):changed
  },[allRooms,draft])
  const rooms=useMemo(()=>resolvedRooms.filter(room=>baseRooms.some(value=>value.name===room.name)),[resolvedRooms,baseRooms]),routingRooms=resolvedRooms
  const [area,setArea]=useState({minX:-450,minY:-570,maxX:1210,maxY:1281})
  const bounds={minX:Math.min(area.minX,...resolvedRooms.map(room=>room.bounds.x-450)),minY:Math.min(area.minY,...resolvedRooms.map(room=>room.bounds.y-570)),maxX:Math.max(area.maxX,(baseRooms[0]?.bounds.x??0)+size.x/scale,...resolvedRooms.map(room=>room.bounds.x+room.bounds.width+450)),maxY:Math.max(area.maxY,(baseRooms[0]?.bounds.y??0)+size.y/scale,...resolvedRooms.map(room=>room.bounds.y+room.bounds.height+570))}
  useLayoutEffect(()=>setArea(previous=>previous.minX===bounds.minX&&previous.minY===bounds.minY&&previous.maxX===bounds.maxX&&previous.maxY===bounds.maxY?previous:bounds),[bounds.minX,bounds.minY,bounds.maxX,bounds.maxY])
  const extent={x:16-bounds.minX*scale,y:18-bounds.minY*scale,width:Math.max(size.x,(bounds.maxX-bounds.minX)*scale+32),height:Math.max(size.y,(bounds.maxY-bounds.minY)*scale+36),zoom:scale}
  const cameraOrigin=useRef<Point|undefined>(undefined),initialized=useRef(false),geometry=useRef({x:extent.x,y:extent.y});geometry.current={x:extent.x,y:extent.y}
  useLayoutEffect(()=>{
    const el=viewport.current!,previous=cameraOrigin.current
    if(!initialized.current&&rooms.length&&size.x===el.clientWidth&&size.y===el.clientHeight){el.scrollLeft=extent.x+rooms[0].bounds.x*scale-16;el.scrollTop=extent.y+rooms[0].bounds.y*scale-18;initialized.current=true}
    else if(previous){el.scrollLeft+=extent.x-previous.x;el.scrollTop+=extent.y-previous.y}
    cameraOrigin.current={x:extent.x,y:extent.y};setScroll(previous=>previous.x===el.scrollLeft&&previous.y===el.scrollTop?previous:{x:el.scrollLeft,y:el.scrollTop})
  },[extent.x,extent.y,rooms.length,size.x,size.y])
  const view={x:extent.x-scroll.x,y:extent.y-scroll.y,zoom:extent.zoom}
  useEffect(()=>onView(view,size),[view.x,view.y,view.zoom,size,onView])
  const connectorAnchors=useMemo(()=>{
    let settings=anchorDraft?{...store.connectorAnchors,[connectorKey(anchorDraft.managerId,anchorDraft.employeeId)]:anchorDraft}:store.connectorAnchors
    if(draft?.kind==='resize'&&draft.seating)settings=rerouteEmployeeConnections(settings,draft.room.employees.map(entry=>entry.card.id))
    if(draft?.seat)settings=rerouteEmployeeConnections(settings,[draft.id!,...(draft.room.seats?.find(seat=>seat.number===draft.seat)?.employeeId?[draft.room.seats.find(seat=>seat.number===draft.seat)!.employeeId!]:[])])
    for(const room of routingRooms){const before=allRooms.find(item=>item.name===room.name)!
      if(room.bounds.x!==before.bounds.x||room.bounds.y!==before.bounds.y)settings=rerouteTeamConnections(settings,room.name,store.sessions)
    }
    return settings
  },[store.connectorAnchors,store.sessions,anchorDraft,routingRooms,allRooms,draft])
  const visibleTeams=new Set(rooms.map(room=>room.name))
  const routingKey=connectionGeometryKey(routingRooms,store.access?.relations??[],interactions,visibleTeams,connectorAnchors)
  // Geometry and edge membership trigger A*. Activity only recolors existing paths.
  const routing=useMemo(()=>cachedConnectionPlan(routingKey,()=>officeConnectionPlan(routingRooms,store.access?.relations??[],interactions,visibleTeams,connectorAnchors)),[routingKey])
  const currentInteraction=(r:{managerId:string;employeeId:string})=>interactions.find(i=>i.managerId===r.managerId&&i.employeeId===r.employeeId)
  const crossRoutes=useMemo(()=>routing.crossTeamConnections.map(r=>({...r,active:!!currentInteraction(r),command:currentInteraction(r)?.command})),[routing,interactions])
  const displayConnections=useMemo(()=>routing.connections.map(r=>({...r,active:!!currentInteraction(r)})),[routing,interactions])
  const connectorContext=useMemo(()=>({selected:connection,select:selectConnection}),[connection,selectConnection])
  const saveConnection=useCallback((value:ConnectorSetting)=>act('connector.set',{manager:value.managerId,employee:value.employeeId,source:value.source,target:value.target,route:value.route}),[act])
  const begin=useCallback((kind:Drag['kind'],room:PlannedRoom,e:React.PointerEvent,id?:string,edge?:Drag['edge'])=>{
    e.preventDefault();e.stopPropagation()
    if(dragRef.current||e.isPrimary===false||e.button!==0||obscured||!room.name&&kind!=='employee'||selection&&(kind==='resize'||kind==='team'&&selection.mode==='employee'))return
    closeConnection();viewport.current!.setPointerCapture(e.pointerId)
    const origin=kind==='employee'?room.employees.find(entry=>entry.card.id===id)!.position:{x:room.bounds.x,y:room.bounds.y}
    const drag:Drag={pointerId:e.pointerId,kind,id,edge,rooms,sequence:++sequence.current,openOnClick:!!(e.target as Element).closest('.team-title'),zoom:extent.zoom,scale:extent.zoom*viewport.current!.getBoundingClientRect().width/viewport.current!.offsetWidth,scroll:{x:viewport.current!.scrollLeft,y:viewport.current!.scrollTop},offset:{x:extent.x,y:extent.y},name:room.name,room,start:{x:e.clientX,y:e.clientY},origin,moved:false}
    dragRef.current=drag;setDraft(drag)
  },[rooms,closeConnection,extent.x,extent.y,extent.zoom,obscured,selection])
  const cancelDrag=useCallback((pointerId?:number)=>{
    const drag=dragRef.current;if(!drag||pointerId!==undefined&&pointerId!==drag.pointerId)return
    dragRef.current=null;cancelAnimationFrame(frame.current)
    if(viewport.current?.hasPointerCapture(drag.pointerId))viewport.current.releasePointerCapture(drag.pointerId)
    setDraft(null)
  },[])
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.isComposing&&dragRef.current){event.preventDefault();event.stopPropagation();cancelDrag()}}
    const hidden=()=>{if(document.hidden)cancelDrag()},blur=()=>cancelDrag()
    document.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur)
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur)}
  },[cancelDrag])
  useEffect(()=>{if(obscured||selection)cancelDrag()},[obscured,selection,cancelDrag])
  const moveRef=useRef<(point:Point,pointer:number)=>void>(()=>{})
  useEffect(()=>{
    if(draft?.kind!=='team'||!draft.moved)return
    let animation=0
    const tick=()=>{const drag=dragRef.current,el=viewport.current;if(!drag?.pointer||drag.kind!=='team'||!el)return
      const rect=el.getBoundingClientRect(),{x,y}=drag.pointer,left=x<rect.left+28,right=x>rect.right-28,up=y<rect.top+28,down=y>rect.bottom-28
      if(left&&el.scrollLeft<16)setArea(area=>({...area,minX:area.minX-TEAM_SEAT_STEP.x}))
      if(right&&el.scrollWidth-el.clientWidth-el.scrollLeft<16)setArea(area=>({...area,maxX:area.maxX+TEAM_SEAT_STEP.x}))
      if(up&&el.scrollTop<16)setArea(area=>({...area,minY:area.minY-TEAM_SEAT_STEP.y}))
      if(down&&el.scrollHeight-el.clientHeight-el.scrollTop<16)setArea(area=>({...area,maxY:area.maxY+TEAM_SEAT_STEP.y}))
      const before={x:el.scrollLeft,y:el.scrollTop};el.scrollBy(left?-14:right?14:0,up?-14:down?14:0)
      if(before.x!==el.scrollLeft||before.y!==el.scrollTop)moveRef.current(drag.pointer,drag.pointerId)
      animation=requestAnimationFrame(tick)
    };animation=requestAnimationFrame(tick);return()=>cancelAnimationFrame(animation)
  },[draft?.kind,draft?.moved])
  const movePoint=(point:Point,pointerId:number)=>{
    const drag=dragRef.current;if(!drag||pointerId!==drag.pointerId||selection)return
    const el=viewport.current!,pageScale=el.getBoundingClientRect().width/el.offsetWidth,offset=geometry.current
    const dx=(point.x-drag.start.x+(el.scrollLeft-drag.scroll.x-offset.x+drag.offset.x)*pageScale)/drag.scale,dy=(point.y-drag.start.y+(el.scrollTop-drag.scroll.y-offset.y+drag.offset.y)*pageScale)/drag.scale
    if(!drag.moved&&Math.hypot(dx,dy)*drag.scale<5)return
    const next={...drag,moved:true,pointer:point}
    if(drag.kind==='resize'){
      const minimum=minimumTeamSeating(drag.room),initial=drag.room.seating!
      next.seating={columns:Math.max(minimum.columns,Math.min(12,initial.columns+(drag.edge!=='s'?Math.round(dx/225):0))),rows:Math.max(minimum.rows,Math.min(50,initial.rows+(drag.edge!=='e'?Math.round(dy/285):0)))}
    }else if(drag.kind==='team')next.placement={column:Math.round((drag.origin.x+dx)/TEAM_SEAT_STEP.x),row:Math.round((drag.origin.y+dy)/TEAM_SEAT_STEP.y)}
    else{const target={x:drag.origin.x+dx,y:drag.origin.y+dy},inside=target.x>-95&&target.x<drag.room.bounds.width-95&&target.y>100&&target.y<drag.room.bounds.height-125;next.seat=inside?[...(drag.room.seats??[])].sort((a,b)=>(a.position.x-target.x)**2+(a.position.y-target.y)**2-((b.position.x-target.x)**2+(b.position.y-target.y)**2))[0]?.number:undefined}
    dragRef.current=next
    const unchanged=drag.moved&&(drag.kind==='team'?next.placement?.column===drag.placement?.column&&next.placement?.row===drag.placement?.row:drag.kind==='resize'?next.seating?.columns===drag.seating?.columns&&next.seating?.rows===drag.seating?.rows:next.seat===drag.seat)
    if(unchanged)return
    cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>setDraft(next))
  };moveRef.current=movePoint
  const move=(event:React.PointerEvent)=>movePoint({x:event.clientX,y:event.clientY},event.pointerId)
  const finish=async(e:React.PointerEvent)=>{
    const drag=dragRef.current;if(!drag||e.pointerId!==drag.pointerId)return
    dragRef.current=null;cancelAnimationFrame(frame.current);if(viewport.current?.hasPointerCapture(e.pointerId))viewport.current.releasePointerCapture(e.pointerId)
    if(e.type==='pointercancel'){setDraft(null);return}
    if(selection){setDraft(null);selection.toggle(selection.mode==='team'?drag.name:drag.id??drag.name);return}
    if(!drag.moved){setDraft(null);if(drag.kind==='employee')onOpen(drag.room.employees.find(entry=>entry.card.id===drag.id)!.card);else if(drag.kind==='team'&&drag.openOnClick)onEdit(drag.name);return}
    setDraft(drag)
    try{
      if(drag.kind==='team'&&drag.placement)await act('room.place',{name:drag.name,...drag.placement,expectedPlacement:drag.room.placement})
      else if(drag.kind==='resize'&&drag.seating)await act('room.bounds',{name:drag.name,...drag.seating})
      else if(drag.kind==='employee'&&drag.seat)await act('card.place',{id:drag.id,seat:drag.seat,expectedSeating:drag.room.seating})
    }finally{if(sequence.current===drag.sequence)setDraft(null)}
  }
  // A stable overscan window avoids rebuilding all room children for each pixel.
  const cellX=Math.floor(-view.x/view.zoom/200),cellY=Math.floor(-view.y/view.zoom/200),columns=Math.ceil(size.x/view.zoom/200),rows=Math.ceil(size.y/view.zoom/200)
  const visible=useMemo(()=>({x:cellX*200-400,y:cellY*200-400,width:columns*200+1000,height:rows*200+1000}),[cellX,cellY,columns,rows])
  const scene=useMemo(()=><>
      <ConnectionLayer bounds={visible} connections={displayConnections} rooms={rooms} settings={connectorAnchors} zoom={view.zoom} onPreview={setAnchorDraft} onSave={saveConnection}/>
      {rooms.map((room,i)=>{
        const b=roomExtent(room)
        if(draft?.name!==room.name&&(b.x+b.width<visible.x||b.y+b.height<visible.y||b.x>visible.x+visible.width||b.y>visible.y+visible.height))return null
        return <CanvasRoom selection={selection} connectorAnchors={connectorAnchors} crossRoutes={crossRoutes} interactions={interactions} key={room.name} room={room} access={store.access} index={i} design={store.rooms?.[room.name]?.design} root={store.teamRoots?.[room.name]} mode={teamSettings(store,room.name).mode} plugin={plugins.find(item=>item.id===teamSettings(store,room.name).pluginId)} pluginId={teamSettings(store,room.name).pluginId} remote={teamSettings(store,room.name).remote} health={cloudStatus[room.name]} activities={activities} busyIds={busyIds} disconnectedIds={disconnectedIds} resizing={draft?.kind==='resize'&&draft.name===room.name} draggingId={draft?.moved?draft.id:undefined} visible={visible}
          onOpen={onOpen} onEdit={()=>onEdit(room.name)} onStart={(kind,event,id,edge)=>begin(kind,room,event,id,edge)} onSeat={(id,seat)=>act('card.place',{id,seat,expectedSeating:room.seating})} onMove={placement=>act('room.place',{name:room.name,...placement,expectedPlacement:room.placement})} onResize={seating=>act('room.bounds',{name:room.name,...seating})} />
      })}
    </>,[visible,displayConnections,rooms,connectorAnchors,view.zoom,saveConnection,selection,crossRoutes,interactions,store.access,store.rooms,store.teamRoots,store.teamSettings,plugins,cloudStatus,activities,busyIds,disconnectedIds,draft?.kind,draft?.name,draft?.id,draft?.moved,onOpen,onEdit,begin])
  return <CanvasMotion.Provider value={animated}><ConnectorSelection.Provider value={connectorContext}><div className="characters-stage">
   <div data-animated={animated} ref={viewport} className={`characters-canvas ${selection?'is-editing-canvas':''}`} data-zoom={extent.zoom.toFixed(3)} data-gesture={draft?.kind} style={{'--characters-scale':extent.zoom,'--resize-cursor':draft?.edge==='e'?'ew-resize':draft?.edge==='s'?'ns-resize':'nwse-resize'} as CSSProperties} onScroll={e=>{const el=e.currentTarget,drag=dragRef.current;if(drag?.kind==='resize'){el.scrollLeft=drag.scroll.x+extent.x-drag.offset.x;el.scrollTop=drag.scroll.y+extent.y-drag.offset.y}setScroll({x:el.scrollLeft,y:el.scrollTop})}} onPointerMove={move} onPointerUp={e=>{move(e);void finish(e)}} onPointerCancel={e=>cancelDrag(e.pointerId)} onLostPointerCapture={e=>cancelDrag(e.pointerId)}>
    <div className="characters-extent" style={{width:extent.width,height:extent.height}}>

    <div ref={worldRef} className="canvas-world" style={{left:extent.x,top:extent.y,transform:`scale(${extent.zoom})`}}>
      {draft?.kind==='team'&&draft.moved&&<div className="team-placement-grid" aria-hidden="true" style={{left:visible.x,top:visible.y,width:visible.width,height:visible.height,backgroundPosition:`${-visible.x%225}px ${-visible.y%285}px`}}/>}
      {scene}

    </div></div>
    {connection&&<ConnectorEditor connections={displayConnections} zoom={view.zoom} interactions={interactions} selected={connection} rooms={rooms} settings={connectorAnchors} relations={store.access?.relations??[]} crossRoutes={crossRoutes} world={worldRef.current} onClose={closeConnection} onPreview={setAnchorDraft} onSave={(value,reset)=>act(reset?'connector.reset':'connector.set',{manager:value.managerId,employee:value.employeeId,...(reset?{}:{source:value.source,target:value.target,route:value.route})})}/>}
    {!rooms.length&&<div className="canvas-empty"><span>{uiText("ROOM FOR EVERY POSSIBILITY")}</span>{selectedView?<><h1>{uiText("No teams in this view yet")}</h1><p>{uiText("Return to all teams or add a Team to this selection.")}</p><button type="button" onClick={()=>void act('view.select',{id:'company',teamViewId:'all',teamTab:'characters'})}>{uiText("Show all teams")}</button></>:<><h1>{uiText("Start with one Team,")}<br />{uiText("and give your ideas a bigger world.")}</h1><p>{uiText("Add a Team and bind a project folder.")}<br />{uiText("Then invite your first companion.")}</p></>}</div>}
   </div>
    {preferences.showTeamOverview&&<CanvasOverview rooms={rooms} view={view} size={size} onFocus={room=>viewport.current?.scrollTo({left:room.bounds.x*extent.zoom+extent.x-24,top:room.bounds.y*extent.zoom+extent.y-24,behavior:'instant'})} onFit={()=>viewport.current?.scrollTo({left:0,top:0,behavior:'instant'})}/>}
    <div className="seating-hint">{uiText(draft?.kind==='resize'&&draft.seating?'Seat grid: {0} columns × {1} rows':'Drag teams by seats · Neighbors move aside · Drag edges to resize',[draft?.seating?.columns??0,draft?.seating?.rows??0])}</div>
  </div></ConnectorSelection.Provider></CanvasMotion.Provider>
})
