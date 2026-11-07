// Shared Cloud Hosts SSH terminal services.
import {APP_HOME} from '../shared/protocol'
import {cloudHostTarget,getCloudHost} from './cloud-hosts'
import {openTerminal,listTerminals,closeEmployeeTerminals,terminalOwner} from './terminals'

const owner=(id:string)=>'host:'+id
export function hostTerminals(id:string){getCloudHost(id);return listTerminals(owner(id))}
export function openHostTerminal(id:string,directory?:string,cols=100,rows=28){return openTerminal({id:owner(id),cwd:APP_HOME,remote:cloudHostTarget(id,directory)},cols,rows)}
export function requireHostTerminal(id:string,terminal:string){if(terminalOwner(terminal)!==owner(id))throw Error('终端不属于此云主机');return terminal}
export function assertHostIdle(id:string){if(hostTerminals(id).some(t=>t.running))throw Error('此主机仍有交互终端，请先关闭终端再修改或删除')}
export const closeHostTerminals=(id:string)=>closeEmployeeTerminals(owner(id))
