import type {StoredSession} from '../../../shared/types'
import {MessageListAvatar,useMessageAvatarMotion} from '../components/MessageListAvatar'
import {CanvasMotion} from '../office/motion'
import {translate as uiText} from '../i18n'

export function MessageWorking({employee}:{employee:StoredSession}){
 const animate=useMessageAvatarMotion()
 return <CanvasMotion.Provider value={animate}><div className="private-working" data-animate={animate} data-typing-employee={employee.id} role="status" aria-label={uiText('{0} is working',[employee.title])}>
  <span className="private-working-avatar"><MessageListAvatar avatar={employee.avatar} color={employee.color} state="working" continuous/></span>
  <span className="private-working-bubble"><span className="group-typing-dots" aria-hidden="true"><i/><i/><i/></span></span>
 </div></CanvasMotion.Provider>
}
