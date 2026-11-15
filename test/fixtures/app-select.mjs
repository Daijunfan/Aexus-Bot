import {expect} from '@playwright/test'

/** Read option metadata, then use the same visible dropdown and option as a user. */
export async function chooseOption(page,select,value){
 await expect(select).toHaveCount(1)
 const label=await select.locator('option').evaluateAll((items,value)=>items.find(item=>item.value===value)?.textContent,String(value))
 if(!label)throw Error('The dropdown does not offer '+value)
 await select.locator('..').locator('.app-select-trigger').click()
 await page.getByRole('option',{name:label,exact:true}).click()
 await expect(select).toHaveValue(String(value))
}
