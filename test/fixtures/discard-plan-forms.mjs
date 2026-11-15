/** Discard only this test's temporary drafts through the same visible controls as a user. */
export async function discardPlanForms(page){
 if(!page||page.isClosed())return
 if(await page.getByRole('listbox').isVisible().catch(()=>false))await page.keyboard.press('Escape')
 const editor=page.locator('.plan-editor-overlay > .plan-editor')
 if(await editor.isVisible()){
  const cancel=editor.locator('.plan-confirm button').last()
  if(await cancel.isVisible())await cancel.click({timeout:3000})
  await editor.locator(':scope > header > button').last().click({timeout:3000})
  const discard=editor.locator('.confirm-discard button').first()
  if(await discard.isVisible())await discard.click({timeout:3000})
  await editor.waitFor({state:'detached',timeout:3000})
 }
 const form=page.locator('.plan-inline-form')
 if(await form.count()){
  if(!await form.isVisible())await page.getByRole('tab',{name:/^(Form|表单)$/}).click({timeout:3000})
  await form.getByRole('button',{name:/^(Reset form|重置表单)$/}).click({timeout:3000})
  const discard=form.locator('.confirm-discard button').first()
  if(await discard.isVisible())await discard.click({timeout:3000})
  await page.waitForFunction(()=>document.querySelector('.plan-inline-form [name=plan-name]')?.value==='',null,{timeout:3000})
 }
}
