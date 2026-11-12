import {translate as t} from '../i18n'

/** Keep Core/CLI diagnostics intact while giving this workspace readable feedback. */
export function engineeringError(cause:unknown){
 const value=cause as {message?:string},message=String(value?.message??cause).replace(/^Error invoking remote method '[^']+': Error: /,'')
 try{const error=JSON.parse(message);if(error.code==='INVALID_ARGUMENTS')return t('This action could not be applied. Refresh the project and try again.');if(typeof error.message==='string')return t(error.message)}catch{}
 return t(message)
}
