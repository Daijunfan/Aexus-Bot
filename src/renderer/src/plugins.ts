// Registered editors flush before host navigation or window close. The name remains compatible with plugin callers.
type FlushContext={nextKind?:string}
const flushers=new Set<(context?:FlushContext)=>Promise<void>>()
export function onPluginFlush(flush:(context?:FlushContext)=>Promise<void>) {flushers.add(flush);return()=>{flushers.delete(flush)}}
export async function flushPlugins(context?:FlushContext) {await Promise.all([...flushers].map(flush=>flush(context)))}
