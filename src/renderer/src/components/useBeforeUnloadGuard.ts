import {useEffect,useRef} from 'react'
import {flushPlugins} from '../plugins'

/** Browser reload/close must not bypass the same save guards used by in-app navigation. */
export function useBeforeUnloadGuard(dirty:boolean|(()=>boolean)){
 const current=useRef(dirty);current.current=dirty
 useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(!(typeof current.current==='function'?current.current():current.current))return;event.preventDefault();event.returnValue='';void flushPlugins().catch(()=>{})};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[])
}
