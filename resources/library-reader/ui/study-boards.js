import { $, escape, icon, field, showDialog, run, toast } from './dom.js';
import { api } from './transport.js';
const words=value=>String(value||'').split(/[,，]/).map(v=>v.trim()).filter(Boolean);
const flags=[['','全部'],['yes','是'],['no','否']];
const groups=[['','不分组'],['study','学习集'],['color','颜色'],['tag','标签'],['keyword','标题词条'],['document','来源文档'],['chapter','章节'],['created','创建日期'],['updated','修改日期'],['kind','摘录 / 笔记'],['inMap','脑图状态']];
const keyOf=card=>card.ownerSetId+'/'+card.id;
export class StudyBoards {
  constructor(study){
    this.study=study;this.serial=0;this.session=0;this.selected=new Map();
    const button=document.createElement('button');button.id='workspace-card-box';button.className='workspace-card-box';button.innerHTML=icon('list')+'<span>数据库</span>';
    button.title='当前文库的全部摘录与笔记；筛选、分组和批量编辑';
    $('study-set-list').before(button);button.onclick=run(()=>this.open(null,true));
    const root=document.createElement('section');root.id='study-database';root.hidden=true;root.setAttribute('aria-label','卡片数据库');$('workspace').append(root);this.root=root;
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.active&&!$('dialog').open){e.preventDefault();if(this.saving)return;if(this.editor)this.cancelEdit();else this.close();}});
  }
  get active(){return !this.root.hidden;}
  get dirty(){return Boolean(this.editor||this.saving);}
  guard(){if(this.dirty)throw Error('请先保存或取消数据库中正在编辑的卡片。');}
  close(){
    this.guard();clearTimeout(this.searchTimer);this.serial++;this.session++;this.root.hidden=true;$('workspace').classList.remove('database-open');
    for(const node of this.obscured||[])node.inert=false;this.obscured=[];
    $('workspace-card-box').setAttribute('aria-pressed','false');this.study.map.window.schedule();
  }
  control(name){return this.root.querySelector(`[name="${name}"]`);}
  values(){return Object.fromEntries(new FormData($('board-form')));}
  criteria(){
    const v=this.values(),filter={};if(v.query.trim())filter.query=v.query.trim();if(v.titleKeyword.trim())filter.titleKeyword=v.titleKeyword.trim();
    for(const k of ['tags','colors','documentIds'])if(words(v[k]).length)filter[k]=words(v[k]);
    if(filter.tags)filter.tagMode=v.tagMode;if(v.kind)filter.kind=v.kind;
    for(const k of ['inMap','favorite','reviewEnabled','hasImage'])if(v[k])filter[k]=v[k]==='yes';
    for(const k of ['createdAfter','createdBefore'])if(v[k])filter[k]=v[k];
    let combined=filter;
    if(v.compound.trim()){
      let extra;try{extra=JSON.parse(v.compound);}catch{throw Error('组合筛选需要合法 JSON 对象。');}
      combined={all:[filter,extra]};
    }
    return {filter:combined,groupBy:[v.group1,v.group2].filter(Boolean),sort:v.sort,direction:v.direction};
  }
  async open(board,global=false,initialFilter={}){
    if(this.study.busy)return;const activation=this.study.activationEpoch;
    await this.study.beforeNavigate();if(this.study.busy||activation!==this.study.activationEpoch)return;
    const session=++this.session,ownerId=this.study.current?.id||null;
    const [owner,listing]=await Promise.all([ownerId?api('study.get',{setId:ownerId}):null,api('study.list')]);
    if(this.study.busy||activation!==this.study.activationEpoch||session!==this.session||(this.study.current?.id||null)!==ownerId)return;
    if(board?.id)board=owner?.boards?.find(b=>b.id===board.id)||null;
    this.owner=owner;this.board=board;this.offset=0;this.nextOffset=null;this.selected.clear();this.last=null;
    const filter=board?.filter||initialFilter,compound=Boolean(filter.any||filter.all||filter.not),f=compound?{}:filter;
    const scope=global||!owner?'workspace':'current';
    this.root.innerHTML='<header class="database-heading"><div><span class="study-eyebrow">摘录与笔记</span><h1>数据库</h1><p>原文、批注和标签，一张表整理。</p></div><button id="board-close" type="button">返回工作区</button></header>'+
      '<div class="database-main"><form id="board-form"><div class="database-query">'+field('query','搜索卡片',f.query||'',{type:'search'})+
      field('scope','范围',scope,{choices:[...(owner?[['current','当前学习集 · '+owner.title]]:[]),['workspace','当前文库全部学习集'],...listing.sets.filter(s=>s.id!==owner?.id).map(s=>[s.id,s.title])]})+
      (owner?field('boardId','保存的视图',board?.id||'',{choices:[['','全部卡片 / 自定义'],...(owner.boards||[]).map(b=>[b.id,b.title])]}):'')+
      '<button id="board-save" type="button">保存视图</button></div>'+
      '<div class="database-view-options">'+field('group1','分组',board?.groupBy?.[0]||'',{choices:groups})+field('group2','再分组',board?.groupBy?.[1]||'',{choices:groups})+
      field('sort','排序',board?.sort||'outline',{choices:[['outline','脑图顺序'],['title','标题'],['source','原文位置'],['created','创建时间'],['updated','修改时间'],['color','颜色']]})+
      field('direction','方向',board?.direction||'asc',{choices:[['asc','正序'],['desc','倒序']]})+
      '<details id="board-filters"><summary>筛选条件</summary><div class="board-filter-grid">'+
      field('titleKeyword','精确标题词条',f.titleKeyword||'',{help:'按分号别名完整匹配，不匹配正文。'})+field('tags','标签（逗号分隔）',(f.tags||[]).join(', '))+
      field('tagMode','标签组合',f.tagMode||'all',{choices:[['all','全部满足（交集）'],['any','任一满足（并集）']]})+
      field('colors','颜色（名称或 #RRGGBB）',(f.colors||[]).join(', '))+
      field('kind','类型',f.kind||'',{choices:[['','全部'],['excerpt','文档摘录'],['note','独立笔记']]})+
      ['inMap','favorite','reviewEnabled','hasImage'].map((k,i)=>field(k,['已在脑图','收藏','已加入复习','包含图片'][i],f[k]===undefined?'':f[k]?'yes':'no',{choices:flags})).join('')+
      field('createdAfter','创建时间起点',f.createdAfter||'')+field('createdBefore','创建时间终点',f.createdBefore||'')+
      field('documentIds','来源文档 ID',(f.documentIds||[]).join(', '))+
      '<label class="dialog-field"><span>组合筛选（AND / OR / NOT）</span><textarea name="compound" rows="2" placeholder=\'{"any":[{"tags":["重点"]},{"favorite":true}]}\'>'+escape(compound?JSON.stringify(filter):'')+'</textarea></label></div><button id="board-search" type="submit">应用筛选</button><button id="board-reset" type="button">清除筛选</button></details></div></form>'+
      '<div class="database-selection"><span id="board-selected" role="status"></span><button id="board-select-page" type="button">选择本页</button><button id="board-select-all" type="button">选择全部结果</button><button id="board-clear" type="button">清除选择</button><button id="board-batch" type="button">批量编辑</button><details class="database-saved-actions"><summary>视图操作</summary><button id="board-map" type="button">从已保存视图生成脑图</button><button id="board-remove" type="button">删除视图定义</button></details></div>'+
      '<div id="board-results" aria-label="数据库表格"></div><footer class="database-footer"><p id="board-status" role="status" aria-live="polite"></p><div><button id="board-prev" type="button">上一页</button><button id="board-next" type="button">下一页</button></div></footer><aside id="board-editor" aria-label="编辑数据库卡片" hidden></aside></div>';
    this.obscured=[$('workspace').querySelector('.main-pane'),$('study-pane'),$('outline-pane'),$('study-split-divider')];
    for(const node of this.obscured)node.inert=true;
    this.root.hidden=false;$('workspace').classList.add('database-open');$('workspace-card-box').setAttribute('aria-pressed','true');
    $('board-close').onclick=run(()=>this.close());
    $('board-form').onsubmit=e=>{e.preventDefault();this.control('query').blur();run(()=>this.load(true))();};
    this.control('query').oninput=()=>{clearTimeout(this.searchTimer);this.searchTimer=setTimeout(run(()=>this.load(true)),180);};
    for(const name of ['scope','group1','group2','sort','direction'])this.control(name).onchange=run(()=>{this.syncKeyword();return this.load(true);});
    if(owner)this.control('boardId').onchange=run(()=>this.open(this.owner.boards.find(b=>b.id===this.control('boardId').value)));
    $('board-reset').onclick=run(()=>{for(const name of ['query','titleKeyword','tags','colors','kind','inMap','favorite','reviewEnabled','hasImage','createdAfter','createdBefore','documentIds','compound'])this.control(name).value='';return this.load(true);});
    $('board-save').onclick=run(()=>this.saveView());
    $('board-prev').onclick=run(()=>{this.offset=Math.max(0,this.offset-100);return this.load();});
    $('board-next').onclick=run(()=>{if(this.nextOffset!==null)this.offset=this.nextOffset;return this.load();});
    $('board-clear').onclick=()=>{this.selected.clear();this.selectedStatus();};
    $('board-select-page').onclick=()=>{const cards=this.last?.cards||[],remove=cards.length&&cards.every(card=>this.selected.has(keyOf(card)));for(const card of cards){if(remove)this.selected.delete(keyOf(card));else this.selected.set(keyOf(card),card);}this.selectedStatus();};
    $('board-select-all').onclick=run(()=>this.selectAll());
    $('board-batch').onclick=()=>this.batch([...this.selected.values()]);
    $('board-map').onclick=run(async()=>{await this.study.change('study.board.materialize',{boardId:this.board.id},this.owner.revision);this.close();});
    $('board-remove').onclick=()=>this.removeView();
    this.root.addEventListener('click',this.onClick||=run(e=>this.click(e)));
    this.syncKeyword();await this.load();this.control('query').focus({preventScroll:true});
  }
  syncKeyword(){
    const disabled=this.control('scope').value==='current'&&this.owner?.linkSettings?.titleLinks===false;
    for(const name of ['group1','group2']){const control=this.control(name);control.querySelector('option[value=keyword]').disabled=disabled;if(disabled&&control.value==='keyword')control.value='';}
  }
  selectedStatus(){
    $('board-selected').textContent=`已选择 ${this.selected.size} 张卡片`;$('board-batch').disabled=!this.selected.size;
    const page=this.last?.cards||[],all=page.length>0&&page.every(card=>this.selected.has(keyOf(card)));
    $('board-select-page').textContent=all?'取消本页选择':'选择本页';$('board-select-page').disabled=!page.length;
    for(const input of this.root.querySelectorAll('[data-board-check]'))input.checked=this.selected.has(input.dataset.boardCheck);
  }
  async load(reset=false){
    this.guard();return this.loadResults(reset);
  }
  async loadResults(reset=false){
    if(reset){this.offset=0;this.selected.clear();}
    const ticket=++this.serial,args=this.criteria(),scope=this.control('scope').value,local=scope==='current'&&!args.groupBy.includes('study');
    $('board-results').setAttribute('aria-busy','true');
    try{
      const data=local?await api('study.board.query',{setId:this.owner.id,...args,offset:this.offset,limit:100}):await api('study.workspace.query',{...args,...(scope==='workspace'?{}:{setIds:[scope==='current'?this.owner.id:scope]}),offset:this.offset,limit:100});
      if(ticket!==this.serial||!this.active)return;
      data.cards=data.cards.map(c=>({...c,ownerSetId:c.ownerSetId||this.owner?.id,ownerSetTitle:c.ownerSetTitle||this.owner?.title,ownerRevision:c.ownerRevision||data.revision}));
      this.last=data;this.nextOffset=data.nextOffset;
      $('board-status').textContent=`${data.total} 张卡片 · 当前 ${data.cards.length?this.offset+1:0}–${this.offset+data.cards.length}`;
      $('board-prev').disabled=this.offset===0;$('board-next').disabled=data.nextOffset===null;
      const current=scope==='current'&&!args.groupBy.includes('study');
      $('board-save').disabled=!this.owner||!current;$('board-map').disabled=!this.board||!current;$('board-remove').disabled=!this.board||!current;
      const cards=new Map(data.cards.map(c=>[local?c.id:keyOf(c),c]));
      const render=(items,depth=0)=>items.map(item=>{
        if(typeof item==='string')return cards.has(item)?this.row(cards.get(item)):'';
        const children=render(item.children,depth+1);return children?`<tr class="board-group" data-group-depth="${depth}"><td colspan="8"><h3>${escape(item.key)} <small>${item.count} 张</small></h3></td></tr>${children}`:'';
      }).join('');
      const rows=args.groupBy.length?render(data.groups):data.cards.map(c=>this.row(c)).join('');
      $('board-results').innerHTML=rows?'<table class="database-table"><thead><tr><th scope="col">选择</th><th scope="col"><button type="button" data-board-sort="title">标题 / 正文</button></th><th scope="col">来源 / 学习集</th><th scope="col">标签</th><th scope="col">批注</th><th scope="col">收藏</th><th scope="col">脑图</th><th scope="col"><button type="button" data-board-sort="updated">修改时间</button></th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="database-empty"><h2>没有匹配卡片</h2><p>调整筛选条件，或从文档选文开始摘录。</p></div>';
      for(const header of this.root.querySelectorAll('[data-board-sort]'))header.closest('th').setAttribute('aria-sort',args.sort===header.dataset.boardSort?(args.direction==='desc'?'descending':'ascending'):'none');
      this.selectedStatus();
    }finally{if(ticket===this.serial)$('board-results').setAttribute('aria-busy','false');}
  }
  row(c){
    const key=escape(keyOf(c)),color=(c.color||'').startsWith('#')?c.color:this.study.hex[c.color]||'#999';
    const linked=c.referenceAvailable&&c.reference?.live!==false;
    const titleAction=linked?`data-board-card="${key}" title="引用标题跟随原卡片，点击定位来源"`:`data-board-field="title" data-board-key="${key}" title="编辑标题"`;
    const source=c.source?.locator,label=source?(source.page?`第 ${source.page} 页`:`第 ${source.section+1} 节`):c.reference?'引用卡片':'独立笔记';
    return `<tr class="board-card" data-board-owner="${c.ownerSetId}"><td><input type="checkbox" data-board-check="${key}" aria-label="选择 ${escape(c.title)}"></td><td><div class="database-title-row"><button type="button" class="database-color" data-board-field="color" data-board-key="${key}" style="background:${escape(color)}" aria-label="编辑颜色：${escape(c.title)}" title="编辑颜色"></button><button type="button" class="database-title" ${titleAction}><strong>${escape(c.title)}</strong></button></div><p class="database-body">${escape((c.editedText??c.text??'').slice(0,240))}</p><button type="button" class="database-edit" data-board-edit="${key}">编辑内容</button></td><td><button type="button" data-board-card="${key}" title="打开卡片并定位原文">${escape(c.sourcePath||label)}</button><small>${escape(c.ownerSetTitle)} · ${escape(label)}</small></td><td><button type="button" data-board-field="tags" data-board-key="${key}" aria-label="编辑标签：${escape(c.title)}">${c.tags?.length?c.tags.map(t=>'<span class="database-tag">'+escape(t)+'</span>').join(''):'＋ 标签'}</button></td><td><button type="button" class="database-note" data-board-field="note" data-board-key="${key}" aria-label="编辑批注：${escape(c.title)}">${escape(c.note||'＋ 批注')}</button></td><td><button type="button" data-board-favorite="${key}" aria-pressed="${Boolean(c.favorite)}" aria-label="收藏：${escape(c.title)}">${c.favorite?'★':'☆'}</button></td><td><button type="button" data-board-map="${key}" aria-pressed="${c.inMap!==false}">${c.inMap===false?'仅标注':'已入图'}</button></td><td><time datetime="${escape(c.updatedAt||'')}">${escape((c.updatedAt||'').slice(0,10))}</time></td></tr>`;
  }
  click(e){
    const input=e.target.closest('[data-board-check]');
    if(input){const card=this.last.cards.find(c=>keyOf(c)===input.dataset.boardCheck);input.checked?this.selected.set(keyOf(card),card):this.selected.delete(keyOf(card));this.selectedStatus();return;}
    const button=e.target.closest('button');if(!button)return;
    const key=button.dataset.boardKey||button.dataset.boardEdit||button.dataset.boardCard||button.dataset.boardFavorite||button.dataset.boardMap;
    const card=key&&this.last?.cards.find(c=>keyOf(c)===key);
    if(button.dataset.boardField)this.edit(card,button.dataset.boardField);
    else if(button.dataset.boardEdit)this.edit(card);
    else if(button.dataset.boardCard)run(()=>this.openCard(card))();
    else if(button.dataset.boardFavorite)run(()=>this.patch(card,{favorite:!card.favorite}))();
    else if(button.dataset.boardMap)run(()=>this.patch(card,{inMap:card.inMap===false}))();
    else if(button.dataset.boardSort){this.control('direction').value=this.control('sort').value===button.dataset.boardSort&&this.control('direction').value==='asc'?'desc':'asc';this.control('sort').value=button.dataset.boardSort;run(()=>this.load(true))();}
  }
  async selectAll(){
    this.guard();const args=this.criteria(),scope=this.control('scope').value,selected=new Map(),session=this.session,ticket=this.serial;let offset=0;
    do{
      const data=await api('study.workspace.query',{...args,...(scope==='workspace'?{}:{setIds:[scope==='current'?this.owner.id:scope]}),offset,limit:500});
      if(session!==this.session||ticket!==this.serial)return;
      if(selected.size+data.cards.length>10000)throw Error('单次批量操作最多 10000 张，请缩小筛选范围。');
      for(const card of data.cards)selected.set(keyOf(card),card);offset=data.nextOffset;
    }while(offset!==null);
    this.selected=selected;this.selectedStatus();
  }
  edit(card,fieldName){
    this.guard();this.editor={card,fieldName};
    const title=fieldName==='tags'?'编辑标签':fieldName==='note'?'编辑批注':fieldName==='title'?'编辑标题':fieldName==='color'?'编辑颜色':'编辑卡片';
    const textField=(name,label,value)=>'<label class="dialog-field"><span>'+label+'</span><textarea name="'+name+'" rows="6" maxlength="20000">'+escape(value||'')+'</textarea></label>';
    const linked=card.referenceAvailable&&card.reference?.live!==false;
    $('board-editor').innerHTML='<form id="board-edit-form"><header><h2>'+title+'</h2><p>'+escape(card.title)+'</p></header>'+
      ((!fieldName||fieldName==='title')&&!linked?field('editTitle','标题',card.title,{required:true}):'')+
      ((!fieldName||fieldName==='color')?field('editColor','颜色（名称或 #RRGGBB）',card.color||'yellow',{required:true}):'')+
      ((!fieldName||fieldName==='tags')?field('editTags','标签（逗号分隔）',(card.tags||[]).join(', ')):'')+
      ((!fieldName||fieldName==='note')?textField('editNote','批注',card.note):'')+
      (!fieldName&&!linked?textField('editText',card.source?'显示正文（原文与截图保留）':'正文',card.editedText??card.text):'')+
      (linked?'<p class="dialog-note">引用标题与正文跟随原卡片；标签和批注独立保存。</p>':'')+
      '<p id="board-edit-error" class="dialog-error" role="alert" hidden></p><footer><button id="board-edit-cancel" type="button">取消</button><button id="board-edit-save" type="submit" class="primary">保存</button></footer></form>';
    $('board-editor').hidden=false;$('board-edit-cancel').onclick=()=>this.cancelEdit();
    $('board-edit-form').onsubmit=e=>{e.preventDefault();run(()=>this.saveEditor())();};
    $('board-editor').querySelector('input,textarea,button').focus();
  }
  cancelEdit(){if(this.saving)return;const stale=this.editor?.stale;this.editor=null;$('board-editor').hidden=true;if(stale)run(async()=>{await this.afterMutation();toast('已刷新卡片，保留其他位置的修改。');})();}
  async saveEditor(){
    if(!this.editor||this.saving)return;
    const editor=this.editor,{card}=editor;let patch;
    if(!editor.committed){
      const v=Object.fromEntries(new FormData($('board-edit-form')));patch={};
      if(v.editTitle!==undefined)patch.title=v.editTitle;if(v.editColor!==undefined)patch.color=v.editColor.trim();if(v.editTags!==undefined)patch.tags=words(v.editTags);if(v.editNote!==undefined)patch.note=v.editNote;
      if(v.editText!==undefined)patch[card.source||card.reference?'editedText':'text']=v.editText;
      if(!Object.keys(patch).length){this.cancelEdit();return;}
    }
    this.saving=true;$('board-edit-save').disabled=true;$('board-edit-error').hidden=true;
    try{
      if(!editor.committed){
        await api('study.card.update',{setId:card.ownerSetId,expectedRevision:card.ownerRevision,cardId:card.id,...patch});
        editor.committed=true;
        for(const input of $('board-edit-form').querySelectorAll('input,textarea'))input.disabled=true;
        $('board-edit-save').textContent='重新刷新';$('board-edit-cancel').textContent='关闭';
      }
      await this.afterMutation();this.editor=null;$('board-editor').hidden=true;toast('卡片已保存');
    }catch(error){if(error.code==='CONFLICT'&&!editor.committed)editor.stale=true;$('board-edit-error').textContent=editor.committed?'卡片已保存，但列表刷新失败：'+error.message+' 请重新刷新，或关闭编辑器后重新打开数据库。':error.code==='CONFLICT'?'卡片所在学习集已变化；本次未覆盖，取消草稿后将刷新最新数据。':error.message;$('board-edit-error').hidden=false;throw error;}
    finally{this.saving=false;$('board-edit-save').disabled=false;}
  }
  async afterMutation(){
    await this.study.refresh();if(this.owner)this.owner=await api('study.get',{setId:this.owner.id});
    this.selected.clear();if(this.active)await this.loadResults();
  }
  async patch(card,patch){
    this.guard();await api('study.workspace.batch',{targets:[{setId:card.ownerSetId,cardId:card.id}],expectedRevisions:{[card.ownerSetId]:card.ownerRevision},patch});await this.afterMutation();
  }
  saveView(){
    this.guard();const args=this.criteria(),owner=this.owner,board=this.board;
    showDialog({title:board?'保存视图':'新建数据库视图',html:field('title','视图名称',board?.title||'新视图',{required:true}),submit:'保存视图',onSubmit:async v=>{
      const set=await api('study.board.save',{setId:owner.id,expectedRevision:owner.revision,...(board?{boardId:board.id}:{}),title:v.title,...args});
      this.owner=set;this.board=set.boards.find(b=>board?b.id===board.id:!owner.boards.some(saved=>saved.id===b.id));
      this.control('boardId').innerHTML='<option value="">全部卡片 / 自定义</option>'+set.boards.map(b=>'<option value="'+b.id+'">'+escape(b.title)+'</option>').join('');this.control('boardId').value=this.board.id;
      await this.study.refresh();await this.load();toast('视图已保存');
    }});
  }
  removeView(){
    const owner=this.owner,board=this.board;this.guard();
    showDialog({title:'删除数据库视图',html:'<p>只删除「'+escape(board.title)+'」的筛选定义，卡片与原文保留；可撤销。</p>',submit:'删除视图',onSubmit:async()=>{
      await api('study.board.remove',{setId:owner.id,expectedRevision:owner.revision,boardId:board.id});await this.study.refresh();this.close();toast('视图定义已移除，卡片保留；可撤销。');
    }});
  }
  async openCard(card,edit=false){
    if(edit){this.edit(card);return;}
    this.close();if(this.study.current?.id!==card.ownerSetId)await this.study.home(card.ownerSetId);
    const fresh=this.study.current.cards.find(c=>c.id===card.id);if(!fresh)throw Error('卡片已被移除，请重新查询。');
    if(fresh.source||fresh.anchor||fresh.reference)await this.study.activateCard(fresh,'map',true);else this.study.map.select(fresh.id);
  }
  batch(cards){
    this.guard();if(!cards.length)return;
    const revisions={};for(const c of cards){if(revisions[c.ownerSetId]&&revisions[c.ownerSetId]!==c.ownerRevision){toast('选中的结果来自不同版本，请重新筛选。',true);return;}revisions[c.ownerSetId]=c.ownerRevision;}
    showDialog({title:`批量编辑 ${cards.length} 张卡片 · ${Object.keys(revisions).length} 个学习集`,html:field('color','颜色（留空保持）')+field('addTags','添加标签（逗号分隔）')+field('removeTags','移除标签（逗号分隔）')+
      field('favorite','收藏','',{choices:[['','保持'],['yes','收藏'],['no','取消收藏']]})+field('inMap','脑图','',{choices:[['','保持'],['yes','加入脑图'],['no','移出脑图并保留标注']]})+
      field('annotationVisible','原文标注','',{choices:[['','保持'],['yes','显示'],['no','取消标注并保留卡片']]})+
      '<p class="dialog-note">所有选中学习集一起检查版本。任何冲突会取消整次修改，不会只写入部分卡片。</p>',onSubmit:async v=>{
      const patch={};if(v.color.trim())patch.color=v.color.trim();for(const k of ['addTags','removeTags'])if(words(v[k]).length)patch[k]=words(v[k]);for(const k of ['favorite','inMap','annotationVisible'])if(v[k])patch[k]=v[k]==='yes';
      if(!Object.keys(patch).length)throw Error('至少修改一项。');
      await api('study.workspace.batch',{targets:cards.map(c=>({setId:c.ownerSetId,cardId:c.id})),expectedRevisions:revisions,patch});await this.afterMutation();toast(`已更新 ${cards.length} 张卡片。`);
    }});
  }
}
