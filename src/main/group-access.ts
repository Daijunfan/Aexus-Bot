import {credentialActive} from './agent-access'
import {groupDetails} from '../shared/group-collaboration'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {join} from 'node:path'
import {atomicJson,readJson} from './atomic-file'
import {catalog,directory,indexFile,emitChatChange} from './chat-group-store'
import {requireConversation,auditConversation,controlChanged} from './conversation-policy'
import {isAppAdministrator} from './application-authority'
import {readStore} from './store'
import {requestContext} from './request-context'
import type {ChatGroup} from '../shared/chat-groups'
import type {PrincipalRef} from '../shared/management'

type Invite={credentialHash?:string;id:string;name:string;code:string;createdAt:number;createdBy:PrincipalRef;expiresAt?:number;useLimit?:number;used:number;approval:boolean;revokedAt?:number;key:string;fingerprint:string}
type JoinRequest={id:string;employee:string;inviteId:string;createdAt:number;state:'pending'|'approved'|'declined';revision:number;decidedAt?:number;decidedBy?:PrincipalRef}
type State={version:1;invites:Invite[];requests:JoinRequest[]}
const file=(id:string)=>join(directory,id+'-invites.json'),state=(id:string)=>{const value=readJson<State>(file(id),()=>({version:1,invites:[],requests:[]})),receipts=catalog().groups.find(group=>group.id===id)?.joinReceipts??[];for(const invite of value.invites)invite.used=receipts.filter(receipt=>receipt.inviteId===invite.id).length;return value},hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const publicInvite=({key,fingerprint,credentialHash,...invite}:Invite)=>({...invite,available:!invite.revokedAt&&(!invite.expiresAt||invite.expiresAt>Date.now())&&(!invite.useLimit||invite.used<invite.useLimit)})
function valid(invite:Invite|undefined,group:ChatGroup):asserts invite is Invite{if(!invite||!publicInvite(invite).available)throw Error('This invitation is expired, revoked or full');if(invite.createdBy.kind==='agent'&&invite.credentialHash&&!credentialActive(invite.createdBy.employeeId,invite.credentialHash))throw Error('Invitation creator credential was revoked');try{requireConversation('group:'+group.id,'admin',invite.createdBy)}catch{requireConversation('group:'+group.id,'read',invite.createdBy);if(!groupDetails(group.details,group.id).permissions.addMembers)throw Error('Invitation creator no longer has permission')}}
function save(id:string,value:State){atomicJson(file(id),value,true);controlChanged('group:'+id)}
function member(group:ChatGroup,id:string){if(!readStore().sessions.some(card=>card.id===id&&!card.deleting))throw Error('Choose an existing employee');if(group.bannedIds?.includes(id))throw Error('This employee is banned from the group');if(!group.memberIds.includes(id)&&group.memberIds.length>=200)throw Error('A group supports up to 200 employees')}
function add(group:ChatGroup,id:string,inviteId:string){member(group,id);const store=catalog(),current=store.groups.find(value=>value.id===group.id)!;if(current.memberIds.includes(id))return;current.memberIds.push(id);current.joinReceipts??=[];current.joinReceipts.push({inviteId,employeeId:id});current.policyRevision=(current.policyRevision??1)+1;current.revision++;current.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(group.id);controlChanged('group:'+group.id);auditConversation('group:'+group.id,'invite-join',{employee:id})}
export function groupAccessRequest(command:string,args:Record<string,any>){
 const group=catalog().groups.find(value=>value.id===args.id);if(!group||group.bot)throw Error('Unknown local group')
 const principal=requestContext().principal,data=state(group.id),admin=()=>requireConversation('group:'+group.id,'admin')
 if(command==='chat.join'){
  const employee=args.employee??(principal.kind==='agent'?principal.employeeId:undefined);if(!employee||!isAppAdministrator()&&(principal.kind!=='agent'||principal.employeeId!==employee))throw Error('Join using your own authenticated employee identity')
  const invite=data.invites.find(value=>value.code===args.code);valid(invite,group);member(group,employee)
  if(group.memberIds.includes(employee))return {state:'joined',groupId:group.id,employee}
  if(invite.approval){let request=data.requests.find(value=>value.employee===employee&&value.inviteId===invite.id&&value.state==='pending');if(!request){request={id:'join_'+randomUUID(),employee,inviteId:invite.id,createdAt:Date.now(),state:'pending',revision:1};data.requests.push(request);save(group.id,data);auditConversation('group:'+group.id,'join-request',{employee,requestId:request.id})}return {state:'pending',groupId:group.id,requestId:request.id}}
  add(group,employee,invite.id);invite.used++;save(group.id,data);return {state:'joined',groupId:group.id,employee}
 }
 let manager=true;try{admin()}catch{manager=false}
 const own=(invite:Invite)=>JSON.stringify(invite.createdBy)===JSON.stringify(principal)
 if(['chat.invites','chat.invite-create'].includes(command)){requireConversation('group:'+group.id);if(!manager&&!groupDetails(group.details,group.id).permissions.addMembers)throw Error('Members cannot create invitations in this group')}else if(command!=='chat.invite-revoke')admin()
 if(command==='chat.invites')return {invites:data.invites.filter(invite=>manager||own(invite)).map(publicInvite),bannedIds:manager?group.bannedIds??[]:[]}
 if(command==='chat.join-requests')return {requests:data.requests.map(request=>({...request,available:(()=>{try{valid(data.invites.find(invite=>invite.id===request.inviteId),group);return !group.bannedIds?.includes(request.employee)}catch{return false}})()}))}
 if(command==='chat.invite-create'){
  const key=JSON.stringify([principal,args.clientRequestId]),fingerprint=hash(JSON.stringify([args.name,args.expiresAt??null,args.useLimit??null,!!args.approval])),previous=data.invites.find(value=>value.key===key)
  if(previous){if(previous.fingerprint!==fingerprint)throw Error('Invitation request ID already used with other settings');return publicInvite(previous)}
  const expiresAt=args.expiresAt?Date.parse(args.expiresAt):undefined;if(expiresAt!==undefined&&(!/(Z|[+-]\d\d:\d\d)$/.test(args.expiresAt)||!Number.isFinite(expiresAt)||expiresAt<=Date.now()))throw Error('Choose a future ISO expiry with a timezone')
  const invite:Invite={id:'invite_'+randomUUID(),code:randomBytes(24).toString('base64url'),name:args.name.trim(),createdAt:Date.now(),createdBy:principal,...(requestContext().credentialHash?{credentialHash:requestContext().credentialHash}:{}),approval:!!args.approval,used:0,key,fingerprint,...(expiresAt?{expiresAt}:{}),...(args.useLimit?{useLimit:args.useLimit}:{})};if(!invite.name)throw Error('Choose an invitation name');data.invites.push(invite);save(group.id,data);auditConversation('group:'+group.id,'invite-create',{inviteId:invite.id,name:invite.name});return publicInvite(invite)
 }
 if(command==='chat.invite-revoke'){const invite=data.invites.find(value=>value.id===args.inviteId);if(!invite)throw Error('Unknown invitation');if(!manager){requireConversation('group:'+group.id);if(!own(invite))admin()}invite.revokedAt??=Date.now();save(group.id,data);auditConversation('group:'+group.id,'invite-revoke',{inviteId:invite.id});return publicInvite(invite)}
 if(command==='chat.join-decide'){
  const request=data.requests.find(value=>value.id===args.requestId);if(!request)throw Error('Unknown join request');const decision=args.approve?'approved':'declined';if(request.state===decision)return request;if(request.state!=='pending'||request.revision!==args.expectedRevision)throw Error('Join request changed; reload before deciding')
  if(args.approve){const invite=data.invites.find(value=>value.id===request.inviteId);valid(invite,group);member(group,request.employee);const already=group.memberIds.includes(request.employee);add(group,request.employee,invite.id);if(!already)invite.used++}
  request.state=decision;request.revision++;request.decidedAt=Date.now();request.decidedBy=principal;save(group.id,data);auditConversation('group:'+group.id,'join-decide',{requestId:request.id,decision});return request
 }
 if(command==='chat.ban'){
  const id=args.employee;if(id===group.ownerId&&args.banned)throw Error('Transfer ownership before banning the Owner');if(!readStore().sessions.some(card=>card.id===id&&!card.deleting))throw Error('Choose an existing employee')
  const store=catalog(),current=store.groups.find(value=>value.id===group.id)!,bans=new Set(current.bannedIds??[]);if(args.banned)bans.add(id);else bans.delete(id);current.bannedIds=[...bans];if(args.banned){current.memberIds=current.memberIds.filter(value=>value!==id);current.adminIds=current.adminIds?.filter(value=>value!==id);if(current.mutes)delete current.mutes[id]}current.policyRevision=(current.policyRevision??1)+1;current.revision++;current.updatedAt=Date.now();atomicJson(indexFile,store,true);emitChatChange(group.id);controlChanged('group:'+group.id);auditConversation('group:'+group.id,'ban',{employee:id,banned:args.banned});return {employee:id,banned:args.banned}
 }
 throw Error('Unknown group invitation operation')
}
