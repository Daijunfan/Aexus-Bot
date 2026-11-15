import {expect} from '@playwright/test'
import {chooseOption} from './app-select.mjs'

export const tableTask=(page,name)=>page.locator('.plan-task-name').filter({has:page.getByText(name,{exact:true})})
export async function viewFilter(page,{team,tags}){
 await page.getByRole('button',{name:'View options',exact:true}).click()
 const options=page.getByRole('dialog',{name:'View options',exact:true})
 const filters=options.getByRole('button',{name:/^View filters(?:\s*\d+)?$/});if(await filters.count())await filters.click()
 if(team!==undefined)await chooseOption(page,options.locator('select[aria-label="Team"]'),team)
 if(tags!==undefined)await options.getByRole('textbox',{name:'Filter by tags',exact:true}).fill(tags)
 await options.getByRole('button',{name:'Done',exact:true}).click()
 await expect(options).toHaveCount(0)
}
export async function viewSort(page,value){
 await page.getByRole('button',{name:'View options',exact:true}).click()
 const options=page.getByRole('dialog',{name:'View options',exact:true})
 await options.getByRole('button',{name:'Display',exact:true}).click()
 await chooseOption(page,options.locator('select[aria-label="Plan sorting"]'),value)
 await options.getByRole('button',{name:'Done',exact:true}).click()
}
