/** Telegram Web A 6002824: built-in light/dark gradients and all twelve color chips. */
export const TELEGRAM_WALLPAPERS=[
 {id:'telegram-classic',name:'Telegram classic',colors:['#bdcd8c','#8eba89','#83b28f','#c5d3b0']},
 {id:'telegram-night',name:'Telegram night',colors:['#4f5bd5','#962fbf','#dd6cb9','#fec496'],masked:true},
 {id:'gray',name:'Gray',colors:['#e6ebee']},
 {id:'light-blue',name:'Light blue',colors:['#b2cee1']},
 {id:'blue',name:'Blue',colors:['#008dd0']},
 {id:'mint',name:'Mint',colors:['#c6e7cb']},
 {id:'lime',name:'Lime',colors:['#c4e1a6']},
 {id:'green',name:'Green',colors:['#60b16e']},
 {id:'olive',name:'Olive',colors:['#ccd0af']},
 {id:'sage',name:'Sage',colors:['#a6a997']},
 {id:'taupe',name:'Taupe',colors:['#7a7072']},
 {id:'peach',name:'Peach',colors:['#fdd7af']},
 {id:'orange',name:'Orange',colors:['#fdb76e']},
 {id:'terracotta',name:'Terracotta',colors:['#dd8851']},
 // Convenient swatches from the same unrestricted RGB color picker.
 {id:'pink',name:'Pink',colors:['#f2c9df']},
 {id:'purple',name:'Purple',colors:['#d9c7ed']},
 {id:'pink-gradient',name:'Pink gradient',colors:['#f4cbdc','#d8b9e8','#efbdd4','#f9dfd2']},
 {id:'purple-gradient',name:'Purple gradient',colors:['#d6c7f0','#b8b7e5','#e2c4e3','#d5d0f3']},
 {id:'blue-gradient',name:'Blue gradient',colors:['#b4d8ee','#a5c4e5','#bfd9eb','#b6dfdc']},
 {id:'gray-gradient',name:'Gray gradient',colors:['#e3e7eb','#cdd5dd','#d9dde5','#e8e8eb']},
 {id:'dark-gray',name:'Dark gray',colors:['#242832']},
 {id:'black',name:'Black',colors:['#000000']}
] as const
export const WALLPAPER_PALETTES=['theme',...TELEGRAM_WALLPAPERS.map(value=>value.id),'custom'] as const
