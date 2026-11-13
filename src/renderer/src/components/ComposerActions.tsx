import {translate as uiText} from '../i18n'
import {Icon} from './Icon'

export function ComposerActions({busy,disabled,pending,steer,stopping=false,queueCount=0,onSend,onStop}:{busy:boolean;disabled:boolean;pending?:'send'|'steer';steer?:{reason?:string;send:()=>void};stopping?:boolean;queueCount?:number;onSend:()=>void;onStop:()=>void}){
 const stopHint=uiText(queueCount?'Stop this task and cancel {0} queued messages':'Stop this task',[queueCount])
 return <div className="composer-actions">
  {busy&&steer&&<button className="send-btn steer" aria-label={uiText('Steer now')} disabled={disabled||!!steer.reason||!!pending||stopping} title={steer.reason??uiText('Add instructions to the task running now')} onClick={steer.send}>{pending==='steer'?<span className="spinner"/>:<Icon name="debug-step-into"/>}<span>{uiText('Steer now')}</span></button>}
  <button className={`send-btn ${busy?'enqueue':'send'}`} disabled={disabled||!!pending||stopping} aria-busy={pending==='send'} aria-label={uiText(busy?'Queue message':'Send message')} title={uiText(busy?'Run after this task · Enter to queue':'Send message · Enter to send')} onClick={onSend}>{pending==='send'?<span className="spinner"/>:<Icon name={busy?'list-ordered':'arrow-up'}/>}<span>{uiText(busy?'Queue':'Send')}</span></button>
  {busy&&<button className="send-btn stop" disabled={stopping} aria-label={uiText('Stop')} title={stopHint} onClick={onStop}>{stopping?<span className="spinner"/>:<Icon name="debug-stop"/>}<span>{uiText('Stop')}</span></button>}
 </div>
}
