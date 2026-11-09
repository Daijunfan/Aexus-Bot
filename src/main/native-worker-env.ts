import path from 'node:path'
import {childEnv} from './exec'

/** Preserve the user's native configuration/auth; remove only controller identity/routing. */
export function nativeWorkerEnv(base:NodeJS.ProcessEnv=childEnv(),sdk=false):NodeJS.ProcessEnv{
 const env={...base}
 for(const key of Object.keys(env))if(/^(AGENTS_|AEXUS_)/.test(key)||['CLAUDECODE','CODEX_INTERNAL_ORIGINATOR_OVERRIDE','CODEX_THREAD_ID'].includes(key)||!sdk&&['ELECTRON_RUN_AS_NODE','CLAUDE_CODE_ENTRYPOINT'].includes(key))delete env[key]
 env.PATH=env.PATH?.split(path.delimiter).filter(part=>!/(^|[/\\])\.agents-company([/\\]|$)|[/\\]AgentsCompany[/\\](cli|agent-access)([/\\]|$)/i.test(part)).join(path.delimiter)
 return env
}
