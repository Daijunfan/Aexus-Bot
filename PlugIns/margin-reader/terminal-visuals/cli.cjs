'use strict';
const {createTerminalVisuals}=require('./index.cjs');
async function renderMapSnapshot({request,setId,columns=120,rows=36,selectedId,zoom}={}){
  if(typeof request!=='function')throw new TypeError('request(method, params) is required.');
  const study=await request('study.get',{setId});
  const geometry=await request('study.map.geometry',{setId});
  const visual=await createTerminalVisuals(),scene=visual.prepare({study,geometry});
  let state=visual.reduce(scene,visual.initialState({selectedId,zoom:zoom??1}),{type:'fit'},{columns,rows}).state;
  if(zoom!==undefined)state=visual.reduce(scene,state,{type:'zoom',zoom},{columns,rows}).state;
  let effects=[];
  if(selectedId)({state,effects}=visual.reduce(scene,state,{type:'select',cardId:selectedId},{columns,rows}));
  const frame=visual.render(scene,state,{columns,rows,color:'none'});
  return {text:visual.toPlainText(frame),revision:scene.revision,state,stats:frame.stats,warnings:[...frame.warnings,...effects]};
}
module.exports={renderMapSnapshot};
