import assert from 'node:assert/strict'
import {fixtureCore} from './fixtures/headless-core.mjs'

const f=await fixtureCore()
try{
  const descriptor=await f.cli('plugin','describe','cloud-hosts')
  assert.ok(descriptor.api.commands.some(c=>c.method==='hosts.terminal-open'))
  assert.ok(!descriptor.api.commands.some(c=>c.method.includes('desktop')))
  for(const verb of ['list','open','launch','close']){
    const reply=await f.request(null,`host.desktop-${verb}`,{})
    assert.equal(reply.ok,false)
    await assert.rejects(()=>f.cli('plugin','call','cloud-hosts',`hosts.desktop-${verb}`,'--params','{}'))
  }
  const docs=await f.cli('api','docs','plugin/cloud-hosts/api')
  assert.doesNotMatch(docs.markdown,/hosts\.desktop-|host\.desktop-|noVNC|VNC|RDP/)
  console.log('PASS retired remote-desktop Core and plugin APIs are rejected; current CLI handbook exposes SSH terminals only')
}finally{await f.close()}
