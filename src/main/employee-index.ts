import type {StoredSession} from '../shared/types'
import {readStore,storePath} from './store'
import {fileVersion} from './read-cache'

let version:string|undefined,cards:ReadonlyMap<string,StoredSession>|undefined
/** Derived identities only. Every use observes file replacement/in-place edits, not a cached grant. */
export function employeeIndex():ReadonlyMap<string,StoredSession>{
 const current=fileVersion(storePath())
 if(!cards||current!==version){const store=readStore();cards=new Map(store.sessions.map(card=>[card.id,card]));version=current}
 return cards
}
