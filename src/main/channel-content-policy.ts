import path from 'node:path'
import {APP_HOME} from '../shared/protocol'
import {messageKey} from '../shared/messenger'
import {readJson} from './atomic-file'
import {one} from './channel-store'

/** A persistent native Coding Agent must never receive an automatically cached channel body. */
export function channelEntrySaved(channelId:string,id:string){
 if(id.startsWith('np_'))return one('SELECT saved_at FROM posts WHERE id=?',id)?.saved_at!=null
 return savedChannelMessages().ids.has(messageKey('channel:'+channelId,id))
}
export function savedChannelMessages(){const state=readJson<any>(path.join(APP_HOME,'messenger.json'),()=>({messages:{}}));return {version:String(state.revision??0),ids:new Set(Object.entries(state.messages??{}).filter(([key,value])=>key.startsWith('channel:')&&(value as any)?.saved===true).map(([key])=>key))}}
export function requireSavedChannelEntry(channelId:string,id:string){if(!channelEntrySaved(channelId,id))throw Error('请先收藏这条频道内容，再引用、转发或交给员工处理。未收藏内容只保留在内存和服务器中。')}
