// Content regressions explicitly reveal the current disclosure navigation.
// The dedicated disclosure tests verify primary-click and memory behavior.
export async function showTeamNavigation(page){await page.locator('.company-navigation').waitFor();await page.evaluate(()=>window.agents.call('view.navigation',{section:'team',expanded:true}))}
export async function selectWorkspaceTab(page,name){
 await page.locator('.company-navigation').waitFor()
 const view=await page.evaluate(()=>window.agents.call('view.get')),team=['Engineering','Research','Characters','Workers'].includes(name)||name==='Board'&&view.kind!=='plan'
 if(team){
  if(view.kind!=='home')await page.evaluate(()=>window.agents.call('view.select',{id:'company'}))
  await showTeamNavigation(page)
  await page.locator('.team-subviews').getByRole('tab',{name,exact:true}).click()
 }else{
  if(view.kind!=='plan')await page.evaluate(()=>window.agents.call('view.select',{id:'plan',missionTab:'plan'}))
  await page.locator('.plan-view-tabs').getByRole('tab',{name,exact:true}).click()
 }
}
