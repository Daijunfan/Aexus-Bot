'use strict';
const assert=require('node:assert/strict'),{create,expect}=require('./ui-session.cjs');
(async()=>{const f=await create('keyword-boards');let failure;
 try{
  const {page,api}=f;let s=await api('study.create',{title:'标题词条分组'});
  const get=()=>api('study.get',{setId:s.id}),change=async(method,p={})=>s=await api(method,{setId:s.id,expectedRevision:(await get()).revision,...p});
  await change('study.note.create',{title:'Probability； Bayes',text:'First definition',tags:['数学']});const a=s.cards[0].id;
  await change('study.note.create',{title:'probability; Evidence',text:'Second definition',tags:['推理']});const b=s.cards.at(-1).id;
  await change('study.note.create',{title:'普通笔记',text:'Probability only occurs in the body'});
  await api('study.open',{setId:s.id});await page.goto(f.server.url);await page.locator('body[data-ready=true]').waitFor();
  await page.click('#workspace-card-box');await page.selectOption('[name=scope]','current');await page.locator('#board-filters>summary').click();await page.fill('[name=titleKeyword]','Probability');await page.selectOption('[name=group1]','keyword');await page.selectOption('[name=group2]','tag');await page.click('#board-search');
  await expect(page.locator('#board-status')).toContainText('2 张卡片');
  await expect(page.locator('.board-group[data-group-depth="0"] h3')).toHaveText(['Probability 2 张','Bayes 1 张','Evidence 1 张']);
  const memberships=await page.locator('.board-group[data-group-depth="0"]').evaluateAll(groups=>groups.map(group=>{
    const tags=[],cards=[];
    for(let row=group.nextElementSibling;row&&row.dataset.groupDepth!=='0';row=row.nextElementSibling){
      if(row.dataset.groupDepth==='1')tags.push(row.querySelector('h3').textContent);
      if(row.matches('.board-card'))cards.push(row.querySelector('[data-board-check]').dataset.boardCheck);
    }
    return {tags,cards};
  }));
  assert.deepEqual(memberships,[{tags:['数学 1 张','推理 1 张'],cards:[s.id+'/'+a,s.id+'/'+b]},{tags:['数学 1 张'],cards:[s.id+'/'+a]},{tags:['推理 1 张'],cards:[s.id+'/'+b]}]);
  await page.click('#board-select-page');await expect(page.locator('#board-selected')).toHaveText('已选择 2 张卡片');
  await page.click('#board-save');await page.locator('#dialog [name=title]').fill('概率词条');await page.click('#dialog-submit');await expect(page.locator('#dialog')).toBeHidden();assert.equal((await get()).boards[0].groupBy[0],'keyword');
  f.pass('The real database groups semicolon aliases at two levels, filters exact titles, and counts duplicate memberships once');
  await change('study.links.settings',{titleLinks:false});await page.click('#workspace-card-box');await page.selectOption('[name=scope]','current');await expect(page.locator('[name=group1] option[value=keyword]')).toHaveJSProperty('disabled',true);await page.click('#board-close');
  await change('study.links.settings',{titleLinks:true});await page.reload();await page.locator('body[data-ready=true]').waitFor();
  await page.click('#workspace-card-box');await page.selectOption('[name=scope]','current');await page.selectOption('[name=boardId]',(await get()).boards[0].id);await expect(page.locator('#board-status')).toContainText('2 张卡片');await page.locator('.database-saved-actions>summary').click();await page.click('#board-map');await expect(page.locator('#study-database')).toBeHidden();
  const built=await get();assert(built.cards.filter(c=>c.reference).length>=2);assert(built.cards.some(c=>c.id===a));assert(built.cards.some(c=>c.id===b));
  await page.click('#study-undo');await expect.poll(async()=>(await get()).cards.length).toBe(3);
  f.pass('Disabled title linking disables its grouping option; a saved keyword view generates reference cards and undo restores originals');
 }catch(e){failure=e;}await f.finish(failure);
})().catch(e=>{console.error(e);process.exitCode=1;});
