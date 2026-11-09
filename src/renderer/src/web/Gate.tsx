import {translate as uiText,useI18n,interfaceLocale,interfaceLanguage} from '../i18n'
import {useEffect,useState,type ReactNode} from 'react'
import {initializeWeb,onWebState,loginWeb,logoutWeb} from './transport'
import companyIcon from '../../../../app_icon.png'
export function WebGate({children}:{children:ReactNode}){
  useI18n()

  const [state,setState]=useState({authenticated:false,checking:true,connected:false})
  const [opened,setOpened]=useState(false),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    const off=onWebState(value=>{setState(value);if(value.authenticated)setOpened(true)})
    void initializeWeb();return off
  },[])
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError('')
    try{await loginWeb(token);setToken('')}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  const signOut=async()=>{setBusy(true);setError('');try{await logoutWeb()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return <>
    {opened&&children}
    {state.authenticated?
      <div className="web-connection" role="status">{state.connected?uiText("Connected to Core"):uiText("Reconnecting · Work continues on the Core host")}<button disabled={busy} onClick={()=>void signOut()}>{uiText("Sign out")}</button>{error&&<div className="web-session-error" role="alert"><span>{uiText(error)}</span><button aria-label={uiText('Dismiss error')} onClick={()=>setError('')}>×</button></div>}</div>:
      <div className="web-login-overlay"><form className="web-login" onSubmit={submit}>
        <img className="brand-symbol" src={companyIcon} alt="" aria-hidden="true"/>
        <h1>Aexus Bot</h1><p>{uiText("Connect to your Agent workspace.")}</p>
        {state.checking?<p>{uiText("Connecting…")}</p>:<>
          <label>{uiText("Access token")}<input type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} autoFocus required/></label>
          <small>{uiText("Run on the Core host")} <code>agents web token</code>  {uiText("for a token. It is used only to establish a session and is not stored in the browser.")}</small>
          {error&&<p role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>{busy?uiText("Signing in…"):uiText("Enter workspace")}</button>
        </>}
      </form></div>}
  </>
}
