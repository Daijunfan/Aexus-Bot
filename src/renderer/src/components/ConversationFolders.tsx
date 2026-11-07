import {useEffect,useState} from 'react'
import type {ConversationFolder} from '../../../shared/messenger'
import {translate as uiText,useI18n} from '../i18n'
import {Icon} from './Icon'
import {MessageMenu} from './MessageMenu'
import {useMessenger} from './useMessenger'
import {orderedKeys} from '../../../shared/messenger-order'
import {isBuiltinMessageCategory} from '../../../shared/message-categories'
import {useSortableList} from '../chat/useSortableList'
export {ConversationFolderEditor,type FolderConversation} from './CategoryEditor'

export function ConversationFolders({folders,selectedId,allSelected,onSelect,onAll,onCreate,onEdit}:{folders:ConversationFolder[];selectedId?:string;allSelected:boolean;onSelect:(id:string)=>void;onAll:()=>void;onCreate:()=>void;onEdit:(folder:ConversationFolder)=>void}){
 useI18n()
 const messenger=useMessenger()!,[menu,setMenu]=useState<{id:string;x:number;y:number}|null>(null),[error,setError]=useState(''),[deleting,setDeleting]=useState(false)
 const savedOrder=messenger.state.orders?.categories??[],byId=new Map(folders.map(folder=>[folder.id,folder]))
 const sorting=useSortableList({keys:orderedKeys([...byId.keys()],savedOrder),identity:'categories',axis:'x',disabled:!messenger.ready||!!menu||deleting,label:id=>{const folder=byId.get(id);return folder?(isBuiltinMessageCategory(id)?uiText(folder.name):folder.name):id},save:order=>messenger.reorder('categories',order,savedOrder)}),tabs=sorting.root
 useEffect(()=>{if(!selectedId||sorting.phase==='dragging')return;const frame=requestAnimationFrame(()=>document.getElementById('message-folder-'+selectedId)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}));return()=>cancelAnimationFrame(frame)},[selectedId,folders.length])
 const current=folders.find(folder=>folder.id===menu?.id)
 const open=(folder:ConversationFolder,button:HTMLElement)=>{const box=button.getBoundingClientRect();setError('');setMenu({id:folder.id,x:box.left,y:box.bottom+6})}
 const remove=async()=>{if(!current||deleting)return;setDeleting(true);setError('');try{await messenger.deleteFolder(current.id,current.revision);setMenu(null);document.getElementById('message-folder-add')?.focus()}catch(cause){setError((cause as Error).message)}finally{setDeleting(false)}}
 const move=(event:React.KeyboardEvent,index:number)=>{if(event.altKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const ids=sorting.keys,next=event.key==='Home'?0:event.key==='End'?ids.length-1:(index+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length;const button=tabs.current?.querySelectorAll<HTMLButtonElement>('.message-category-select')[next];button?.focus();button?.scrollIntoView({block:'nearest',inline:'nearest'})}
 return <div className="message-category-bar">
 <button className="message-category-all" type="button" aria-label={uiText('All conversations')} title={uiText('All conversations')} aria-pressed={allSelected} onClick={onAll}>{uiText('All')}</button>
 <div ref={tabs} {...sorting.bindings} className="message-category-tabs message-sortable" role="group" aria-label={uiText('Conversation categories')} aria-busy={sorting.phase==='saving'}>
  {sorting.keys.map((id,index)=>{const folder=byId.get(id)!,builtin=isBuiltinMessageCategory(id),title=builtin?uiText(folder.name):folder.name;return <div className="message-category-chip" data-sort-key={id} data-builtin={builtin||undefined} key={id} data-selected={selectedId===id} onContextMenu={event=>{event.preventDefault();if(!builtin)open(folder,event.currentTarget)}}>
   <button type="button" className="message-category-select" data-sort-start id={'message-folder-'+id} aria-pressed={selectedId===id} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight" aria-description={uiText('Drag to reorder. On touch screens, hold before dragging.')} title={title} onClick={()=>onSelect(id)} onKeyDown={event=>{if(!builtin&&event.key==='ArrowDown'&&!event.altKey){event.preventDefault();if(!builtin)open(folder,event.currentTarget)}else move(event,index)}}><span>{title}</span></button>
   {!builtin&&<button type="button" className="message-category-options" aria-label={uiText('Category options for {0}',[folder.name])} title={uiText('Category options for {0}',[folder.name])} aria-haspopup="menu" onClick={event=>open(folder,event.currentTarget)}><Icon name="ellipsis"/></button>}
  </div>})}
 </div><span className="message-sort-status" role="status" aria-live="polite">{sorting.announcement}</span><button id="message-folder-add" className="message-category-add" aria-label={uiText('Create category')} title={uiText('Create category')} onClick={onCreate}><Icon name="add"/></button>
 {menu&&current&&<MessageMenu anchor={menu} label={uiText('Category options')} onClose={()=>setMenu(null)}><span className="messenger-menu-label">{current.name}</span><button role="menuitem" disabled={deleting} onClick={()=>{setMenu(null);onEdit(current)}}><Icon name="edit"/>{uiText('Edit category')}</button><button role="menuitem" disabled={deleting} onClick={()=>void remove()}><Icon name="trash"/>{uiText('Delete category')}</button><small className="messenger-menu-note">{uiText('Conversations remain when a category is deleted.')}</small>{error&&<p className="message-folder-error" role="alert">{uiText(error)}</p>}</MessageMenu>}
 </div>
}
