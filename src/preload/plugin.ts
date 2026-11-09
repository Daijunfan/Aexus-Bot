// The plugin keeps its HTTP/CLI bridge. Only presentation lifecycle messages cross IPC.
import {contextBridge,ipcRenderer} from 'electron'
contextBridge.exposeInMainWorld('agentsDesktopQuit',{onState:(handler:(state:any)=>void)=>{const listener=(_event:unknown,state:any)=>handler(state);ipcRenderer.on('desktop:quit-state',listener);return()=>ipcRenderer.off('desktop:quit-state',listener)}})
window.addEventListener('message', event => {
  if(event.source!==window||event.origin!==location.origin)return
  const data=event.data,token=location.pathname.split('/')[1]
  if(data?.token!==token||!['agents-plugin:ready','agents-plugin:appearance','agents-plugin:flushed','agents-plugin:external'].includes(data.type))return
  ipcRenderer.send('plugin:message',data)
})
ipcRenderer.on('plugin:flush',(_event,data)=>window.postMessage({type:'agents-plugin:flush',...data},location.origin))
