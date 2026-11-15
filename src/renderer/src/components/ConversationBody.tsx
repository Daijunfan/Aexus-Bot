import type {ReactNode} from 'react'
import {FileWorkspace} from './FileWorkspace'
import {EmployeeTerminal} from './EmployeeTerminal'

/** Messages never opens a terminal or polls a file tree. The workbench remains explicit. */
export function ConversationBody({messages,...props}:{messages:boolean;employee:string;settingsRevision?:number;explorerWidth?:number;terminalHeight?:number;explorerCollapsed?:boolean;explorerTreeCollapsed?:boolean;active?:boolean;autoOpenTerminal?:boolean;terminalReady?:boolean;onAttachImage:(path:string)=>void;children:ReactNode}){
 if(messages)return <div className="message-chat-body">{props.children}</div>
 return <EmployeeWorkbench {...props}/>
}
export function EmployeeWorkbench({employee,settingsRevision,explorerWidth,terminalHeight,explorerCollapsed,explorerTreeCollapsed,active=true,autoOpenTerminal=true,terminalReady=true,onAttachImage,children}:Omit<Parameters<typeof ConversationBody>[0],'messages'>){
 return <div className="employee-workbench"><FileWorkspace active={active} settingsRevision={settingsRevision} explorerWidth={explorerWidth} explorerCollapsed={explorerCollapsed} explorerTreeCollapsed={explorerTreeCollapsed} bottomPanel={<EmployeeTerminal active={active} settingsRevision={settingsRevision} autoOpen={autoOpenTerminal} ready={terminalReady} terminalHeight={terminalHeight} key={'terminal-'+employee} employee={employee}/>} onAttachImage={onAttachImage} key={'files-'+employee} employee={employee}>{children}</FileWorkspace></div>
}
