import {WorkerBoardPanel} from './WorkerBoardPanel'
import {nativeWorkerTeam,type NativeWorker} from '../../../shared/native-worker'
import {useDialogFocus} from '../office/useDialogFocus'
import type {BoardCategory} from '../../../shared/board-categories'
import {useCatalog} from './useCatalog'
import {BoardSidebar} from './BoardSidebar'
import {BoardCategoryEditor} from './BoardCategoryEditor'
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react'
import type {Session,Store,StoredSession} from '../../../shared/types'
import {ENGINE_DEFINITIONS} from '../../../shared/engines'
import {api} from '../api'
import {translate as uiText} from '../i18n'
import {Icon} from './Icon'
import {AppSelect} from './AppSelect'
import {AgentBoardPanel,type BoardDrafts,type SetBoardDrafts} from './AgentBoardPanel'
import {useMessenger} from './useMessenger'
export type {BoardDrafts} from './AgentBoardPanel'

export function AgentBoard({store,catalogStore=store,sessions,obscured,drafts,setDrafts,onOpen,workers:allWorkers,workersLoading,workersError,refreshWorkers,focusWorker,onWorkerFocused}:{onWorkerFocused:()=>void;workers:NativeWorker[];workersLoading:boolean;workersError:string;refreshWorkers:()=>Promise<unknown>;focusWorker?:string;store:Store;catalogStore?:Store;sessions:Session[];obscured:boolean;drafts:BoardDrafts;setDrafts:SetBoardDrafts;onOpen:(card:StoredSession)=>void}){
 const root=useRef<HTMLElement>(null),[query,setQuery]=useState(''),needle=query.trim().toLocaleLowerCase(),messenger=useMessenger()!
 const memoryKey='aexus-board-category:'+(sessionStorage.getItem('agents-company-client')??'desktop'),[categoryId,setCategoryId]=useState(()=>localStorage.getItem(memoryKey)??'all'),[editor,setEditor]=useState<BoardCategory|'new'|null>(null),[focusKey,setFocusKey]=useState(''),pendingCategory=useRef('')
 const [sidebarWidth,setSidebarWidth]=useState(()=>Math.max(58,Math.min(380,Number(localStorage.getItem(memoryKey+':width'))||240))),[sidebarCollapsed,setSidebarCollapsed]=useState(()=>localStorage.getItem(memoryKey+':collapsed')==='true'||matchMedia('(max-width:760px)').matches),[narrow,setNarrow]=useState(()=>matchMedia('(max-width:760px)').matches)
 const expandedSidebarWidth=useRef(sidebarWidth>=180?sidebarWidth:Math.max(180,Math.min(380,Number(localStorage.getItem(memoryKey+':expanded-width'))||240)))
 useEffect(()=>{const media=matchMedia('(max-width:760px)'),update=()=>{setNarrow(media.matches);setSidebarCollapsed(media.matches||localStorage.getItem(memoryKey+':collapsed')==='true')};media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[memoryKey])
 useDialogFocus('.board-workspace-layout[data-directory-overlay=true] .board-sidebar',narrow&&!sidebarCollapsed,()=>root.current?.querySelector<HTMLButtonElement>('[aria-label] .board-directory-actions button:last-child')??null)
 useEffect(()=>{if(!narrow||sidebarCollapsed||editor)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();event.stopPropagation();setSidebarCollapsed(true)}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[narrow,sidebarCollapsed,editor])
 const compactSidebar=sidebarCollapsed||!narrow&&sidebarWidth<180
 const collapseSidebar=()=>{const next=!compactSidebar;if(!next&&!narrow&&sidebarWidth<180){setSidebarWidth(expandedSidebarWidth.current);localStorage.setItem(memoryKey+':width',String(expandedSidebarWidth.current))}setSidebarCollapsed(next);localStorage.setItem(memoryKey+':collapsed',String(next))}
 const setSidebarDraft=(value:number|undefined)=>{if(value===undefined)root.current?.style.removeProperty('--board-sidebar-draft-width');else root.current?.style.setProperty('--board-sidebar-draft-width',value+'px')}
 const resizeSidebar=async(value:number)=>{setSidebarWidth(value);setSidebarCollapsed(false);root.current?.style.removeProperty('--board-sidebar-draft-width');root.current?.style.setProperty('--board-sidebar-width',value+'px');localStorage.setItem(memoryKey+':width',String(value));localStorage.setItem(memoryKey+':collapsed','false');if(value>=180)expandedSidebarWidth.current=value;localStorage.setItem(memoryKey+':expanded-width',String(expandedSidebarWidth.current))}
 const categories=useCatalog<BoardCategory>('board.categories',true,event=>event.channel==='store:changed'&&(!event.payload?.changes||event.payload.changes.fields.includes('boardCategories'))),selectedCategory=categories.value.find(category=>category.id===categoryId)
 const selectCategory=useCallback((id:string)=>{pendingCategory.current='';setCategoryId(id);setQuery('');setFocusKey('');root.current?.querySelector('.agent-board-scroll')?.scrollTo({top:0,left:0,behavior:'instant'});if(narrow)setSidebarCollapsed(true);localStorage.setItem(memoryKey,id)},[memoryKey,narrow])
 useEffect(()=>{if(pendingCategory.current&&categories.value.some(category=>category.id===pendingCategory.current)){selectCategory(pendingCategory.current);pendingCategory.current=''}else if(categories.ready&&categoryId!=='all'&&!categories.value.some(category=>category.id===categoryId))selectCategory('all')},[categories.value,categories.ready,categoryId,selectCategory])
 const [layoutPending,setLayoutPending]=useState(false),[layoutError,setLayoutError]=useState(''),layoutBusy=useRef(false),maxColumns=store.preferences?.boardMaxColumns??4
 const setColumns=async(value:number)=>{if(layoutBusy.current)return;layoutBusy.current=true;setLayoutPending(true);setLayoutError('');try{await api.call('settings.set',{boardMaxColumns:value})}catch(cause){setLayoutError((cause as Error).message)}finally{layoutBusy.current=false;setLayoutPending(false)}}
 const inCategory=(id:string)=>categoryId==='all'||!!selectedCategory?.employeeIds.includes(id)
 const scopeActive=!!store.activeTeamViewId&&store.activeTeamViewId!=='all'
 const categoryWorkers=allWorkers.filter(worker=>(!scopeActive||store.groups.includes(nativeWorkerTeam(worker,catalogStore)??''))&&(categoryId==='all'||!!selectedCategory?.workerIds?.includes(worker.id)))
 const workers=categoryWorkers.filter(worker=>[worker.title,worker.cwd,'Worker',ENGINE_DEFINITIONS[worker.engine].label,nativeWorkerTeam(worker,catalogStore),catalogStore.sessions.find(card=>card.id===worker.employee)?.title].join(' ').toLocaleLowerCase().includes(needle))
 const categoryEmployees=store.sessions.filter(card=>!card.deleting&&inCategory(card.id))
 const employees=categoryEmployees.filter(card=>[card.title,card.group,ENGINE_DEFINITIONS[card.engine].label].join(' ').toLocaleLowerCase().includes(needle))
 const memberCount=employees.length+workers.length
 const globalMembers=selectedCategory?catalogStore.sessions.some(card=>!card.deleting&&selectedCategory.employeeIds.includes(card.id))||allWorkers.some(worker=>selectedCategory.workerIds?.includes(worker.id)):catalogStore.sessions.some(card=>!card.deleting)||allWorkers.length>0
 const scopeEmpty=!needle&&store.activeTeamViewId!==undefined&&store.activeTeamViewId!=='all'&&globalMembers&&!memberCount
 const showAllTeams=()=>void api.call('view.select',{id:'company',teamViewId:'all',teamTab:'board'}).catch(cause=>setLayoutError(cause.message))
 const employeeIds=new Set(employees.map(card=>card.id)),workerIds=new Set(workers.map(worker=>worker.id)),pendingWorker=useRef('')
 useEffect(()=>{if(focusKey&&!employees.some(card=>focusKey==='employee:'+card.id)&&!workers.some(worker=>focusKey==='worker:'+worker.id))setFocusKey('')},[employees.map(card=>card.id).join(','),workers.map(worker=>worker.id).join(','),focusKey])
 const locate=useCallback((key:string)=>{setFocusKey(key);if(narrow)setSidebarCollapsed(true);const [kind,id]=key.split(':'),element=root.current?.querySelector<HTMLElement>(`[data-${kind==='worker'?'worker':'employee'}="${CSS.escape(id)}"]`);element?.scrollIntoView({block:'start',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})},[narrow])
 useEffect(()=>{if(focusWorker){pendingWorker.current=focusWorker;selectCategory('all')}},[focusWorker])
 useEffect(()=>{const id=pendingWorker.current;if(id&&workerIds.has(id)){pendingWorker.current='';locate('worker:'+id);onWorkerFocused()}},[workers.map(worker=>worker.id).join(','),locate])
 useEffect(()=>{root.current?.querySelector('.agent-board-scroll')?.scrollTo({top:0,left:0})},[categoryId,query])
 useLayoutEffect(()=>{
  const scroll=root.current?.querySelector<HTMLElement>('.agent-board-scroll'),grid=root.current?.querySelector<HTMLElement>('.agent-board-grid');if(!scroll||!grid)return
  const fit=()=>{const gap=parseFloat(getComputedStyle(grid).columnGap)||14,columns=Math.max(1,Math.min(maxColumns,Math.floor((grid.clientWidth+gap)/(300+gap)),memberCount||1));grid.style.setProperty('--board-columns',String(columns));grid.style.setProperty('--board-panel-height',Math.max(660,Math.min(820,scroll.clientHeight-20))+'px')}
  const observer=new ResizeObserver(fit);observer.observe(scroll);fit();return()=>observer.disconnect()
 },[memberCount,maxColumns])
 const saved=(id:string)=>{setEditor(null);if(categories.value.some(category=>category.id===id))selectCategory(id);else pendingCategory.current=id;void categories.refresh()}
 const remove=async(category:BoardCategory)=>{try{await api.call('board.category-delete',{id:category.id,expectedRevision:category.revision})}finally{await categories.refresh()}}
 const reorder=async(order:string[])=>{try{await api.call('board.category-order',{order,expectedOrder:categories.value.map(category=>category.id)});await categories.refresh();return true}catch(cause){setLayoutError((cause as Error).message);await categories.refresh();return false}}
 return <section ref={root} className="agent-board board-workspace-layout" aria-label={uiText('Agent Board')} data-focus-agent={focusKey} data-directory-collapsed={sidebarCollapsed} data-directory-overlay={narrow&&!sidebarCollapsed} style={{'--board-sidebar-width':sidebarWidth+'px'} as CSSProperties}>
  {narrow&&!sidebarCollapsed&&<button className="board-directory-backdrop" aria-label={uiText('Close agents sidebar')} onClick={()=>setSidebarCollapsed(true)}/>}
  <BoardSidebar overlay={narrow&&!sidebarCollapsed} collapsed={compactSidebar} width={sidebarCollapsed?58:sidebarWidth} onCollapse={collapseSidebar} onWidthDraft={setSidebarDraft} onWidth={resizeSidebar} categories={categories.value} selectedId={categoryId} onSelect={selectCategory} onCreate={()=>setEditor('new')} onEdit={setEditor} onDelete={remove} onOrder={reorder} employees={employees} workers={workers} store={catalogStore} totalMembers={categoryEmployees.length+categoryWorkers.length} scopeName={store.activeTeamViewId&&store.activeTeamViewId!=='all'?store.teamViews?.find(view=>view.id===store.activeTeamViewId)?.name:undefined} sessions={sessions} query={query} onQuery={setQuery} onLocate={locate} focusKey={focusKey} loading={!categories.ready||workersLoading} scopeEmpty={scopeEmpty} onShowAllTeams={showAllTeams}/>
  <div className="board-main"><header className="agent-board-toolbar board-main-heading"><div className="board-heading-copy"><span>{uiText('Team')}</span><h2 title={needle?uiText('Search results'):selectedCategory?.name??uiText('All agents')}><span>{needle?uiText('Search results'):selectedCategory?.name??uiText('All agents')}</span><small>{memberCount} {uiText(memberCount===1?'Agent':'Agents')}</small></h2></div><label className="board-column-control"><Icon name="layout"/><span>{uiText('Per row')}</span><AppSelect aria-label={uiText('Maximum columns per row')} title={uiText('Maximum per row; narrow windows show fewer columns.')} value={String(maxColumns)} disabled={layoutPending} onChange={event=>void setColumns(Number(event.target.value))}>{[1,2,3,4,5,6].map(value=><option key={value} value={value}>{value}</option>)}</AppSelect></label></header>
  {layoutError&&<p role="alert" className="board-error">{uiText(layoutError)}</p>}
  {categories.error&&<p role="alert" className="board-error">{uiText(categories.error)}<button onClick={()=>void categories.refresh()}>{uiText('Retry')}</button></p>}
  {workersError&&<p role="alert" className="board-error">{uiText(workersError)}<button onClick={()=>void refreshWorkers()}>{uiText('Retry')}</button></p>}
  {messenger.error&&<p role="alert" className="board-error">{uiText(messenger.error)}<button onClick={()=>void messenger.flushDrafts().catch(()=>{})}>{uiText('Retry save')}</button></p>}
  <div className="agent-board-scroll"><div className="agent-board-grid">
   {store.sessions.filter(card=>!card.deleting).map(card=><div key={card.id} className="board-card-anchor" hidden={!employeeIds.has(card.id)} data-located={focusKey==='employee:'+card.id}><AgentBoardPanel card={card} hidden={!employeeIds.has(card.id)} live={sessions.find(session=>(session.cardId??session.id)===card.id)} enabled={!obscured&&!editor&&employeeIds.has(card.id)} drafts={drafts} setDrafts={setDrafts} onOpen={()=>onOpen(card)} store={store}/></div>)}
   {allWorkers.map(worker=><div key={'worker:'+worker.id} className="board-card-anchor" hidden={!workerIds.has(worker.id)} data-located={focusKey==='worker:'+worker.id}><WorkerBoardPanel preferences={store.preferences} worker={worker} hidden={!workerIds.has(worker.id)} owner={catalogStore.sessions.find(card=>card.id===worker.employee)?.title} enabled={!obscured&&!editor&&workerIds.has(worker.id)} drafts={drafts} setDrafts={setDrafts} refresh={refreshWorkers}/></div>)}
  </div>{!memberCount&&<div className="board-empty"><span className="board-empty-symbol"><Icon name={needle?'search':'layers'}/></span><h2>{uiText(!categories.ready||workersLoading?'Loading…':needle?'No matching agents':scopeEmpty?'No members in this Team view':selectedCategory?'This category is empty':'Your workspace, side by side')}</h2><p>{uiText(needle?'Try another name or Team.':scopeEmpty?'Show all teams to see the members outside this view.':'Choose the agents you want to work with here.')}</p>{scopeEmpty&&<button onClick={showAllTeams}>{uiText('Show all teams')}</button>}{!needle&&!scopeEmpty&&selectedCategory&&<button onClick={()=>setEditor(selectedCategory)}><Icon name="add"/>{uiText('Add members')}</button>}</div>}</div></div>
  {editor&&<BoardCategoryEditor category={editor==='new'?undefined:editor} store={catalogStore} workers={allWorkers} onClose={()=>setEditor(null)} onSaved={saved}/>}
 </section>
}
