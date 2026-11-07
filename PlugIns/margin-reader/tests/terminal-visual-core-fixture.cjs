'use strict';
// Creates only synthetic objects through public Core methods in caller's test workspace.
async function createCoreScene(request){
  let study=await request('study.create',{title:'MarginReader 研究'});
  const ids={};
  async function note(key,title,parent){
    study=await request('study.note.create',{setId:study.id,expectedRevision:study.revision,title,...(parent?{parentId:ids[parent]}:{})});
    ids[key]=study.cards.find(c=>c.title===title).id;
  }
  await note('root','MarginReader');
  await note('read','阅读','root');await note('map','脑图','root');await note('review','复习','root');
  await note('source','来源定位','read');await note('excerpt','摘录原图','read');
  await note('spatial','空间导航','map');await note('relations','知识关系','map');
  await note('recall','主动回忆','review');
  study=await request('study.link.add',{setId:study.id,expectedRevision:study.revision,from:ids.excerpt,to:ids.relations,label:'证据支持'});
  study=await request('study.link.add',{setId:study.id,expectedRevision:study.revision,from:ids.spatial,to:ids.recall,label:'检索促进回忆'});
  study=await request('study.get',{setId:study.id});
  const geometry=await request('study.map.geometry',{setId:study.id});
  return {study,geometry,ids};
}
module.exports={createCoreScene};
