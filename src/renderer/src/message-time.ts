import {interfaceLocale} from './i18n'

/** Published UTC instants are displayed in the viewer's local zone, using 00–23 hours. */
export function formatMessageClock(value:number|string,seconds=false){
 return new Date(value).toLocaleTimeString(interfaceLocale(),{hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{}),hourCycle:'h23'})
}

export function formatMessageDateTime(value:number|string,full=false){
 const date=new Date(value)
 return date.toLocaleString(interfaceLocale(),{year:full||date.getFullYear()!==new Date().getFullYear()?'numeric':undefined,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',...(full?{second:'2-digit',timeZoneName:'shortOffset'}:{})})
}
