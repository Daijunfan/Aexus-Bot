'use strict';
/** Exercise the real opaque-origin renderer; input/window controls stay on its native parent. */
async function pluginFramePage(parent){
 let frame;
 const bind=async()=>{await parent.frameLocator('iframe').locator('body[data-ready=true]').waitFor();const element=await parent.locator('iframe').elementHandle();frame=await element.contentFrame();if(!frame)throw Error('Plugin renderer frame is unavailable');};
 await bind();
 const locatorMethods=new Set(['locator','getByRole','getByText','getByLabel','getByPlaceholder','getByAltText','getByTitle','getByTestId']);
 const parentMethods=new Set(['on','once','screenshot','url','setDefaultTimeout','setDefaultNavigationTimeout','context','viewportSize','setViewportSize','close','isClosed','waitForEvent','emulateMedia']);
 return new Proxy({}, {get(_target,key){if(locatorMethods.has(key)){const target=parent.frameLocator('iframe');return target[key].bind(target)}if(key==='reload')return async(...args)=>{const result=await parent.reload(...args);await bind();return result};if(key==='goto')return async(...args)=>{const result=await parent.goto(...args);await bind();return result};const target=parentMethods.has(key)||!(key in frame)?parent:frame;const value=target[key];return typeof value==='function'?value.bind(target):value;}});
}
module.exports={pluginFramePage};
