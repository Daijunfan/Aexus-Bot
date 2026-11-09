// Apply Core's explicit permission choice through Harness's own durable session API.
export const name='aexus-deepseek-policy'
export const inject=['permissionPresets','approval']
export function apply(ctx,config){
 ctx.on('agent/created',({agent})=>{
  ctx.permissionPresets.set(agent.session,config.preset)
  if(config.dontAsk)ctx.approval.setPolicy(agent,'never')
 })
 ctx.provide('aexusDeepseekPolicy',true)
}
