import {officeConnectionPlan} from '../shared/office-connections'
import {crossTeamRoutes} from '../shared/cross-team-routing'
import {resolveTeamView} from '../shared/team-views'
import {managementActivity} from './management-activity'
import {planOffice,TEAM_SEAT_STEP,teamBoardCapacity,minimumTeamSeating,EMPLOYEE_SIZE} from '../shared/canvas'
import {managementRoutes} from '../shared/management-layout'
import {managementRelations} from '../shared/management'
import {readStore} from './store'
import {authorize,callerEmployee,isGlobal,requestContext,canEditOffice} from './authorization'

/** Geometry-only projection; no host credentials, working files or conversations. */
export function officeLayout(team?:string,viewId?:string){
  authorize('office.layout',{team})
  const store=readStore(),context=requestContext(),caller=callerEmployee(context.principal)
  const global=isGlobal(context.principal),selected=team??(global?undefined:caller!.group)
  if(selected!==undefined&&!store.groups.includes(selected))throw Error('Unknown Team')
  const view=viewId===undefined?undefined:resolveTeamView(store,viewId),authorized=planOffice(store).filter(room=>global||room.name===caller!.group)
  const visible=new Set(authorized.filter(room=>(selected===undefined||room.name===selected)&&(!view||view.teams.includes(room.name))).map(room=>room.name))
  const plan=officeConnectionPlan(authorized,managementRelations(store.sessions,store.access?.bindings),managementActivity().interactions.filter(value=>value.highlighted!==false),visible,store.connectorAnchors)
  return {board:{expandable:true,step:TEAM_SEAT_STEP,slots:teamBoardCapacity(planOffice(store)),columns:3},connections:plan.connections,revision:store.revision,...(view?{view:{id:view.id,name:view.name}}:{}),crossTeamConnections:plan.crossTeamConnections,coordinates:{team:'read-only world pixels',employee:'read-only numbered-seat projection',placement:'Team signed seat-grid columns/rows; employees use one-based seat numbers'},rooms:
    authorized.filter(room=>visible.has(room.name)).map(room=>({
      name:room.name,slot:room.slot,placement:room.placement,seating:room.seating,minimumSeating:minimumTeamSeating(room),bounds:room.bounds,seats:room.seats,geometryEditable:true,
      editable:canEditOffice(store,context.principal,room.name),
      connections:plan.roomConnections.get(room.name)??[],
      employees:room.employees.filter(item=>!item.card.deleting).map(({card,position})=>({
        id:card.id,title:card.title,engine:card.engine,kind:card.kind??'worker',
        managementRole:card.managementRole??'employee',shape:'rectangle',seatNumber:card.seatNumber,position,...EMPLOYEE_SIZE,
        editable:canEditOffice(store,context.principal,room.name,card.id)
      }))
    }))}
}
