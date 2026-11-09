/** Transient scrollbars for bounded panels. Geometry and overflow never change. */
export const PANEL_SCROLLERS='.scroll-area > :first-child,.file-list,.tool-io,.board-approvals,.plan-global-panel-body,.chat-question textarea,.question-inbox-scroll,.mission-assignee-list,.plan-hidden-tasks>div,.plan-editor-scroll,.plan-editor textarea,.plan-board-column,.plan-board-card p,.plan-database-content,.plan-timeline-scroll,.plan-planner-scroll,.board-roster,.board-category-members,.board-composer textarea,.task-composer textarea,.workbench-tab-list,.worker-send-retry p,.file-preview > textarea,.shared-files-list,.shared-file-cover,.shared-file-confirm,.message-library-tabs,.conversation-control-body,.conversation-member-picker>div,.group-hub-body,.group-hub-tabs,.group-profile-form textarea,.group-card-compose-body,.group-card-composer textarea,.group-thread-messages,.group-thread-compose textarea,.group-sticker-grid,.group-sticker-picker>nav,.group-topic-bar,.group-removed-list'
export function installTransientScrollbars(){
 const timers=new Map<HTMLElement,ReturnType<typeof setTimeout>>()
 let dragging:HTMLElement|null=null,keyboard:HTMLElement|null=null
 const frame=(el:HTMLElement)=>el.parentElement?.classList.contains('scroll-area')?el.parentElement:null
 const flag=(el:HTMLElement,key:string,value:boolean)=>{for(const node of [el,frame(el)])if(node){if(value)node.setAttribute(key,'true');else node.removeAttribute(key)}}
 const clear=(el:HTMLElement)=>{clearTimeout(timers.get(el));timers.delete(el);flag(el,'data-scroll-active',false)}
 const reveal=(el:HTMLElement)=>{if(el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)return;clearTimeout(timers.get(el));flag(el,'data-scroll-active',true);if(el!==dragging&&el!==keyboard)timers.set(el,setTimeout(()=>clear(el),900))}
 const target=(node:EventTarget|null)=>{for(let el=node instanceof Element?node:null;el;el=el.parentElement){if(el.classList.contains('horizontal-scroll-track')||el.classList.contains('scroll-area')){const child=el.closest('.scroll-area')?.firstElementChild;if(child instanceof HTMLElement)return child}if(el instanceof HTMLElement&&el.matches(PANEL_SCROLLERS)&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1))return el}return null}
 const resetKeyboard=()=>{if(keyboard){const previous=keyboard;keyboard=null;flag(previous,'data-scroll-keyboard',false);reveal(previous)}}
 document.addEventListener('wheel',event=>{const el=target(event.target);if(el)reveal(el)},{capture:true,passive:true})
 document.addEventListener('scroll',event=>{const el=event.target;if(el instanceof HTMLElement&&el.matches(PANEL_SCROLLERS)&&(el.matches(':hover')||el===dragging||el===keyboard))reveal(el)},true)
 document.addEventListener('pointerdown',event=>{
  resetKeyboard();const el=target(event.target);if(!el||!event.isPrimary)return
  const box=el.getBoundingClientRect(),scale=box.width/el.offsetWidth||1,range=event.target instanceof Element&&event.target.classList.contains('horizontal-scroll-track'),gutter=event.target===el&&(event.clientX>=box.left+el.clientWidth*scale||event.clientY>=box.top+el.clientHeight*scale)
  if(range||gutter){dragging=el;flag(el,'data-scroll-drag',true);reveal(el)}
 },true)
 const release=()=>{if(dragging){const el=dragging;dragging=null;flag(el,'data-scroll-drag',false);reveal(el)}}
 document.addEventListener('pointerup',release,true);document.addEventListener('pointercancel',release,true)
 document.addEventListener('pointerout',event=>{const el=target(event.target);if(!el||el===dragging||el===keyboard)return;const region=frame(el)??el;if(!(event.relatedTarget instanceof Node)||!region.contains(event.relatedTarget))clear(el)},true)
 document.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key))return;const el=target(event.target);if(!el)return;resetKeyboard();keyboard=el;flag(el,'data-scroll-keyboard',true);reveal(el)},true)
 document.addEventListener('focusin',event=>{const node=event.target;if(node instanceof Element&&node.classList.contains('horizontal-scroll-track')&&node.matches(':focus-visible')&&!dragging){const el=target(node);if(el){resetKeyboard();keyboard=el;flag(el,'data-scroll-keyboard',true);reveal(el)}}},true)
 document.addEventListener('focusout',event=>{if(keyboard){const region=frame(keyboard)??keyboard;if(!(event.relatedTarget instanceof Node)||!region.contains(event.relatedTarget))resetKeyboard()}},true)
 window.addEventListener('blur',()=>{release();resetKeyboard();for(const el of timers.keys())clear(el)})
}
