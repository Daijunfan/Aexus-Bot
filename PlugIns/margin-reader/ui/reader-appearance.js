import {$,field,showDialog,run} from './dom.js';
import {api} from './transport.js';
export class ReaderAppearance{
 constructor(study,settingsChanged){
  this.study=study;this.settingsChanged=settingsChanged;
  // The outline is part of the reader viewport, not a floating overlay.
  // Moving the existing nodes retains their event handlers and document state.
  this.readerViewport=$('reader-view').querySelector('.reader-viewport');
  this.readerViewport.append($('outline-divider'),$('outline-pane'));
  const sideTools=document.createElement('div');sideTools.id='outline-side-controls';sideTools.setAttribute('role','group');sideTools.setAttribute('aria-label','目录放置位置');
  sideTools.innerHTML='<button type="button" data-outline-place="left" title="目录放在文档左侧" aria-label="目录放在文档左侧">←</button><button type="button" data-outline-place="right" title="目录放在文档右侧" aria-label="目录放在文档右侧">→</button>';
  $('outline-pane').querySelector('.pane-heading')?.after(sideTools);
  for(const action of sideTools.querySelectorAll('[data-outline-place]'))action.onclick=run(()=>this.settingsChanged({outlineSide:action.dataset.outlinePlace}));
  const button=document.createElement('button');button.id='reader-appearance-open';button.textContent='阅读设置';button.title='亮度、颜色与沉浸阅读';$('theme').before(button);button.onclick=run(()=>this.dialog());
  window.addEventListener('resize',()=>this.apply(this.settings));document.addEventListener('study-view-mounted',()=>this.apply(this.settings));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('dialog').open&&this.settings?.readingMode==='immersive')run(()=>settingsChanged({readingMode:'normal'}))();});
 }
 async dialog(){
  const s=await api('settings.get');showDialog({title:'阅读设置',html:field('readingMode','阅读空间',s.readingMode||'normal',{choices:[['normal','标准'],['immersive','沉浸 · 隐藏文件侧栏']]})+field('brightness','文档亮度',s.brightness||1,{type:'number',min:.25,max:1.5})+field('pdfDarkMode','PDF 颜色',s.pdfDarkMode||'original',{choices:[['original','保持原图颜色'],['invert','反色阅读']]})+field('outlineSide','目录位置',s.outlineSide||'right',{choices:[['left','文档左侧'],['right','文档右侧']]})+field('theme','界面',s.theme,{choices:[['light','浅色'],['dark','深色'],['sepia','暖色']]}),onSubmit:v=>this.settingsChanged({...v,brightness:Number(v.brightness)}),afterOpen:()=>{$('dialog-fields').querySelector('[name=brightness]').step='any';}});
 }
 apply(settings){
  if(!settings)return;this.settings=settings;
  const workspace=$('workspace');workspace.style.gridTemplateColumns='';workspace.style.gridTemplateRows='';
  for(const el of [workspace.querySelector('.main-pane'),workspace.querySelector('.explorer'),$('explorer-divider'),$('outline-divider'),$('study-pane'),$('outline-pane')])if(el){el.style.gridColumn='';el.style.gridRow='';el.style.display='';}
  workspace.classList.toggle('reader-immersive',Boolean(this.study.getDocument()&&settings.readingMode==='immersive'));
  workspace.dataset.outlineSide=settings.outlineSide||'right';
  for(const action of document.querySelectorAll('[data-outline-place]'))action.setAttribute('aria-pressed',String(action.dataset.outlinePlace===workspace.dataset.outlineSide));
  const divider=$('outline-divider'),outline=$('outline-pane');
  if(settings.outlineSide==='left')this.readerViewport.prepend(outline,divider);
  else this.readerViewport.append(divider,outline);
 }
}
