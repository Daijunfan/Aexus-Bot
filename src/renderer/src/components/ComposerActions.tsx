import {translate as uiText} from '../i18n'
import {Icon} from './Icon'

export function ComposerActions({busy,disabled,pending,steer,stopping=false,queueCount=0,onSend,onStop}:{busy:boolean;disabled:boolean;pending?:'send'|'steer';steer?:{reason?:string;send:()=>void};stopping?:boolean;queueCount?:number;onSend:()=>void;onStop:()=>void}){
 const stopHint=uiText(queueCount?'Stop this task and cancel {0} queued messages':'Stop this task',[queueCount])
 return <div className="composer-actions">
  {busy&&<button type="button" className="send-btn stop" disabled={stopping} aria-busy={stopping} aria-label={uiText('Stop')} title={stopHint} onClick={onStop}>{stopping?<span className="spinner"/>:<Icon name="primitive-square"/>}</button>}
  {busy&&steer&&<button type="button" className="send-btn steer" aria-label={uiText('Steer now')} aria-busy={pending==='steer'} disabled={disabled||!!steer.reason||!!pending||stopping} title={steer.reason??uiText('Add instructions to the task running now')} onClick={steer.send}>{pending==='steer'?<span className="spinner"/>:<Icon name="arrow-up-right"/>}<span className="composer-action-label">{uiText('Steer now')}</span></button>}
  <button type="button" className={`send-btn ${busy?'enqueue':'send'}`} disabled={disabled||!!pending||stopping} aria-busy={pending==='send'} aria-label={uiText(busy?'Queue message':'Send message')} title={uiText(busy?'Run after this task · Enter to queue':'Send message · Enter to send')} onClick={onSend}><span className="composer-action-label">{uiText(busy?'Queue':'Send')}</span>{pending==='send'?<span className="spinner"/>:<Icon name="arrow-up"/>}</button>
 </div>
}
