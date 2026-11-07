import {test, expect, _electron as electron} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage } from '../src/model';

test('standalone folder window keeps the macOS titlebar arrow and sends small update deltas',async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mini-notion-standalone-performance-')));
  const metadata=path.join(root,'.mininotion');
  fs.mkdirSync(metadata);
  fs.writeFileSync(path.join(metadata,'collection.json'),JSON.stringify({format:'mininotion.collection/v1'}));
  // Enough real folders to detect regressions that scale with the notebook size.
  for(let i=0;i<160;i++){
    const folder=path.join(root,`Page-${String(i).padStart(4,'0')}`);
    fs.mkdirSync(folder);
    const model=makePage({id:`perf-page-${i}`,title:`Regression page ${i}`,
      blocks:[{type:'paragraph',content:'Ordinary offline content '.repeat(90)}]});
    fs.writeFileSync(path.join(folder,'index.mininotion.json'),JSON.stringify({format:'mininotion.page/v1',page:model}));
  }
  const executablePath=process.env.MINI_NOTION_EXECUTABLE;
  const env={...process.env,MINI_NOTION_TEST:'1',MINI_NOTION_BACKGROUND_TEST:'1',
    MINI_NOTION_WORKSPACE:root,MINI_NOTION_DATA_DIR:path.join(metadata,'desktop')};
  delete env.ELECTRON_RUN_AS_NODE;
  let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
  try{
    app=await electron.launch({executablePath:executablePath || path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args:executablePath?[]:['.'],env,timeout:120000});
    const page=await app.firstWindow();
    page.on('pageerror',error=>{throw error});
    await expect.poll(()=>page.locator('.sidebar-page').count(),{timeout:45000}).toBeGreaterThanOrEqual(160);
    const hit=await page.evaluate(()=>{
      const node=document.elementFromPoint(25,22) as HTMLElement|null;
      const region=document.querySelector('.sidebar-titlebar');
      const app=document.querySelector('.app-shell');
      return {tag:node?.tagName,cls:node?.className,cursor:node?getComputedStyle(node).cursor:'',
        titlebar:region?getComputedStyle(region).display:'',
        drag:region?getComputedStyle(region).getPropertyValue('-webkit-app-region'):'',
        embedded:app?.classList.contains('embedded-plugin')};
    });
    expect(hit.titlebar).toBe('flex');
    expect(hit.embedded).toBe(false);
    expect(hit.cls).toBe('sidebar-titlebar');
    expect(hit.cursor).toBe('default');
    expect(hit.drag).toBe('drag');
    expect(await app.evaluate(({app})=>app.getPath('userData'))).toBe(path.join(metadata,'desktop'));
    await page.evaluate(()=>{
      (window as any).__perfEvents=[];
      window.native!.onState(event=>(window as any).__perfEvents.push({
        type:event.type,method:event.method,
        pages:event.type==='delta'?event.delta.pages.length:null,
        bytes:JSON.stringify(event).length
      }));
    });
    await page.locator('.sidebar-page').first().click();
    await page.locator('.page-title').waitFor();
    const title=page.locator('.page-title'),initial=await title.inputValue();
    const started=Date.now();
    await title.fill(initial+' - responsive');
    await expect.poll(()=>page.evaluate(()=>((window as any).__perfEvents||[]).some((e:any)=>e.type==='delta'&&e.method==='workspace.patch')), {timeout:18000}).toBe(true);
    await expect.poll(()=>page.locator('.save-status').innerText(),{timeout:18000}).toContain('已保存');
    expect(Date.now()-started).toBeLessThan(18000);
    const events=await page.evaluate(()=>(window as any).__perfEvents as {type:string,method:string,pages:number|null,bytes:number}[]);
    const patches=events.filter(e=>e.method==='workspace.patch');
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.every(e=>e.type==='delta'&&e.pages!==null&&e.pages<=2)).toBe(true);
    expect(Math.max(...patches.map(e=>e.bytes))).toBeLessThan(30000);
    console.log('STANDALONE PERFORMANCE PASS',JSON.stringify({hit,writeMs:Date.now()-started,
      documentRows:await page.locator('.sidebar-page').count(),patches}));
  }finally{
    await app?.close().catch(()=>{});
    fs.rmSync(root,{recursive:true,force:true});
  }
});
