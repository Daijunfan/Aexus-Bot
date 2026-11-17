// The wire contract between the app and the `agents` CLI. Both sides import
// this so a change to the command surface breaks compilation, not runtime.

export {APP_HOME,SOCKET_PATH} from './core-paths'

export type Request = { cmd: string; args?: Record<string, unknown>; auth?:string }
// avatar.list {query?,style?,all?}: live catalog for every role, including initialization.
// card.create accepts character+avatarStyle or an exact avatar ID; profession is
// separate from managementRole. card.avatar changes only a controlled appearance.
export type {AvatarSelection,AvatarDescription,AvatarStyle} from './avatars'
// engine.probe {engine,confirm:true,model?}: explicitly billed OK-only call on the Core host.
// Returns engine/model/target/text/elapsedMs/checkedAt; checkEngine never invokes inference.

export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

/** Events pushed to a client that asked to follow a session. */
export type FollowEvent =
  | { type: 'event'; channel: string; payload: unknown }
  | { type: 'done' }

export {COMMANDS} from './api-registry'
export type {UiElement,UiSnapshot} from './api-registry'

// card.initialize retries onboarding; EMPLOYEE_INITIALIZING / EMPLOYEE_INITIALIZATION_FAILED are lifecycle error codes.
// Employee engine is fixed at creation. card.update rejects a different engine;
// legacy config.engine always rejects with delete-and-recreate guidance.
// engine.models discovers the selected engine/host catalog without a session or inference.
// card.remove accepts deleteWorkspace:boolean (default false); explicit true removes the employee directory recursively.

// lastReply / unread fields are additive; acknowledgement always names an exact replyId.

// management.roles exposes the shared employee-role registry. Governor lifecycle is user-only.
// management.topology accepts creator: self|others|operator|unknown|EMPLOYEE_ID.
// Nodes expose createdBy: PrincipalRef|null, createdByMe: boolean|null and createdAt.
// Edges show trusted creation provenance; they do not authorize control.
// management.activity returns live requests and running delegated tasks (kind, messageId); management:activity publishes the same snapshot.
// Activity includes authenticated live communication and running delegated tasks; no read polling or completion linger.
// It is never client-set or persisted into the employee store.

// host.check coalesces concurrent callers for the same host and bounds active SSH health probes to three.

// card.remove accepts id:string or ids:string[] and deleteWorkspace:boolean (default false).
// All targets are authorized and preflighted before cleanup, deduplicating protected roots.

// host.list accepts os, distribution and summary; registry reads never trigger SSH.
// Topology nodes expose workspace:{location,hostId?,os,distribution?,directory} for the effective employee environment.
// host.list is read-only discovery for every employee. credentials:true includes authorized host passwords/files.
// host.get/credentials: Governor and Manager with host access; Employee denied.
// host.credentials returns {id,password,files:{identityFile?,knownHosts?,sshConfig?}}, each file {path,content}.
// files:false omits file contents for internal SSH askpass. Other host management permissions are unchanged.

// host.terminal-{open,list,read,input,resize,close}: id is the registered host; terminal is its PTY ID.

// host.terminal-read waitMs: 0..15000 (default 0) waits for data or exit; cursor semantics are unchanged.


// Engine IDs: codex, claude, cline, pi, opencode, kilo, deepseek, antigravity. Cline/Pi use DeepSeek Flash with Thinking off by default.
// Cline/Pi support Core-local Build and Tunnel cloud workspaces; native-cloud/plugin targets fail before execution.
