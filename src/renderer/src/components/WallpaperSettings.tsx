import {useRef,useState,type CSSProperties} from 'react'
import {DEFAULT_MESSAGE_WALLPAPER,WALLPAPER_PATTERNS,type MessageWallpaperSettings} from '../../../shared/message-wallpaper'
import {TELEGRAM_WALLPAPERS} from '../../../shared/telegram-wallpapers'
import {readableThemeAccent,type ViewAppearance} from '../../../shared/preferences'
import {MessageWallpaper} from '../chat/MessageWallpaper'
import {TelegramWallpaper} from '../chat/TelegramWallpaper'
import {translate as uiText} from '../i18n'
import {Icon} from './Icon'
import '../styles/wallpaper-settings.css'

const labels={telegram:'Telegram',daydream:'Daydream',botanical:'Botanical',cosmos:'Cosmos',studio:'Studio',geometric:'Geometry',none:'No pattern'}
const DARK_THEMES=['black','space','midnight','sage']
const DEFAULT_CUSTOM_COLORS=['#b2cee1']
const HEX=/^#[0-9a-fA-F]{6}$/
export function WallpaperSettings({value,appearance,onChange}:{value:MessageWallpaperSettings;appearance:ViewAppearance;onChange:(patch:Partial<MessageWallpaperSettings>,delay?:number)=>void}){
 const themeSample=`theme-sample sample-${appearance.theme}`,style={'--custom-theme-color':appearance.themeColor,'--custom-theme-accent':readableThemeAccent(appearance.themeColor)} as CSSProperties
 const dark=DARK_THEMES.includes(appearance.theme)
 const colors=value.colors?.length?value.colors:DEFAULT_CUSTOM_COLORS,colorsKey=colors.join(',')
 const [drafts,setDrafts]=useState(colors)
 const customDetails=useRef<HTMLDetailsElement>(null),draftsKey=useRef(colorsKey)
 if(draftsKey.current!==colorsKey){draftsKey.current=colorsKey;setDrafts(colors)}
 const selectCustom=()=>{
  onChange({palette:'custom',colors})
  if(customDetails.current)customDetails.current.open=true
 }
 const setColors=(next:string[],delay?:number)=>onChange({palette:'custom',colors:next},delay)
 const commitColor=(index:number,raw:string)=>{
  const text=raw.trim()
  if(!HEX.test(text)){setDrafts(colors);return}
  const next=colors.map((color,position)=>position===index?text.toLowerCase():color)
  setDrafts(next)
  setColors(next)
 }
 return <section className="wallpaper-settings" aria-label={uiText('Chat wallpaper')}>
  <div className="settings-section-heading"><h3>{uiText('Chat wallpaper')}</h3><button type="button" onClick={()=>onChange({...DEFAULT_MESSAGE_WALLPAPER,palette:'theme',colors:['#bdcd8c'],rotation:0})}>{uiText('Reset wallpaper')}</button></div>
  <p className="wallpaper-help">{uiText('Small details, a quieter conversation. Applies to private chats, groups and channels.')}</p>
  <div className={`wallpaper-preview ${themeSample}`} style={style} role="img" aria-label={uiText('Chat wallpaper preview')}>
   <MessageWallpaper settings={value} dark={dark}/><div className="wallpaper-preview-caption"><Icon name="eye"/>{uiText('Live preview')}</div>
   <div className="wallpaper-preview-bubbles"><span>{uiText('A little room for good ideas.')}<small>10:24</small></span><span>{uiText('Make it feel like you.')}<small>10:25 <Icon name="check-all"/></small></span></div>
  </div>
  <div className="wallpaper-patterns" role="group" aria-label={uiText('Pattern collection')}>{(['none',...WALLPAPER_PATTERNS.filter(pattern=>pattern!=='none'&&pattern!=='telegram')] as const).map(pattern=><button type="button" key={pattern} data-pattern-option={pattern} aria-label={uiText(labels[pattern])} aria-pressed={value.pattern===pattern} onClick={()=>onChange({pattern})}>
   <span className={`wallpaper-swatch ${themeSample}`} style={style} aria-hidden="true"><MessageWallpaper settings={{...value,pattern,opacity:24,density:130}} dark={dark}/>{pattern==='none'&&<Icon name="circle-slash"/>}</span>
   <span className="wallpaper-pattern-label">{uiText(labels[pattern])}{value.pattern===pattern&&<Icon name="check"/>}</span>
  </button>)}</div>
  <div className="wallpaper-palettes-heading">{uiText('Colors')}</div>
  <div className="wallpaper-palettes wallpaper-primary-colors" role="group" aria-label={uiText('Colors')}>
   <button type="button" data-wallpaper-palette-option="theme" aria-label={uiText('Default wallpaper')} aria-pressed={!value.palette||value.palette==='theme'} onClick={()=>onChange({...DEFAULT_MESSAGE_WALLPAPER,palette:'theme',colors:DEFAULT_CUSTOM_COLORS,rotation:0})}>
    <span className="wallpaper-palette-swatch"><MessageWallpaper settings={{...value,palette:'theme'}} dark={dark}/></span><span>{uiText('Default wallpaper')}</span>
    {(!value.palette||value.palette==='theme')&&<Icon name="check"/>}
   </button>
   <button type="button" data-wallpaper-palette-option="custom" aria-label={uiText('Custom wallpaper')} aria-pressed={value.palette==='custom'} onClick={selectCustom}>
    <span className="wallpaper-palette-swatch"><MessageWallpaper settings={{...value,palette:'custom',colors}} dark={dark}/></span><span>{uiText('Custom wallpaper')}</span>
    {value.palette==='custom'&&<Icon name="check"/>}
   </button>
  </div>
  <details className="wallpaper-custom" ref={customDetails}>
   <summary>{uiText('Custom wallpaper')}</summary>
   <div className="wallpaper-custom-colors" role="group" aria-label={uiText('Colors')}>{colors.map((color,index)=><div className="wallpaper-color-row" key={index}>
    <input type="color" aria-label={uiText('Color {0}',[index+1])} value={color} onChange={event=>{const next=colors.map((item,position)=>position===index?event.target.value:item);setDrafts(next);setColors(next)}}/>
    <input type="text" inputMode="text" spellCheck={false} aria-label={uiText('Color {0} hex value',[index+1])} value={drafts[index]??color} onChange={event=>{const text=event.target.value;setDrafts(current=>current.map((item,position)=>position===index?text:item))}} onBlur={event=>commitColor(index,event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur()}}}/>
    <button type="button" className="wallpaper-color-remove" aria-label={uiText('Remove color {0}',[index+1])} disabled={colors.length<=1} onClick={()=>setColors(colors.filter((_,position)=>position!==index))}><Icon name="trash"/></button>
   </div>)}</div>
   {colors.length<4&&<button type="button" className="wallpaper-color-add" onClick={()=>setColors([...colors,DEFAULT_CUSTOM_COLORS[0]])}><Icon name="add"/>{uiText('Add color')}</button>}
   <label className="settings-range"><span>{uiText('Angle')}<output>{value.rotation??0}°</output></span><input name="wallpaper-rotation" aria-label={uiText('Angle')} type="range" min="0" max="360" step="1" value={value.rotation??0} onChange={event=>onChange({rotation:Number(event.target.value)},180)}/></label>
  </details>
  <details className="wallpaper-imported" open={value.pattern==='telegram'}><summary>{uiText('Imported wallpapers')}</summary><div className="wallpaper-palettes" role="group" aria-label={uiText('Imported wallpapers')}>
   <button type="button" data-pattern-option="telegram" aria-label="Telegram" aria-pressed={value.pattern==='telegram'} onClick={()=>onChange({pattern:'telegram',opacity:37.5})}><TelegramWallpaper className="wallpaper-palette-swatch" settings={{...value,pattern:'telegram'}} dark={dark}/>{value.pattern==='telegram'&&<Icon name="check"/>}</button>
   {TELEGRAM_WALLPAPERS.map(wallpaper=><button type="button" key={wallpaper.id} data-wallpaper-palette-option={wallpaper.id} aria-label={uiText(wallpaper.name)} title={uiText(wallpaper.name)} aria-pressed={value.palette===wallpaper.id} onClick={()=>onChange({palette:wallpaper.id,pattern:'telegram',opacity:37.5})}>
    <TelegramWallpaper className="wallpaper-palette-swatch" settings={{...value,pattern:'telegram',palette:wallpaper.id}} dark={dark}/>
    {value.palette===wallpaper.id&&<Icon name="check"/>}
   </button>)}
  </div></details>
  {value.pattern!=='none'?<fieldset className="wallpaper-adjustments"><legend>{uiText('Pattern arrangement')}</legend>
   {value.pattern!=='telegram'&&<div className="wallpaper-layouts" role="group" aria-label={uiText('Pattern arrangement')}>{(['ordered','scattered'] as const).map(layout=><button type="button" key={layout} data-wallpaper-layout-option={layout} aria-pressed={value.layout===layout} onClick={()=>onChange({layout})}><Icon name={layout==='ordered'?'layout':'sparkle'}/><span>{uiText(layout==='ordered'?'Ordered':'Scattered')}<small>{uiText(layout==='ordered'?'Aligned, even spacing':'Loose, gently rotated')}</small></span><Icon name={value.layout===layout?'pass-filled':'circle-large-outline'}/></button>)}</div>}
   <label className="settings-range"><span>{uiText('Pattern density')}<output>{value.density}%</output></span><input name="wallpaper-density" aria-label={uiText('Pattern density')} type="range" min="70" max="160" step="5" value={value.density} onChange={event=>onChange({density:Number(event.target.value)},180)}/><small>{uiText('Higher density makes the drawings smaller and closer together.')}</small></label>
   <label className="settings-range"><span>{uiText('Pattern opacity')}<output>{value.opacity}%</output></span><input name="wallpaper-opacity" aria-label={uiText('Pattern opacity')} type="range" min="0" max="45" step="0.5" value={value.opacity} onChange={event=>onChange({opacity:Number(event.target.value)},180)}/></label>
  </fieldset>:<p className="settings-help wallpaper-no-pattern-help">{uiText('Choose a pattern to adjust its layout, density and opacity.')}</p>}
 </section>
}
