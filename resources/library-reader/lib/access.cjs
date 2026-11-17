'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {assert}=require('./safety.cjs');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),copy=value=>structuredClone(value);
const denied=()=>assert(false,'RESOURCE_ACCESS_DENIED','此内容未授权相应的阅读、修改或新增权限；请联系用户或 Secretary。');
exports.createAccessStore=base=>{
 const contexts=new AsyncLocalStorage();
 const rights=(scope,id)=>scope.grants.find(g=>g.resourceId===id)||{read:false,write:false,create:false};
 function projection(state,context){
  const value={schemaVersion:1,revision:state.revision,documents:{},studySets:{},uploads:{},trash:{},settings:{...state.settings,lastDocument:null,openDocuments:[],activeStudySet:null,currentFolder:'.'}};
  for(const [id,doc]of Object.entries(state.documents))if(rights(context.scope,'document:'+id).read||context.created.has('document:'+id))value.documents[id]=copy(doc);
  for(const [id,set]of Object.entries(state.studySets))if(rights(context.scope,'study:'+id).read||context.created.has('study:'+id)){
   value.studySets[id]=copy(set);
   for(const docId of set.documentIds||[]){const doc=state.documents[docId];if(doc&&!value.documents[docId])value.documents[docId]={id:doc.id,title:doc.title,format:doc.format,kind:doc.kind,path:'',toc:[],bookmarks:[],position:null,revision:doc.revision};}
  }
  value.uploads=Object.fromEntries(Object.entries(state.uploads).filter(([id])=>context.uploads.has(id)));
  return value;
 }
 function appendOnly(before,after,collection){
  const a={...before},b={...after};for(const key of ['revision','updatedAt','history',collection]){delete a[key];delete b[key];}
  return equal(a,b)&&(before[collection]||[]).every(item=>(after[collection]||[]).some(next=>next.id===item.id&&equal(item,next)));
 }
 async function transaction(callback){
  const context=contexts.getStore();if(!context)return base.transaction(callback);
  return base.transaction(async(global,undo)=>{
   const before=projection(global,context),next=copy(before),result=await callback(next,undo);
   for(const [collection,prefix]of [['documents','document:'],['studySets','study:']])for(const id of new Set([...Object.keys(before[collection]),...Object.keys(next[collection])])){
    const a=before[collection][id],b=next[collection][id];if(equal(a,b))continue;
    if(!b||b.trashed&&!a?.trashed||b.deletedAt&&!a?.deletedAt)denied();
    const access=rights(context.scope,prefix+id);
    if(!a){
     if(Object.hasOwn(global[collection],id)||!rights(context.scope,'@root').create)denied();context.created.add(prefix+id);
    }else if(!access.write&&!context.created.has(prefix+id)){
     const cache=collection==='documents'&&context.method==='document.open'&&access.read;
     const added=access.create&&(collection==='studySets'?appendOnly(a,b,'cards'):appendOnly(a,b,'bookmarks')||appendOnly(a,b,'toc'));
     if(!cache&&!added)denied();
    }
    global[collection][id]=b;
   }
   for(const [id,upload]of Object.entries(next.uploads)){if(!Object.hasOwn(before.uploads,id))context.uploads.add(id);upload.accessOwner=context.scope.employeeId;global.uploads[id]=upload;}
   for(const id of Object.keys(before.uploads))if(!Object.hasOwn(next.uploads,id))delete global.uploads[id];
   return result;
  });
 }
 const store={...base,load:async()=>{const state=await base.load(),context=contexts.getStore();return context?projection(state,context):state;},transaction};
 async function run(scope,method,params,callback){
  const state=await base.load(),created=new Set(),uploads=new Set();
  if(['fs.list','fs.tree'].includes(method)){const documents=Object.values(state.documents).filter(d=>rights(scope,'document:'+d.id).read&&!d.trashed);return {result:{path:params.path||'.',entries:documents.map(d=>({name:d.path.split('/').at(-1),path:d.path,directory:false,documentId:d.id}))},createdResources:[]};}
  if(method.startsWith('study.')&&!params.setId&&!['study.list','study.library.get','study.create'].includes(method))denied();
  if(/history|versions?|backup|export|restore|xmind/.test(method))denied();
  const root=rights(scope,'@root').create,docId=params.documentId||(/^document\.|^toc\.|^bookmark\.|^reader\.(position|ink|annotation|reading|outline)/.test(method)?params.id:null);
  if(docId&&!rights(scope,'document:'+docId).read)denied();
  if(params.path){
   const doc=Object.values(state.documents).find(d=>d.path===params.path);
   if(['document.open','document.preview','fs.read','fs.write'].includes(method)){
    if(doc?!(method==='fs.write'?rights(scope,'document:'+doc.id).write:rights(scope,'document:'+doc.id).read):true)denied();
   }else if(!method.startsWith('import.'))denied();
  }
  if(method==='document.open'&&params.refresh&&Object.values(state.documents).some(d=>d.path===params.path&&!rights(scope,'document:'+d.id).read))denied();
  if(params.setId&&!rights(scope,'study:'+params.setId).read)denied();
  if(params.documentIds?.some(id=>!rights(scope,'document:'+id).read))denied();
  if(method.startsWith('import.')||method==='web.import'||method==='study.create'){if(!root)denied();}
  if(method.startsWith('import.')&&params.uploadId){const upload=state.uploads[params.uploadId];if(!upload||upload.accessOwner!==scope.employeeId)denied();uploads.add(params.uploadId);}
  const forbidden=/^(library\.(backup|index)|settings\.|appearance\.|fs\.(mkdir|move|copy|trash|restore|batch)|study\.(folder\.|library\.move|backup\.|.*(export|import))|document\.(export|virtual|split)|pdf\.compose)/;
  if(forbidden.test(method)&&!['settings.get'].includes(method))denied();
  if(method==='library.search')denied();
  if(!/^(document|toc|bookmark|reader|study|import|web|fs)\./.test(method)&&!['system.info','library.search'].includes(method))denied();
  const context={scope,method,created,uploads};
  const result=await contexts.run(context,callback);
  return {result,createdResources:[...created].map(id=>({id,parentId:'@root'}))};
 }
 async function resources(){const state=await base.load();return [{id:'@root',title:'新增文档或学习集',kind:'root',capabilities:['create']},...Object.values(state.documents).filter(d=>!d.trashed).map(d=>({id:'document:'+d.id,title:d.title,kind:'document',active:state.settings.lastDocument===d.id,nativeId:d.id,parentId:'@root'})),...Object.values(state.studySets).filter(s=>!s.deletedAt).map(s=>({id:'study:'+s.id,title:s.title,kind:'study',active:state.settings.activeStudySet===s.id,nativeId:s.id,parentId:'@root'}))];}
 return {store,run,resources};
};
