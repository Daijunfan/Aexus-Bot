export type AvatarCrop={left:number;top:number;width:number;height:number}
/** The portrait generator and live sprite use the same square, top-aligned cover. */
export function avatarFraming(crop:AvatarCrop,frame:{width:number;height:number}){
 const scale=256/Math.min(crop.width,crop.height)
 return {width:frame.width*scale/256*100+'%',height:frame.height*scale/256*100+'%',left:((256-crop.width*scale)/2-crop.left*scale)/256*100+'%',top:-crop.top*scale/256*100+'%'}
}
