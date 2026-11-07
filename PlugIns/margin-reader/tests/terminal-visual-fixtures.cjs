'use strict';
// Pure fixtures shared with B's real-PTY tests. No runtime, files or model calls.
function fixture(count=4){
  const cards=[],positions=[];
  for(let i=0;i<count;i++){
    cards.push({id:'c'+i,parentId:i?'c'+Math.floor((i-1)/3):null,title:'中文 '+i+' 👨‍👩‍👧‍👦 é 🇨🇳 长标题'.repeat(3),source:{documentId:'synthetic',locator:{page:1}}});
    positions.push({cardId:'c'+i,x:(i%100)*300-600,y:Math.floor(i/100)*120-240,width:240,height:96});
  }
  return {study:{id:'fixture',revision:7,cards,links:[]},geometry:{revision:7,positions,links:cards.filter(c=>c.parentId).map(c=>({from:c.parentId,to:c.id})),topics:{}}};
}
const actions=Object.freeze([{type:'select',cardId:'c0'},{type:'navigate',direction:'right'},{type:'pan',dx:5,dy:2},{type:'zoom',factor:1.25},{type:'resize'},{type:'center-selection'}]);
module.exports={fixture,actions};
