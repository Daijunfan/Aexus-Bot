import fs from 'node:fs'
import path from 'node:path'
/** Optional cross-project integration fixture; collector implementation is never vendored into the client. */
export const collectorSourceRoot=path.resolve(process.env.AEXUS_COLLECTOR_SOURCE??path.resolve(import.meta.dirname,'../../../xhs_publisher/integrations/aexus-bot'))
if(!fs.existsSync(path.join(collectorSourceRoot,'channel_content.py')))throw Error('Clone Daijunfan/xhs_publisher beside Aexus, or set AEXUS_COLLECTOR_SOURCE to its integrations/aexus-bot directory')
