import {requireAppAdministrator} from './authorization'
import {readStore,writeStore} from './store'
import {listWorkers} from './native-workers'
import type {BoardCategoryInput} from '../shared/board-categories'
export function boardCategories(){requireAppAdministrator();return readStore().boardCategories??[]}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
export function saveBoardCategory(input:BoardCategoryInput){
 requireAppAdministrator()
 const store=readStore(),categories=store.boardCategories??[],current=categories.find(value=>value.id===input.id),name=String(input.name??'').trim()
 if(typeof input.name!=='string'||!/^bc_[a-zA-Z0-9_-]{1,100}$/.test(input.id)||!name||name.length>80)throw Error('Choose a category name of 1–80 characters')
 if(['all','all agents','全部','全部员工'].includes(name.toLocaleLowerCase()))throw Error('This name is reserved for All agents')
 if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0)throw Error('Choose the current category revision')
 if(categories.some(value=>value.id!==input.id&&value.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('A Board category with this name already exists')
 const members=(values:unknown,known:Set<string>)=>{if(!Array.isArray(values)||values.some(id=>typeof id!=='string'||!known.has(id)))throw Error('Some selected members are no longer available. Reload the selection.');return [...new Set(values as string[])].sort()}
 const employeeIds=members(input.employeeIds,new Set(store.sessions.filter(card=>!card.deleting).map(card=>card.id))),workerIds=input.workerIds===undefined?current?.workerIds??[]:members(input.workerIds,new Set(listWorkers().map(worker=>worker.id))),value={id:input.id,name,employeeIds,workerIds}
 if(current&&equal({...current,revision:0},{...value,revision:0}))return current
 if((current?.revision??0)!==input.expectedRevision)throw Error('Board category changed. Load the latest version before saving.')
 const saved={...value,revision:(current?.revision??0)+1};store.boardCategories=current?categories.map(category=>category.id===saved.id?saved:category):[...categories,saved];writeStore(store);return saved
}
export function deleteBoardCategory(id:string,expectedRevision:number){
 requireAppAdministrator();const store=readStore(),current=store.boardCategories?.find(value=>value.id===id)
 if(!current)return {removed:true,id}
 if(current.revision!==expectedRevision)throw Error('Board category changed. Load the latest version before deleting.')
 store.boardCategories=store.boardCategories!.filter(value=>value.id!==id);writeStore(store);return {removed:true,id}
}
export function orderBoardCategories(order:string[],expectedOrder:string[]){
 requireAppAdministrator();const store=readStore(),categories=store.boardCategories??[],current=categories.map(value=>value.id)
 if(!Array.isArray(order)||order.length!==current.length||new Set(order).size!==current.length||order.some(id=>!current.includes(id)))throw Error('Category list changed. Reload before reordering.')
 if(equal(order,current))return categories
 if(!equal(current,expectedOrder))throw Error('Category order changed. Reload before reordering.')
 store.boardCategories=order.map(id=>categories.find(value=>value.id===id)!);writeStore(store);return store.boardCategories
}
