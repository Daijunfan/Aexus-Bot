import type {Store,RoomLayout} from './types'
import {planOffice,TEAM_SEAT_STEP,type TeamPlacement,type PlannedRoom,type RoomBounds} from './canvas'
import {rerouteEmployeeConnections} from './connector'


export const TEAM_GAP=60
export function roomsOverlap(a:RoomBounds,b:RoomBounds,gap=TEAM_GAP){
  return a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y
}
/** Keep the edited room anchored. Move only colliding neighbors, deterministically. */
export function separateRooms(rooms:PlannedRoom[],priority:Iterable<string>=[]):PlannedRoom[]{
  const preferred=new Set(priority),placed:PlannedRoom[]=[],result=new Map<string,PlannedRoom>()
  const order=[...rooms.filter(r=>preferred.has(r.name)),...rooms.filter(r=>!preferred.has(r.name))]
  for(const room of order){
    let bounds={...room.bounds}
    if(placed.some(other=>roomsOverlap(bounds,other.bounds))){
      const candidates=placed.flatMap(({bounds:b})=>[
        {...bounds,x:Math.ceil((b.x+b.width+TEAM_GAP)/TEAM_SEAT_STEP.x)*TEAM_SEAT_STEP.x},{...bounds,x:Math.floor((b.x-bounds.width-TEAM_GAP)/TEAM_SEAT_STEP.x)*TEAM_SEAT_STEP.x},
        {...bounds,y:Math.ceil((b.y+b.height+TEAM_GAP)/TEAM_SEAT_STEP.y)*TEAM_SEAT_STEP.y},{...bounds,y:Math.floor((b.y-bounds.height-TEAM_GAP)/TEAM_SEAT_STEP.y)*TEAM_SEAT_STEP.y}
      ])
      const distance=(b:RoomBounds)=>(b.x-room.bounds.x)**2+(b.y-room.bounds.y)**2
      candidates.sort((a,b)=>distance(a)-distance(b)||a.y-b.y||a.x-b.x)
      const available=candidates.find(candidate=>placed.every(other=>!roomsOverlap(candidate,other.bounds)))
      if(!available)throw new Error('Unable to separate Team bounds')
      bounds=available
    }
    const next={...room,bounds,placement:{column:Math.round(bounds.x/TEAM_SEAT_STEP.x),row:Math.round(bounds.y/TEAM_SEAT_STEP.y)}};placed.push(next);result.set(room.name,next)
  }
  return rooms.map(room=>result.get(room.name)!)
}
/** Geometry is derived from roster and numbered seats, never edited by pointer coordinates. */
export function reconcileOfficeLayout(store:Store,_previous?:Store,_force=false,priority:Iterable<string>=[]){
  store.rooms??={}
  const changed=new Set<string>()
  for(const room of separateRooms(planOffice(store),priority)){
    const before=store.rooms[room.name]?.bounds,geometryChanged=!before||['x','y','width','height','shape','arrangement'].some(key=>(before as any)[key]!== (room.bounds as any)[key])
    for(const entry of room.seats??[])if(entry.employeeId){const card=store.sessions.find(card=>card.id===entry.employeeId)!;if(geometryChanged||card.position||card.seatNumber!==entry.number)changed.add(card.id);card.seatNumber=entry.number;delete card.position}
    store.rooms[room.name]={col:0,row:0,w:1,h:1,slot:room.slot,placement:room.placement,seating:room.seating,design:store.rooms[room.name]?.design,bounds:{...room.bounds}}
  }
  store.connectorAnchors=rerouteEmployeeConnections(store.connectorAnchors,changed)
}

/** Shared by live pointer previews and authoritative Core writes. */
export function moveTeamRooms(rooms:PlannedRoom[],name:string,placement:TeamPlacement){
 return separateRooms(rooms.map(room=>room.name===name?{...room,placement,bounds:{...room.bounds,x:placement.column*TEAM_SEAT_STEP.x,y:placement.row*TEAM_SEAT_STEP.y}}:room),[name])
}
