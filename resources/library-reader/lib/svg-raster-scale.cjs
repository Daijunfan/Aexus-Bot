'use strict';
const S=require('./safety.cjs');
const IDENTITY=[1,0,0,1],NUMBER=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const invalid=message=>S.fail('EXPORT_FAILED',message+' Export SVG for unsupported coordinate systems.');
function numbers(value){
 const tokens=String(value).trim().split(/(?:\s*,\s*|\s+)/);
 if(!tokens.length||tokens.some(n=>!NUMBER.test(n)||!Number.isFinite(Number(n))))invalid('Invalid raster transform coordinates.');
 return tokens.map(Number);
}
function multiply(a,b){
 const out=[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3]];
 S.assert(out.every(Number.isFinite),'TOO_LARGE','Raster transforms exceed finite image bounds.');return out;
}
function property(node,key){
 let value=node.getAttribute(key);
 for(const declaration of (node.getAttribute('style')||'').split(';')){const colon=declaration.indexOf(':');if(colon>0&&declaration.slice(0,colon).trim().toLowerCase()===key.toLowerCase())value=declaration.slice(colon+1).trim();}
 return value;
}
function transform(value){
 if(value===null||value===undefined||!String(value).trim()||value==='none')return IDENTITY;
 let matrix=IDENTITY,offset=0,count=0;
 for(const match of String(value).matchAll(/([A-Za-z]+)\s*\(([^()]*)\)/g)){
  if(!/^[\s,]*$/.test(value.slice(offset,match.index)))invalid('Unsupported raster transform syntax.');
  S.assert(++count<=256,'TOO_LARGE','Raster transform list exceeds its bound.');
  const name=match[1],args=numbers(match[2]);let op;
  if(name==='matrix'&&args.length===6)op=args.slice(0,4);
  else if(name==='translate'&&(args.length===1||args.length===2))op=IDENTITY;
  else if(name==='scale'&&(args.length===1||args.length===2))op=[args[0],0,0,args[1]??args[0]];
  else if(name==='rotate'&&(args.length===1||args.length===3)){const angle=args[0]*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);op=[c,s,-s,c];}
  else if((name==='skewX'||name==='skewY')&&args.length===1){const t=Math.tan(args[0]*Math.PI/180);op=name==='skewX'?[1,0,t,1]:[1,t,0,1];}
  else invalid('Unsupported raster transform '+name+'.');
  matrix=multiply(matrix,op);offset=match.index+match[0].length;
 }
 if(!count||!/^\s*$/.test(value.slice(offset)))invalid('Unsupported raster transform syntax.');
 return matrix;
}
function viewBox(node){
 const value=node.getAttribute('viewBox');if(value===null||value===undefined)return null;
 const box=numbers(value);if(box.length!==4||box[2]<0||box[3]<0)invalid('Invalid raster SVG viewBox.');return box;
}
function length(value,reference){
 if(value===null||value===undefined||value==='auto')return reference;
 const match=String(value).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px|%)?$/i);
 if(!match)invalid('Unsupported raster SVG viewport unit.');
 const size=Number(match[1])*(match[2]==='%'?(reference??NaN)/100:1);
 if(!Number.isFinite(size)||size<0)invalid('Invalid or unresolved raster SVG viewport.');return size;
}
function largestScale(matrix){
 const unit=Math.max(...matrix.map(Math.abs));if(unit===0)return 0;
 const [a,b,c,d]=matrix.map(n=>n/unit),det=a*d-b*c;if(det===0)return 0;
 const sum=a*a+b*b+c*c+d*d;
 return unit*Math.sqrt((sum+Math.sqrt(Math.max(0,sum*sum-4*det*det)))/2);
}
// rootScale is pixels per root user unit: the caller already owns the root
// viewport mapping. Only nested SVG viewports add another scale here. Keep all
// transforms on the resulting image; this helper controls sampling density only.
// SVG viewport/percentage rules: https://www.w3.org/TR/SVG2/coords.html (8.2, 8.9).
function rasterScale(element,rootScale=1){
 S.assert(Number.isFinite(rootScale)&&rootScale>0,'INVALID_PARAMS','Invalid root raster scale.');
 const ancestors=[];for(let node=element;node?.nodeType===1;node=node.parentNode){S.assert(ancestors.length<256,'TOO_LARGE','Raster SVG nesting exceeds its bound.');ancestors.unshift(node);}
 S.assert(ancestors.length&&ancestors[0].localName==='svg','EXPORT_FAILED','Raster text must belong to an SVG document.');
 let matrix=IDENTITY,viewport={width:null,height:null};
 for(const [index,node]of ancestors.entries()){
  matrix=multiply(matrix,transform(property(node,'transform')));
  if(node.localName!=='svg')continue;
  const box=viewBox(node);
  if(index===0){viewport=box?{width:box[2],height:box[3]}:{width:length(property(node,'width'),null),height:length(property(node,'height'),null)};if(viewport.width===0||viewport.height===0)return 0;continue;}
  const width=length(property(node,'width'),viewport.width),height=length(property(node,'height'),viewport.height);
  if(width===0||height===0||box&&(box[2]===0||box[3]===0))return 0;
  if(box){
   if(width===null||height===null)invalid('Nested raster SVG needs a resolved viewport.');
   let x=width/box[2],y=height/box[3];
   const tokens=(node.getAttribute('preserveAspectRatio')||'xMidYMid meet').trim().split(/\s+/);if(tokens[0]==='defer')tokens.shift();
   if(!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))$/.test(tokens[0])||tokens.length>2||tokens[1]&&!['meet','slice'].includes(tokens[1]))invalid('Unsupported raster SVG preserveAspectRatio.');
   if(tokens[0]!=='none'){const uniform=tokens[1]==='slice'?Math.max(x,y):Math.min(x,y);x=uniform;y=uniform;}
   matrix=multiply(matrix,[x,0,0,y]);viewport={width:box[2],height:box[3]};
  }else viewport={width,height};
 }
 const scale=largestScale(matrix)*rootScale;
 S.assert(Number.isFinite(scale),'TOO_LARGE','Raster transform density exceeds finite image bounds.');return scale;
}
module.exports={rasterScale};
