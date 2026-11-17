'use strict';
function safe(value){return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'');}
function readable(reply){
 if(reply.error)return 'Error ['+reply.error.data?.code+']: '+safe(reply.error.message)+'\n'+(reply.error.data?.details?JSON.stringify(reply.error.data.details,null,2)+'\n':'');
 const result=reply.result;
 if(typeof result?.text==='string')return safe(result.text)+'\n';
 const rows=result?.cards||result?.nodes||result?.entries||result?.toc||result?.outline;
 if(Array.isArray(rows)){
  const lines=[],max=200;let count=0;
  const byId=new Map(rows.filter(x=>x&&x.id).map(x=>[x.id,x]));
  function depth(row){let n=0,p=row.parentId,seen=new Set([row.id]);while(p&&byId.has(p)&&!seen.has(p)){seen.add(p);n++;p=byId.get(p).parentId;}return Math.min(n,20);}
  function visit(items,level=0){for(const row of items){count++;if(count<=max)lines.push('  '.repeat(Math.min(level+depth(row),20))+safe(row.name||row.title||row.text||row.id||JSON.stringify(row))+(row.id?' ['+safe(row.id)+']':''));if(Array.isArray(row.children))visit(row.children,level+1);}}
  visit(rows);
  if(count>max)lines.push('[display clipped: '+max+' of '+count+' rows; use --output json for full returned data]');
  if(result.truncated||result.hasMore)lines.push('[API result truncated/paginated; nextOffset='+JSON.stringify(result.nextOffset??null)+']');
  if(result.revision!==undefined)lines.push('revision: '+result.revision);
  return lines.join('\n')+'\n';
 }
 return JSON.stringify(result,null,2)+'\n';
}
function render(reply,options={}){
 if(options.text&&!reply.error&&typeof reply.result?.text==='string')return reply.result.text+'\n';
 const mode=options.output||'json';
 if(mode==='text')return readable(reply);
 return JSON.stringify(reply,null,mode==='pretty'?2:undefined)+'\n';
}
module.exports={render,readable,safe};
