import {useState} from 'react'
import type {BotIssue} from '../../../shared/bot-workers'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {formatMessageDateTime} from '../message-time'
import {Icon} from './Icon'

export const botIssueLabel=(issue:BotIssue)=>uiText(issue.code==='GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT'?'Grok usage limit reached':'Bot could not complete this request')
export function BotIssueNotice({issue,inline=false}:{issue:BotIssue;inline?:boolean}){
 const quota=issue.code==='GROK_BOT_TURN_FAILURE_CODE_USAGE_LIMIT',[error,setError]=useState('')
 const openUsage=async()=>{try{await api.openExternal('https://cursor.com/dashboard/spending');setError('')}catch(cause){setError((cause as Error).message)}}
 return <section className={`bot-issue-notice${inline?' is-inline':''}`} data-issue-code={issue.code} role="status" aria-label={botIssueLabel(issue)}>
  <Icon name={quota?'history':'warning'}/><div><strong>{botIssueLabel(issue)}</strong>
   {!inline&&<p>{quota?uiText('Grok has no remaining usage for this period. Sent messages were delivered, but the task has not completed.'):issue.detail||issue.message}</p>}
   {issue.retryAt&&<time dateTime={new Date(issue.retryAt).toISOString()}>{uiText('Usage resets at {0}',[formatMessageDateTime(issue.retryAt,true)])}</time>}
   {!inline&&quota&&<button className="bot-usage-link" onClick={()=>void openUsage()}>{uiText('View account usage')}<Icon name="arrow-up-right"/></button>}
   {error&&<p role="alert">{error}</p>}
  </div>
 </section>
}
