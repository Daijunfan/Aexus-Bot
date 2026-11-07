// Profiling an isolated APFS clone; never mutate the user's active notebook.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const { _electron: electron } = require('@playwright/test');
const folder = process.env.MINI_NOTION_PROFILE_WORKSPACE;
if (!folder || !fs.existsSync(path.join(folder, '.mininotion', 'collection.json'))) throw Error('Pass an isolated folder-mode workspace clone.');
const executablePath = process.env.MINI_NOTION_PROFILE_EXECUTABLE || require('electron');
const begun = performance.now();
const application = await electron.launch({
  executablePath,
  args: process.env.MINI_NOTION_PROFILE_EXECUTABLE ? [] : ['.'],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, MINI_NOTION_TEST:'1', MINI_NOTION_BACKGROUND_TEST:'1',
    MINI_NOTION_WORKSPACE:folder, MINI_NOTION_DATA_DIR:path.join(folder,'.mininotion','desktop'),
    ELECTRON_DISABLE_SECURITY_WARNINGS:'true' },
  timeout:120000
});
const errors = [];
const page = await application.firstWindow();
page.on('pageerror', e => errors.push(String(e)));
let result = {startupMs:0,counts:{}, samples:[], hitTests:[], errors};
try {
  await page.locator('.sidebar').waitFor({timeout:90000});
  await page.locator('.sidebar-page').first().waitFor({timeout:30000});
  result.startupMs = Math.round(performance.now()-begun);
  result.counts = await page.evaluate(() => ({
    sidebarEntries: document.querySelectorAll('.sidebar-page').length,
    DOMNodes: document.getElementsByTagName('*').length,
    title:document.title,
    currentPage:!!document.querySelector('.page-scroll'),
    home:!!document.querySelector('.home-scroll'),
    documentHeight:document.body.scrollHeight
  }));
  result.hitTests = await page.evaluate(() => {
    const points=[];
    for (const y of [3,12,20,30,42,55,70]) for(const x of [3,15,34,60,85,110,150,200]) {
      const element=document.elementFromPoint(x,y);
      points.push({x,y,element:element?.tagName,cls:typeof element?.className==='string'?element.className.slice(0,75):'',
        cursor:element?getComputedStyle(element).cursor:'none',target:element?.closest('button,a,[role=button]')?.getAttribute('aria-label')});
    }
    return points;
  });
  await page.evaluate(() => {
    window.__profileTasks = [];
    new PerformanceObserver(list => {
      window.__profileTasks.push(...list.getEntries().map(e=>({start:Math.round(e.startTime),duration:Math.round(e.duration)})));
    }).observe({entryTypes:['longtask']});
  });
  async function sample(label, fn){
    const start=performance.now();
    const before=await page.evaluate(()=>({tasks:window.__profileTasks.length,dom:document.getElementsByTagName('*').length}));
    await fn();
    const ms=Math.round(performance.now()-start);
    await page.waitForTimeout(200);
    const after=await page.evaluate((before)=>({tasks:window.__profileTasks.slice(before.tasks),dom:document.getElementsByTagName('*').length}),before);
    result.samples.push({label,ms,dom:after.dom,longTasks:after.tasks.length,longTaskMs:after.tasks.reduce((sum,t)=>sum+t.duration,0)});
  }
  await sample('home',async()=>{
    await page.evaluate(()=>document.querySelector('.sidebar-nav button:nth-child(2)')?.click());
    await page.locator('.home-scroll').waitFor({timeout:20000});
  });
  const pageIds=await page.evaluate(()=>Array.from(document.querySelectorAll('.sidebar-page[data-page-id]')).filter(el=>el.getBoundingClientRect().height).map(el=>el.dataset.pageId).slice(0,5));
  for(const [i,id] of pageIds.entries()){
    await sample('navigate-'+i,async()=>{
      await page.evaluate(id=>document.querySelector(`.sidebar-page[data-page-id="${id}"]`)?.click(),id);
      await page.locator(`.page-scroll[data-page="${id}"]`).waitFor({timeout:20000});
    });
  }
  if(await page.locator('.page-title').count()){
    await sample('title-update',async()=>{
      const el=page.locator('.page-title');
      const title=await el.inputValue();
      await el.fill(title+' test');
      await el.fill(title);
    });
    await sample('title-persist',async()=>page.waitForTimeout(600));
  }
  result.counts.afterDOM=await page.evaluate(()=>document.getElementsByTagName('*').length);
} finally {
  await application.close().catch(()=>{});
}
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exitCode=1;
