import {memo,useLayoutEffect,useRef,type CSSProperties} from 'react'
import type {MessageWallpaperSettings} from '../../../shared/message-wallpaper'
import {TELEGRAM_WALLPAPERS} from '../../../shared/telegram-wallpapers'
import '../styles/telegram-wallpaper.css'

/** Static 64px resting gradient from Telegram Web A's GPL-3.0 renderStaticGradient.
 * Source: Ajaxy/telegram-tt@6002824, src/util/gradientBackground.ts. No animation/GPU loop. */
function paint(canvas:HTMLCanvasElement,colors:readonly string[],rotation:number){
 canvas.width=canvas.height=64
 const ctx=canvas.getContext('2d');if(!ctx)return
 const radians=(rotation%360)*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians)
 const points=[[.265,.582],[1-.585,1-.164],[1-.265,1-.582],[.585,.164]].map(([x,y])=>[(x-.5)*cos-(y-.5)*sin+.5,(x-.5)*sin+(y-.5)*cos+.5])
 const rgb=Array.from({length:4},(_,i)=>[1,3,5].map(offset=>parseInt(colors[i%colors.length].slice(offset,offset+2),16))),image=ctx.createImageData(64,64)
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const distances=points.map(([px,py])=>Math.hypot(x/64-px,y/64-py)),min=Math.min(...distances),weights=distances.map(d=>(1-(d-min))**3),total=Math.abs(weights.reduce((a,b)=>a+b,0)),at=(y*64+x)*4
  for(let channel=0;channel<3;channel++)image.data[at+channel]=rgb.reduce((sum,c,i)=>sum+c[channel]*(weights[i]/total),0)
  image.data[at+3]=255
 }
 ctx.putImageData(image,0,0)
}

export const TelegramWallpaper=memo(function TelegramWallpaper({settings={},dark=false,className=''}:{settings?:Partial<MessageWallpaperSettings>;dark?:boolean;className?:string}){
 const preset=TELEGRAM_WALLPAPERS.find(value=>value.id===settings.palette)??TELEGRAM_WALLPAPERS[dark?1:0]
 const themed=settings.palette==='theme'
 const colors:readonly string[]=settings.palette==='custom'&&settings.colors?.length?settings.colors:preset.colors,gradient=!themed&&colors.length>1,masked=!themed&&'masked' in preset&&preset.masked&&settings.palette!=='custom',canvas=useRef<HTMLCanvasElement>(null)
 const key=colors.join(','),rotation=settings.rotation??0,pattern=settings.pattern!=='none',opacity=settings.pattern==='telegram'||settings.palette&&settings.palette!=='theme'?(settings.opacity??37.5)/100:.375
 const rgb=[1,3,5].map(offset=>parseInt(colors[0].slice(offset,offset+2),16)),dim=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]<90
 useLayoutEffect(()=>{if(gradient&&canvas.current)paint(canvas.current,colors,rotation)},[key,rotation,gradient])
 return <div className={'telegram-wallpaper '+className} aria-hidden="true" data-wallpaper-pattern={pattern?'telegram':'none'} data-wallpaper-density={settings.density??115} data-wallpaper-opacity={settings.opacity??37.5} data-wallpaper-palette={settings.palette??'theme'} data-wallpaper-colors={key} data-masked={masked||undefined} data-pattern={pattern||undefined} style={{background:themed?'linear-gradient(135deg,var(--theme-wash),var(--theme-wash-alt))':masked?'#000000':colors[0],'--tg-pattern-opacity':opacity,'--tg-pattern-scale':430*115/(settings.density??115)+'px auto','--tg-pattern-ink':themed?'var(--accent)':dim?'#ffffff':'#000000','--tg-pattern-blend':themed?'soft-light':dim?'normal':'soft-light'} as CSSProperties}>
  {gradient&&<canvas ref={canvas} width={64} height={64} aria-hidden="true"/>}
 </div>
})
