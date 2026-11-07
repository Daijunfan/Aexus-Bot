export type GrokAvatarState='idle'|'thinking'|'working'|'streaming'|'finished'|'failed'
export function grokBody(shape:string):string
export function grokColor(color:string):string
export function grokViewportScale(fill:number):number
export function createGrokAvatar(options:{id:string;seed?:string;body:string;appearance:{ink:number[];spot:number[];cutout:boolean;inkPaint:string};size:number|'100%';fill:number;state:GrokAvatarState;maxFrameRate?:number;isPlaying:boolean;isFollowingPointer?:boolean}):{attach(target:{host:HTMLElement;canvas:HTMLElement}):()=>void;update(patch:Record<string,unknown>):void}
