import {useEffect,useState} from 'react'

export function useMessageCopy(text:string){
 const [status,setStatus]=useState('')
 useEffect(()=>{if(!status)return;const timer=setTimeout(()=>setStatus(''),2200);return()=>clearTimeout(timer)},[status])
 const copy=async(value=text)=>{try{await navigator.clipboard.writeText(value);setStatus('Copied');return true}catch{setStatus('Could not copy');return false}}
 return {copy,status}
}
