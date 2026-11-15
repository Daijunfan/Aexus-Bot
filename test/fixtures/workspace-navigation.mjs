// Content cases use the current Team Board; primary-button behavior has its own tests.
export async function showTeamNavigation(page){
 await page.locator('.company-navigation').waitFor()
 await page.evaluate(()=>window.agents.call('view.select',{id:'company'}))
 await page.locator('.agent-board').waitFor({state:'visible'})
}
export async function selectWorkspaceTab(page,name){
 await page.locator('.company-navigation').waitFor()
 if(['Engineering','Research','Characters','Workers'].includes(name))throw Error('Team has no '+name+' subview. Test its current Board behavior or a real Team/Message round trip instead.')
 const view=await page.evaluate(()=>window.agents.call('view.get'))
 if(name==='Board'&&view.kind!=='plan'){
  await showTeamNavigation(page)
 }else{
  if(view.kind!=='plan')await page.evaluate(()=>window.agents.call('view.select',{id:'plan',missionTab:'plan'}))
  await page.locator('.plan-view-tabs').getByRole('tab',{name,exact:true}).click()
 }
}
