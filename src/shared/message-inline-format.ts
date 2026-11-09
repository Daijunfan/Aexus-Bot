import type {Plugin} from 'unified'
/** Local message formatting; code and raw HTML stay literal and are never evaluated. */
type Node={position?:{start:{offset?:number};end:{offset?:number}};type:string;value?:string;children?:Node[];data?:{hName:string;hProperties?:Record<string,string>}}
const visibleText=(node:Node|undefined):string=>node?.value??node?.children?.map(visibleText).join('')??''
export const remarkMessageInline:Plugin=()=> (tree,file)=>{
 const visit=(node:Node)=>{
  if(!node.children||['code','inlineCode','html','math','inlineMath'].includes(node.type))return
  node.children.forEach(visit)
  if(!['paragraph','heading','tableCell','strong','emphasis','delete'].includes(node.type))return
  const output:Node[]=[],buffer:Node[]=[];let marker:string|undefined
  const append=(value:Node)=>(marker?buffer:output).push(value)
  for(let index=0;index<node.children.length;index++){
   const child=node.children[index]
   if(child.type!=='text'){append(child);continue}
   const raw=String(file?.value??'').slice(child.position?.start.offset??0,child.position?.end.offset??0)
   if(raw.includes('\\|')||raw.includes('\\+')){append(child);continue}
   const value=child.value??'',pieces=value.split(/(\|\||\+\+)/);let offset=0
   for(const piece of pieces){
    if(!piece)continue
    const at=offset;offset+=piece.length
    if(piece==='||'||piece==='++'){
     const before=value[at-1]??visibleText(node.children[index-1]).at(-1),after=value[offset]??visibleText(node.children[index+1])[0],word=/[A-Za-z0-9_]/u
     // Preserve common technical prose such as C++ and a || b || c.
     if(!marker&&!word.test(before??'')&&after&&!/\s/u.test(after)){marker=piece;continue}
     if(marker===piece&&before&&!/\s/u.test(before)&&!word.test(after??'')){output.push({type:'messageInline',children:buffer.splice(0),data:{hName:piece==='++'?'u':'span',...(piece==='||'?{hProperties:{'data-message-spoiler':'true'}}:{})}});marker=undefined;continue}
    }
    append({type:'text',value:piece})
   }
  }
  if(marker)output.push({type:'text',value:marker},...buffer)
  node.children=output
 }
 visit(tree as Node)
}
