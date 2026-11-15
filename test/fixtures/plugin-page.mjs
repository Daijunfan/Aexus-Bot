// The actual plugin renderer lives inside the normal permission-host iframe.
// DOM actions use that frame; input, window events, downloads and screenshots stay on its Page.
export async function pluginPage(page){
 const selector='.plugin-host>iframe';await page.locator(selector).waitFor()
 const content=page.frameLocator(selector),dom=new Set(['locator','getByRole','getByText','getByLabel','getByPlaceholder','getByTestId'])
 const frame=async()=>{const handle=await page.locator(selector).elementHandle(),value=await handle?.contentFrame();if(!value)throw Error('The real plugin renderer iframe is unavailable');return value}
 return new Proxy(page,{get(target,key){
  if(dom.has(key))return content[key].bind(content)
  if(key==='evaluate'||key==='evaluateHandle'||key==='waitForFunction')return async(...args)=>(await frame())[key](...args)
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
 }})
}
