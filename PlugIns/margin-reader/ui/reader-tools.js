import {$,escape,run} from './dom.js';
import {api} from './transport.js';
// Basic reader: document tabs only. Comparison/notebook dashboards are retired.
export class ReaderTools{
 constructor(options){Object.assign(this,options);this.serial=0;const bar=document.createElement('div');bar.id='document-tabs';bar.setAttribute('aria-label','已打开的文档');$('reader-view').prepend(bar);}
 async refresh(){
  const serial=++this.serial,current=this.getDocument(),settings=await api('settings.get');const docs=(await api('document.list',{ids:settings.openDocuments||[]})).documents.filter(Boolean);
  if(serial!==this.serial||this.getDocument()?.id!==current?.id)return;
  const tabs=$('document-tabs'),signature=JSON.stringify([current?.id,docs.map(d=>[d.id,d.title,d.path])]);
  if(tabs.dataset.signature===signature)return;
  const focused=tabs.contains(document.activeElement)?
    {id:document.activeElement.dataset.open||document.activeElement.dataset.close,
     kind:document.activeElement.dataset.open?'open':'close'}:null;
  const previous=new Map([...tabs.children].map(tab=>[tab.querySelector('[data-open]')?.dataset.open,tab]));
  const ordered=[];
  for(const d of docs){
    let tab=previous.get(d.id);
    if(!tab){
      tab=document.createElement('span');tab.className='document-tab';
      const open=document.createElement('button');open.dataset.open=d.id;
      const close=document.createElement('button');close.dataset.close=d.id;close.textContent='×';
      tab.append(open,close);
    }
    tab.classList.toggle('active',d.id===current?.id);
    tab.querySelector('[data-open]').textContent=d.title;
    tab.querySelector('[data-open]').title=d.path;
    tab.querySelector('[data-close]').setAttribute('aria-label','关闭文档标签：'+d.title);
    ordered.push(tab);
  }
  tabs.replaceChildren(...ordered);tabs.dataset.signature=signature;
  tabs.hidden=docs.length<2;
  if(focused)tabs.querySelector('[data-'+focused.kind+'="'+CSS.escape(focused.id)+'"]')?.focus({preventScroll:true});
  for(const b of tabs.querySelectorAll('[data-open]'))b.onclick=run(()=>this.openDocument(docs.find(d=>d.id===b.dataset.open).path));
  for(const b of tabs.querySelectorAll('[data-close]'))b.onclick=run(async()=>{const remaining=await api('reader.tabs.close',{id:b.dataset.close});if(this.getDocument()?.id===b.dataset.close){if(remaining.length){const d=await api('document.get',{id:remaining.at(-1)});await this.openDocument(d.path);}else await this.closeDocument();}await this.refresh();});
 }
}
