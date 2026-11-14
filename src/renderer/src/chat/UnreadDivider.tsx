import {translate as uiText,useI18n} from '../i18n'

/** A reading boundary displayed only while its referenced content remains unread. */
export function UnreadDivider({reply=false,earlier,loading=false}:{reply?:boolean;earlier?:()=>void;loading?:boolean}){
 useI18n()
 return <div className="message-unread-divider" data-unread-boundary><span role="separator" aria-label={uiText(reply?'Unread reply':'Unread messages')}>{uiText(reply?'Unread reply':'Unread messages')}</span>{earlier&&<button disabled={loading} onClick={earlier}>{uiText(loading?'Loading…':'Load earlier unread messages')}</button>}</div>
}
