/** Current global tool entry points, shared by application UI regressions. */
export async function openApplicationMenu(page){
 const trigger=page.locator('.application-settings-trigger')
 if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click()
 const menu=page.locator('.application-menu');await menu.waitFor({state:'visible'});return menu
}
export async function openApplicationSettings(page){const menu=await openApplicationMenu(page);await menu.getByRole('menuitem',{name:/^(Settings|设置)$/}).click()}
export async function openApplicationFiles(page){const menu=await openApplicationMenu(page);await menu.locator('.application-files').click()}
