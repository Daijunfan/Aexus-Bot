import type {Store} from '../../../shared/types'
import type {ViewState} from '../../../shared/view'
import {PlanView} from './PlanView'
export function MissionView({store,view,act}:{store:Store;view:ViewState;act:(command:string,args?:Record<string,unknown>)=>Promise<any>}){
 return <section className="mission-workspace"><div className="mission-plan-panel"><PlanView store={store} view={view} act={act}/></div></section>
}
