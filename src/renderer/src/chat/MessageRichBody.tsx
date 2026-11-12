import {useMemo} from 'react'
import {messageImageIndex,messageImageIndices} from '../../../shared/message-inline-images'
import {MessageImage,MessageImages} from './MessageImage'
import {RichMessageText} from './RichMessageText'

export function MessageRichBody({text,paths=[],...source}:{text:string;paths?:string[];employee?:string;worker?:string;group?:string;channel?:string;messageId?:string}){
 const inline=useMemo(()=>messageImageIndices(text),[text])
 return <><RichMessageText className="text" text={text} quoteText stateKey={source.messageId} renderImage={(url,alt)=>{const index=messageImageIndex(url);if(index===undefined)return;return paths[index]?<span className="message-inline-photo" data-quote-atomic><MessageImage {...source} path={paths[index]} caption={alt||text}/></span>:<span>{alt}</span>}}/><MessageImages {...source} paths={paths.filter((_,index)=>!inline.has(index))} caption={text}/></>
}
