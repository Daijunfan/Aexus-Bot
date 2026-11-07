'use strict';
// Diagnostic only: compares native SVG text, SVG text paths and Canvas shaping
// with explicit installed font names. It does not register or install fonts.
const fs=require('node:fs/promises'),path=require('node:path');
const {createCanvas,loadImage,convertSVGTextToPath,GlobalFonts}=require('@napi-rs/canvas');
async function main(){
 const directory=path.resolve(process.argv[2]||'artifacts/visual-polish/font-probe');await fs.mkdir(directory,{recursive:true});
 const fonts=['system-ui','Arial Unicode MS','Hiragino Sans GB','Apple Color Emoji','Helvetica, Hiragino Sans GB, Apple Color Emoji'];
 const sample='中文 Cafe\u0301 nai\u0308ve 👨‍👩‍👧‍👦 🇨🇳';
 const canvas=createCanvas(1500,fonts.length*140),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 const labelFamily=GlobalFonts.has('Helvetica')?'Helvetica':'DejaVu Sans',rows=[];
 for(const [index,family]of fonts.entries()){
  const y=index*140,svg=`<svg xmlns="http://www.w3.org/2000/svg" width="490" height="100"><text x="12" y="35" font-size="24" font-family="${family}"><tspan x="12" dy="0"><tspan>${sample}</tspan></tspan><tspan x="12" dy="36"><tspan>Second line: 第二行</tspan></tspan></text></svg>`;
  ctx.fillStyle='#20252d';ctx.font=`16px "${labelFamily}"`;ctx.fillText(family,12,y+20);
  for(const [column,kind]of ['raw SVG','SVG text paths','native Canvas'].entries()){
   ctx.font=`12px "${labelFamily}"`;ctx.fillText(kind,column*500+12,y+38);
   if(column<2){const data=column?convertSVGTextToPath(svg):svg;const image=await loadImage(Buffer.from(data));ctx.drawImage(image,column*500,y+40);}
   else{ctx.font=`24px ${family}`;ctx.fillText(sample,column*500+12,y+75);ctx.fillText('Second line: 第二行',column*500+12,y+111);}
  }
  ctx.font=`24px ${family}`;rows.push({family,installed:GlobalFonts.has(family),nativeWidth:ctx.measureText(sample).width});
 }
 await fs.writeFile(path.join(directory,'font-probe.png'),await canvas.encode('png'));
 const report={node:process.version,platform:process.platform,canvas:require('@napi-rs/canvas/package.json').version,registeredNoFonts:true,rows};
 await fs.writeFile(path.join(directory,'font-probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({directory,...report},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
