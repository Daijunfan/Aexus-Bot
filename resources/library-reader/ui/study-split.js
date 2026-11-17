import {$,run,toast} from './dom.js';

const clamp=value=>Math.max(.3,Math.min(.7,value));
// Two content modules, one optional side-by-side arrangement. Reuse the same
// reader and map DOM; order and width are public settings, the camera stays local.
export class StudySplit {
  constructor(study){
    this.study=study;this.settings={};this.lastDocuments=new Map();
    const controls=document.createElement('div');controls.id='study-view-controls';controls.className='study-view-controls';
    study.tabs.replaceWith(controls);controls.append(study.tabs);this.controls=controls;
    // Independently toggle the document and map; both selected means split view.
    controls.insertAdjacentHTML('beforeend','<button id="study-swap-panes" type="button" title="交换文档与脑图的左右位置" aria-label="交换文档与脑图的左右位置" hidden>⇄</button>');
    $('study-swap-panes').onclick=run(async()=>{this.safeLayout();await study.setSettings({studyOrder:this.settings.studyOrder==='map-first'?'document-first':'map-first'});});
    const divider=document.createElement('div');divider.id='study-split-divider';divider.className='study-split-divider';divider.hidden=true;divider.tabIndex=0;
    divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-label','调整文档与脑图宽度');divider.setAttribute('aria-controls','reader-view study-pane');divider.setAttribute('aria-valuemin','30');divider.setAttribute('aria-valuemax','70');
    $('study-pane').before(divider);this.divider=divider;
    divider.addEventListener('pointerdown',e=>this.start(e));
    divider.addEventListener('keydown',run(async e=>{
      if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key)||e.altKey||e.metaKey||e.ctrlKey)return;
      e.preventDefault();e.stopPropagation();this.safeLayout();const sign=this.settings.studyOrder==='map-first'?-1:1;
      const value=e.key==='Enter'?.5:e.key==='Home'?.3:e.key==='End'?.7:clamp((this.settings.studyRatio||.53)+(e.key==='ArrowRight'?1:-1)*sign*(e.shiftKey?.05:.02));
      await study.setSettings({studyRatio:value});
    }));
    divider.addEventListener('dblclick',run(async()=>{this.safeLayout();await study.setSettings({studyRatio:.5});}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.drag){e.preventDefault();e.stopImmediatePropagation();this.finish(false);}},true);
    window.addEventListener('blur',()=>this.finish(false));
    this.toolSlots=[['mm-boundary',480],['mm-summary',480],['mm-relationship',480],['mm-export',480],['mm-format',320],['mm-delete-topic',320]].map(([id,minWidth])=>{const button=$(id),anchor=document.createComment(id);button.before(anchor);return {button,anchor,minWidth};});
    this.resize=new ResizeObserver(()=>this.compactTools());this.resize.observe($('study-pane'));
    // Keep the existing tools; help users find an action in the crowded menu.
    const menu=$('map-more').querySelector('.map-more-body');
    this.menuSearch=document.createElement('input');
    this.menuSearch.id='map-action-search';this.menuSearch.type='search';
    this.menuSearch.placeholder='查找已有操作…';this.menuSearch.autocomplete='off';
    this.menuSearch.setAttribute('aria-label','筛选脑图现有操作');
    menu.prepend(this.menuSearch);
    this.menuSearch.addEventListener('input',()=>this.filterMenu());
    $('map-more').addEventListener('toggle',()=>{
      if(!$('map-more').open){this.menuSearch.value='';this.filterMenu();}
    });
  }
  filterMenu(){
    const menu=$('map-more').querySelector('.map-more-body');
    const query=this.menuSearch.value.trim().toLocaleLowerCase();
    for(const node of menu.querySelectorAll('button,select')){
      const label=(node.title||'')+' '+(node.getAttribute('aria-label')||'')+' '+node.textContent;
      const matching=!query||label.toLocaleLowerCase().includes(query);
      if(!matching&&!node.hidden){node.dataset.searchHidden='true';node.hidden=true;}
      else if(matching&&node.dataset.searchHidden){node.hidden=false;delete node.dataset.searchHidden;}
    }
    for(const child of menu.children){
      if(child===this.menuSearch||!child.querySelectorAll)continue;
      const controls=[...child.querySelectorAll('button,select')];
      if(!controls.length)continue;
      const filtered=query&&controls.every(control=>control.hidden);
      if(filtered&&!child.hidden){child.dataset.searchHidden='true';child.hidden=true;}
      else if(!filtered&&child.dataset.searchHidden){child.hidden=false;delete child.dataset.searchHidden;}
    }
  }
  compactTools(){
    const width=this.active?$('study-pane').clientWidth:Infinity,menu=$('map-more').querySelector('.map-more-body');
    for(const {button,anchor,minWidth} of this.toolSlots)if(width<minWidth){if(button.parentNode!==menu)menu.append(button);}else if(button.parentNode!==anchor.parentNode)anchor.after(button);
  }
  get active(){return this.study.current?.view==='split';}
  get dirty(){return Boolean(this.drag||this.saving);}
  guard(){if(this.dirty)throw Error('请先完成分栏宽度调整。');}
  safeLayout(){
    this.guard();this.study.inspector?.guard();this.study.mindmapStudio?.guard();
    if(this.study.ink?.dirty||this.study.cardInk?.dirty||this.study.excerpts?.draft)throw Error('请先保存或取消当前标注，再调整分栏。');
  }
  apply(settings){
    if(!settings)return;
    if(this.drag&&(settings.studyOrder!==this.settings.studyOrder||settings.studyRatio!==this.settings.studyRatio))this.finish(false);
    this.settings=settings;$('workspace').dataset.studyOrder=settings.studyOrder||'document-first';
    if(!this.drag)this.paintRatio(settings.studyRatio||.53);this.render(Boolean(this.study.getDocument()));
  }
  paintRatio(value){
    const workspace=$('workspace');workspace.style.setProperty('--study-document',value+'fr');workspace.style.setProperty('--study-map',(1-value)+'fr');
    this.divider.setAttribute('aria-valuenow',String(Math.round(value*100)));this.divider.setAttribute('aria-valuetext',`文档 ${Math.round(value*100)}%，脑图 ${Math.round((1-value)*100)}%`);
  }
  render(reading){
    const study=this.study,set=study.current,split=this.active,doc=study.getDocument();
    if(set&&doc&&set.documentIds.includes(doc.id))this.lastDocuments.set(set.id,doc.id);
    if(this.drag&&(!split||set.id!==this.drag.setId))this.finish(false);
    $('workspace').classList.toggle('study-split',split);this.divider.hidden=!split;$('study-pane').hidden=!split;
    if(!set){this.controls.hidden=true;return;}this.controls.hidden=false;
    study.map.attach(split);
    const host=reading?$('study-reading-bar'):$('study-home').querySelector('header');if(this.controls.parentNode!==host)host.append(this.controls);
    const view=split?'split':reading?'documents':set.view;
    for(const button of study.tabs.children)button.setAttribute('aria-pressed',String(split||button.dataset.studyView===view));
    // The two pressed states in study.tabs are the complete view selector.
    $('study-swap-panes').hidden=!split;
    $('study-home-map').hidden=reading||view!=='map';$('study-documents').hidden=reading||!['documents','split'].includes(view);study.documentGallery.tools.hidden=$('study-documents').hidden;
    $('study-home').dataset.surface=view;$('reader-annotations').hidden=!reading||doc?.kind!=='pdf';
    this.compactTools();study.map.window.schedule();
  }
  start(event){
    if(event.button!==0||!this.active||this.study.busy)return;
    try{this.safeLayout();}catch(e){toast(e.message,true);return;}
    event.preventDefault();event.stopPropagation();this.study.map.motion?.finish();this.divider.focus({preventScroll:true});
    const width=$('workspace').querySelector('.main-pane').getBoundingClientRect().width+$('study-pane').getBoundingClientRect().width;
    const drag=this.drag={id:event.pointerId,setId:this.study.current.id,x:event.clientX,width,initial:this.settings.studyRatio||.53,value:this.settings.studyRatio||.53,sign:this.settings.studyOrder==='map-first'?-1:1};
    this.divider.setPointerCapture(event.pointerId);$('workspace').classList.add('resizing-study-split');
    const move=e=>{if(e.pointerId!==drag.id)return;drag.value=clamp(drag.initial+drag.sign*(e.clientX-drag.x)/drag.width);this.paintRatio(drag.value);};
    const end=e=>{if(e.pointerId!==drag.id)return;move(e);run(()=>this.finish(true))();};const cancel=e=>{if(e.pointerId===drag.id)this.finish(false);};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',end);document.addEventListener('pointercancel',cancel);
    drag.cleanup=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',cancel);if(this.divider.hasPointerCapture(drag.id))this.divider.releasePointerCapture(drag.id);};
  }
  async finish(commit){
    const drag=this.drag;if(!drag)return;drag.cleanup();this.drag=null;$('workspace').classList.remove('resizing-study-split');
    if(!commit||drag.value===drag.initial){this.paintRatio(this.settings.studyRatio||.53);document.dispatchEvent(new Event('reader-interaction-finished'));return;}
    this.saving=true;
    try{await this.study.setSettings({studyRatio:drag.value});}catch(error){this.paintRatio(this.settings.studyRatio||.53);throw error;}
    finally{this.saving=false;document.dispatchEvent(new Event('reader-interaction-finished'));}
  }
}
