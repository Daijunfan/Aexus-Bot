import type {ReactNode} from 'react'
import type {NativeWorker} from '../../../shared/native-worker'
import {FileWorkspace} from './FileWorkspace'
import {EmployeeTerminal} from './EmployeeTerminal'
export function WorkerWorkbench({worker,expanded,children,onAttach,preferences,settingsRevision}:{worker:NativeWorker;settingsRevision?:number;preferences?:import('../../../shared/types').Store['preferences'];expanded:boolean;children:ReactNode;onAttach:(path:string)=>void}){
 return expanded?<FileWorkspace settingsRevision={settingsRevision} explorerWidth={preferences?.explorerWidth} explorerCollapsed={preferences?.explorerCollapsed} explorerTreeCollapsed={preferences?.explorerTreeCollapsed} worker={worker.id} revealAvailable={!worker.host} folderName={worker.cwd.split(/[\\/]/).at(-1)} onAttachImage={onAttach} bottomPanel={<EmployeeTerminal settingsRevision={settingsRevision} employee={'worker:'+worker.id} worker={worker.id} terminalHeight={preferences?.terminalHeight} autoOpen={false}/>}><div className="worker-chat-stack">{children}</div></FileWorkspace>:<div className="worker-chat-stack">{children}</div>
}
