import type { RoomLayout, StoredSession, Store } from './types'

export type Point = { x: number; y: number }
export type TeamPlacement={column:number;row:number}
export type TeamSeating={columns:number;rows:number}
export type Viewport = Point & { zoom: number }
export const ROOM_SHAPES = ['rounded', 'ellipse', 'hexagon', 'custom'] as const
export const ARRANGEMENTS = ['grid', 'circle', 'free'] as const
export type RoomBounds = Point & {
  width: number; height: number; shape: typeof ROOM_SHAPES[number]
  arrangement: typeof ARRANGEMENTS[number]; points?: Point[]
  pinned?: boolean
}
export const ROOM_HEADER_HEIGHT = 128
export const EMPLOYEE_TOP = ROOM_HEADER_HEIGHT + 12
export const MIN_ROOM_HEIGHT = 711
/** Complete rectangular actor footprint, including avatar, badge and native cloud. */
export const EMPLOYEE_SIZE = { width: 190, height: 250 }
export const DEFAULT_VIEW: Viewport = { x: 70, y: 125, zoom: 0.8 }
export const DEFAULT_POLYGON: Point[] = [{x:0.08,y:0},{x:0.92,y:0},{x:1,y:0.25},{x:0.93,y:1},{x:0.08,y:0.96},{x:0,y:0.28}]
export type TeamSeat = {number:number;row:number;column:number;position:Point;employeeId?:string}
export type PlannedRoom = { name: string; bounds: RoomBounds; slot?:number;placement?:TeamPlacement;seating?:TeamSeating;seats?:TeamSeat[]; employees: { card: StoredSession; position: Point }[] }
export type ResizeEdge = 'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'
export function resizeEdge(x:number,y:number):ResizeEdge {
  const horizontal=x<.25?'w':x>.75?'e':'',vertical=y<.25?'n':y>.75?'s':''
  return (vertical+horizontal || (Math.abs(x-.5)>Math.abs(y-.5)?(x<.5?'w':'e'):(y<.5?'n':'s'))) as ResizeEdge
}
/** Keep the opposite edge anchored, including when a drag reaches the minimum size. */
export function resizeRoom(bounds:RoomBounds,edge:ResizeEdge,delta:Point):RoomBounds {
  const next={...bounds}
  if(edge.includes('e'))next.width=Math.max(360,bounds.width+delta.x)
  if(edge.includes('s'))next.height=Math.max(MIN_ROOM_HEIGHT,bounds.height+delta.y)
  if(edge.includes('w')){next.width=Math.max(360,bounds.width-delta.x);next.x=bounds.x+bounds.width-next.width}
  if(edge.includes('n')){next.height=Math.max(MIN_ROOM_HEIGHT,bounds.height-delta.y);next.y=bounds.y+bounds.height-next.height}
  return next
}
export function roomExtent(room:PlannedRoom) {
  return {...room.bounds,width:Math.max(room.bounds.width,...room.employees.map(p=>p.position.x+EMPLOYEE_SIZE.width)),height:Math.max(room.bounds.height,...room.employees.map(p=>p.position.y+EMPLOYEE_SIZE.height))}
}

export function initialBounds(index: number, room?: RoomLayout): RoomBounds {
  return { x: (room?.col ?? index % 3) * 860, y: (room?.row ?? Math.floor(index / 3)) * 670,
    width: (room?.w ?? 1) * 760, height: (room?.h ?? 1) * MIN_ROOM_HEIGHT,
    shape: 'rounded', arrangement: 'grid', ...room?.bounds }
}
export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false
  for (let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i], b=points[j]
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside
  }
  return inside
}
export function shapeContains(bounds: RoomBounds, p: Point): boolean {
  const x=p.x/bounds.width, y=p.y/bounds.height
  if (bounds.shape==='ellipse') return ((x-.5)/.5)**2 + ((y-.5)/.5)**2 <= .94
  if (bounds.shape==='hexagon') return pointInPolygon({x,y},[{x:.14,y:.01},{x:.86,y:.01},{x:.99,y:.5},{x:.86,y:.99},{x:.14,y:.99},{x:.01,y:.5}])
  if (bounds.shape==='custom') return pointInPolygon({x,y},bounds.points ?? DEFAULT_POLYGON)
  // Fixed clearance: enlarging a rectangular room must not push stationary employees inward.
  return p.x>=18 && p.x<=bounds.width-18 && p.y>=18 && p.y<=bounds.height-18
}
const overlaps = (a:Point,b:Point) => Math.abs(a.x-b.x)<EMPLOYEE_SIZE.width+18 && Math.abs(a.y-b.y)<EMPLOYEE_SIZE.height+16
const cornersFit = (b:RoomBounds,p:Point) => [p,{x:p.x+EMPLOYEE_SIZE.width,y:p.y},{x:p.x,y:p.y+EMPLOYEE_SIZE.height},{x:p.x+EMPLOYEE_SIZE.width,y:p.y+EMPLOYEE_SIZE.height}].every(c=>shapeContains(b,c))

/** Full employee footprint must fit, including concave custom-outline notches. */
export function employeeFits(b:RoomBounds,p:Point):boolean {
  if(p.x<18||p.y<EMPLOYEE_TOP||p.x+EMPLOYEE_SIZE.width>b.width-18||p.y+EMPLOYEE_SIZE.height>b.height-18||!cornersFit(b,p))return false
  if(b.shape!=='custom')return true
  const polygon=(b.points??DEFAULT_POLYGON).map(v=>({x:v.x*b.width,y:v.y*b.height}))
  // A polygon boundary entering the rectangle means part of the footprint is outside.
  const left=p.x+.01,right=p.x+EMPLOYEE_SIZE.width-.01,top=p.y+.01,bottom=p.y+EMPLOYEE_SIZE.height-.01
  return !polygon.some((a,i)=>{
    const z=polygon[(i+1)%polygon.length],dx=z.x-a.x,dy=z.y-a.y
    let lo=0,hi=1
    for(const [origin,delta,min,max] of [[a.x,dx,left,right],[a.y,dy,top,bottom]]){
      if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return false}
      else{lo=Math.max(lo,Math.min((min-origin)/delta,(max-origin)/delta));hi=Math.min(hi,Math.max((min-origin)/delta,(max-origin)/delta))}
    }
    return lo<=hi
  })
}
const fits=employeeFits

/** Resize the outline around fixed world-space employee footprints, without rearranging them. */
export function resizeOccupiedRoom(room:PlannedRoom,requested:RoomBounds):PlannedRoom {
  const near=(a:number,b:number)=>Math.abs(a-b)<1e-6
  const anchored=(near(requested.x,room.bounds.x)||near(requested.x+requested.width,room.bounds.x+room.bounds.width))&&(near(requested.y,room.bounds.y)||near(requested.y+requested.height,room.bounds.y+room.bounds.height))
  // A combined CLI placement/size update can move the Team; edge dragging keeps an opposite edge fixed.
  const origin=anchored?room.bounds:requested
  const basis={...room.bounds,x:origin.x,y:origin.y}
  const world=room.employees.map(({position})=>({x:origin.x+position.x,y:origin.y+position.y}))
  if(!world.length)return {...room,bounds:requested}
  const left=Math.min(requested.x,...world.map(p=>p.x-18)),top=Math.min(requested.y,...world.map(p=>p.y-EMPLOYEE_TOP))
  const right=Math.max(requested.x+requested.width,...world.map(p=>p.x+EMPLOYEE_SIZE.width+18))
  const bottom=Math.max(requested.y+requested.height,...world.map(p=>p.y+EMPLOYEE_SIZE.height+18))
  const target={...requested,x:left,y:top,width:right-left,height:bottom-top}
  const contains=(bounds:RoomBounds)=>world.every(p=>employeeFits(bounds,{x:p.x-bounds.x,y:p.y-bounds.y}))
  let bounds=target
  if(!contains(target)){
    const at=(t:number)=>({...target,x:basis.x+(target.x-basis.x)*t,y:basis.y+(target.y-basis.y)*t,width:basis.width+(target.width-basis.width)*t,height:basis.height+(target.height-basis.height)*t})
    let low=0,high=1
    for(let i=0;i<24;i++){const t=(low+high)/2;if(contains(at(t)))low=t;else high=t}
    bounds=at(low)
  }
  return {...room,bounds,employees:room.employees.map((employee,i)=>({...employee,position:{x:world[i].x-bounds.x,y:world[i].y-bounds.y}}))}
}
/** Project a drag onto the legal footprint area; used identically by Core and preview. */
export function constrainEmployee(b:RoomBounds,point:Point,previous?:Point):Point {
  const p={x:Math.max(18,Math.min(b.width-EMPLOYEE_SIZE.width-18,point.x)),y:Math.max(EMPLOYEE_TOP,Math.min(b.height-EMPLOYEE_SIZE.height-18,point.y))}
  if(fits(b,p))return p
  let anchor=previous&&fits(b,previous)?previous:undefined
  if(!anchor){
    let distance=Infinity
    for(let y=0;y<=20;y++)for(let x=0;x<=20;x++){
      const candidate={x:18+(b.width-EMPLOYEE_SIZE.width-36)*x/20,y:EMPLOYEE_TOP+(b.height-EMPLOYEE_SIZE.height-EMPLOYEE_TOP-18)*y/20}
      const d=(candidate.x-p.x)**2+(candidate.y-p.y)**2
      if(d<distance&&fits(b,candidate)){anchor=candidate;distance=d}
    }
  }
  if(!anchor)throw new Error('团队外框无法容纳完整工位，请扩大团队或调整形状')
  let low=0,high=1
  for(let i=0;i<18;i++){const t=(low+high)/2,candidate={x:anchor.x+(p.x-anchor.x)*t,y:anchor.y+(p.y-anchor.y)*t};if(fits(b,candidate))low=t;else high=t}
  return {x:anchor.x+(p.x-anchor.x)*low,y:anchor.y+(p.y-anchor.y)*low}
}

export type SnapGuide = {x?:number;y?:number}
/** Soft attraction to normal seats and existing rows. Distances are screen pixels. */
export function snapEmployee(room:PlannedRoom,id:string,point:Point,zoom=1,previous:SnapGuide={}):{position:Point;guide:SnapGuide} {
  const others=room.employees.filter(item=>item.card.id!==id)
  const choose=(axis:'x'|'y',origin:number,step:number)=>{
    const grid=origin+Math.max(0,Math.round((point[axis]-origin)/step))*step
    const center=axis==='x'?(room.bounds.width-EMPLOYEE_SIZE.width)/2:(room.bounds.height-EMPLOYEE_SIZE.height)/2
    const anchors=[grid,...others.map(item=>item.position[axis]),...(room.employees.length===1?[center]:[])]
    const held=previous[axis]
    if(held!==undefined&&Math.abs(point[axis]-held)*zoom<=22)return held
    const closest=anchors.reduce((a,b)=>Math.abs(b-point[axis])<Math.abs(a-point[axis])?b:a)
    return Math.abs(closest-point[axis])*zoom<=13?closest:undefined
  }
  const x=choose('x',48,225),y=choose('y',EMPLOYEE_TOP,285)
  const bounds=room.bounds
  const options:SnapGuide[]=[{x,y},{x},{y}]
  for(const guide of options){
    if(guide.x===undefined&&guide.y===undefined)continue
    const position={x:guide.x??point.x,y:guide.y??point.y}
    if(fits(bounds,position)&&!others.some(item=>overlaps(position,item.position)))return {position,guide}
  }
  return {position:point,guide:{}}
}

export const TEAM_SEAT_COLUMNS=3
export const TEAM_ROOM_WIDTH=760
export const TEAM_SEAT_STEP={x:225,y:285}
export const teamSeatCapacity=(count:number)=>Math.max(6,Math.ceil(count/TEAM_SEAT_COLUMNS)*TEAM_SEAT_COLUMNS)
export const teamSeatPosition=(number:number,columns=TEAM_SEAT_COLUMNS):Point=>({x:60+((number-1)%columns)*TEAM_SEAT_STEP.x,y:EMPLOYEE_TOP+Math.floor((number-1)/columns)*TEAM_SEAT_STEP.y})
/** Retain valid seats. Legacy free positions become a stable row/column ordering. */
export function assignedTeamSeats(cards:StoredSession[],capacity=teamSeatCapacity(cards.length)):Map<string,number>{
  const result=new Map<string,number>(),used=new Set<number>()
  for(const card of cards)if(Number.isInteger(card.seatNumber)&&card.seatNumber!>0&&card.seatNumber!<=capacity&&!used.has(card.seatNumber!)){result.set(card.id,card.seatNumber!);used.add(card.seatNumber!)}
  const remaining=cards.filter(card=>!result.has(card.id)).sort((a,b)=>a.position&&b.position?a.position.y-b.position.y||a.position.x-b.position.x:a.position?-1:b.position?1:0)
  let seat=1
  for(const card of remaining){while(used.has(seat))seat++;result.set(card.id,seat);used.add(seat)}
  return result
}
/** Rigid rectangles and numbered seats; neither old geometry nor a drag changes dimensions. */
export function planRoom(name:string,cards:StoredSession[],requested:RoomBounds,grid?:TeamSeating):PlannedRoom{
  const columns=grid?.columns??3,rows=Math.max(grid?.rows??2,Math.ceil(cards.length/columns)),capacity=columns*rows,assigned=assignedTeamSeats(cards,capacity),seating={columns,rows}
  const bounds:RoomBounds={...requested,width:310+(columns-1)*TEAM_SEAT_STEP.x,height:EMPLOYEE_TOP+(rows-1)*TEAM_SEAT_STEP.y+EMPLOYEE_SIZE.height+36,shape:'rounded',arrangement:'grid',points:undefined}
  const seats:TeamSeat[]=Array.from({length:capacity},(_,index)=>({number:index+1,row:Math.floor(index/columns)+1,column:index%columns+1,position:teamSeatPosition(index+1,columns),employeeId:cards.find(card=>assigned.get(card.id)===index+1)?.id}))
  return {name,bounds,seating,seats,employees:cards.map(card=>({card,position:teamSeatPosition(assigned.get(card.id)!,columns)}))}
}
export function minimumTeamSeating(room:PlannedRoom):TeamSeating{
  const occupied=room.seats?.filter(seat=>seat.employeeId)??[]
  return {columns:Math.max(1,...occupied.map(seat=>seat.column)),rows:Math.max(1,...occupied.map(seat=>seat.row))}
}
export function resizeTeamSeating(room:PlannedRoom,seating:TeamSeating):PlannedRoom{
  const columns=room.seating?.columns??3
  const cards=room.employees.map(({card})=>({...card,seatNumber:Math.floor((card.seatNumber!-1)/columns)*seating.columns+(card.seatNumber!-1)%columns+1}))
  return {...planRoom(room.name,cards,room.bounds,seating),slot:room.slot,placement:room.placement}
}
export const teamBoardCapacity=(rooms:PlannedRoom[])=>Math.max(6,Math.ceil(Math.max(rooms.length,...rooms.map(room=>room.slot??0))/3)*3)
/** Board targets keep their own origins; resizing a different room cannot move them. */
export function teamBoardTargets(rooms:PlannedRoom[]){
  return Array.from({length:teamBoardCapacity(rooms)},(_,index)=>{
    const slot=index+1,room=rooms.find(room=>room.slot===slot)
    return {slot,occupied:!!room,bounds:room?.bounds??{x:(index%3)*900,y:Math.floor(index/3)*855,width:760,height:711}}
  })
}
export function layoutTeamRooms(rooms:PlannedRoom[],columns=3):PlannedRoom[]{
  return rooms.map((room,index)=>{const slot=room.slot??index+1;return room.bounds.pinned?room:{...room,slot,bounds:{...room.bounds,x:((slot-1)%columns)*900,y:Math.floor((slot-1)/columns)*855,pinned:true}}})
}
export function planOffice(store:Store):PlannedRoom[]{
  const names=[...store.groups]
  if(store.sessions.some(card=>!names.includes(card.group)))names.push('')
  const used=new Set<number>(),assigned=new Map<string,number>()
  for(const name of names){const slot=store.rooms?.[name]?.slot;if(Number.isInteger(slot)&&slot!>0&&!used.has(slot!)){assigned.set(name,slot!);used.add(slot!)}}
  let slot=1;for(const name of names)if(!assigned.has(name)){while(used.has(slot))slot++;assigned.set(name,slot);used.add(slot)}
  return layoutTeamRooms(names.map((name,index)=>{
    const saved=store.rooms?.[name],bounds=initialBounds(index,saved),slot=assigned.get(name)!
    const trusted=!!saved?.seating&&bounds.shape==='rounded'&&bounds.arrangement==='grid'&&Number.isFinite(bounds.x)&&Number.isFinite(bounds.y)
    const placement=saved?.placement??(trusted?{column:Math.round(bounds.x/TEAM_SEAT_STEP.x),row:Math.round(bounds.y/TEAM_SEAT_STEP.y)}:{column:((slot-1)%3)*4,row:Math.floor((slot-1)/3)*3})
    return {...planRoom(name,store.sessions.filter(card=>card.group===name||(!name&&!store.groups.includes(card.group))),{...bounds,x:placement.column*TEAM_SEAT_STEP.x,y:placement.row*TEAM_SEAT_STEP.y,pinned:true},saved?.seating),placement,slot}

  }))
}
export function fitViewport(rooms: PlannedRoom[], width: number, height: number): Viewport {
  if (!rooms.length) return DEFAULT_VIEW
  const minX=Math.min(...rooms.map(r=>r.bounds.x)), minY=Math.min(...rooms.map(r=>r.bounds.y))-60
  const maxX=Math.max(...rooms.map(r=>r.bounds.x+roomExtent(r).width)), maxY=Math.max(...rooms.map(r=>r.bounds.y+roomExtent(r).height))
  const zoom=Math.min(1.1,Math.max(.08,Math.min((width-100)/(maxX-minX),(height-130)/(maxY-minY))))
  return {x:(width-(maxX-minX)*zoom)/2-minX*zoom,y:(height-(maxY-minY)*zoom)/2-minY*zoom,zoom}
}
