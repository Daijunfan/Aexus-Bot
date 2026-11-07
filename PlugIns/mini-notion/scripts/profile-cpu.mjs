// Samples renderer CPU while navigating an APFS workspace clone.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {_electron:electron}=require('@playwright/test');
const folder=process.env.MINI_NOTION_PROFILE_WORKSPACE;
if(!folder||!fs.existsSync(path.join(folder,'.mininotion/collection.json')))throw Error('Isolated workspace required');
const app=await electron.launch({executablePath:require('electron'),args:['.'],env:{...process.env,MINI_NOTION_TEST:'1',MINI_NOTION_BACKGROUND_TEST:'1',MINI_NOTION_WORKSPACE:folder,MINI_NOTION_DATA_DIR:path.join(folder,'.mininotion','desktop')}});
const page=await app.firstWindow();
try{
  await page.locator('.sidebar-page').first().waitFor({timeout:30000});
  await page.waitForTimeout(800);
  const ids=await page.evaluate(()=>[...document.querySelectorAll('.sidebar-page[data-page-id]')].map(el=>el.dataset.pageId).slice(0,2));
  const session=await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval',{interval:500});
  await session.send('Profiler.start');
  await page.evaluate(()=>document.querySelector('.sidebar-nav button:nth-child(2)')?.click());
  await page.waitForTimeout(200);
  for (let run=0;run<3;run++){
    for(let i=0;i<ids.length;i++){
      await page.evaluate(id=>document.querySelector(`.sidebar-page[data-page-id="${id}"]`)?.click(),ids[i]);
      await page.waitForTimeout(300);
    }
  }
  const result=await session.send('Profiler.stop');
  const samples=result.profile.samples||[],deltas=result.profile.timeDeltas||[];
  const frames=new Map(result.profile.nodes.map(n=>[n.id,n]));
  const summary=new Map();
  for(let i=0;i<samples.length;i++){
    const node=frames.get(samples[i]);
    if(!node)continue;
    const frame=node.callFrame;
    let file=frame.url.split('/').at(-1)||'internal';
    const key=file+':'+frame.lineNumber+' '+frame.functionName;
    const entry=summary.get(key)||{count:0,micros:0};entry.count++;entry.micros+=deltas[i]||0;summary.set(key,entry);
  }
  console.log(JSON.stringify({totalSamples:samples.length,durationMs:Math.round(deltas.reduce((s,v)=>s+v,0)/1000),
    top:[...summary].sort((a,b)=>b[1].micros-a[1].micros).slice(0,35).map(([name,value])=>({name,...value,ms:Math.round(value.micros/1000)}))},null,2));
  if(process.env.MINI_NOTION_CPU_OUTPUT)fs.writeFileSync(process.env.MINI_NOTION_CPU_OUTPUT,JSON.stringify(result.profile));
}finally{await app.close()}
