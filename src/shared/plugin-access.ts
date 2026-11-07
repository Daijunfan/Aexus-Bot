export type PluginRights={read:boolean;write:boolean;create:boolean}
export type PluginResource={id:string;title:string;kind:string;parentId?:string|null;inheritFrom?:string;capabilities?:('read'|'write'|'create')[]}
export type PluginGrant=PluginRights&{employeeId:string;resourceId:string}
export type PluginScope={employeeId:string;employeeName?:string;grants:(PluginRights&{resourceId:string})[]}
export type PluginCreatedResource={id:string;parentId:string}
export function pluginResourceRights(scope:PluginScope,resources:PluginResource[],id:string):PluginRights{
 return scope.grants.find(g=>g.resourceId===id)??scope.grants.find(g=>g.resourceId===resources.find(r=>r.id===id)?.inheritFrom)??{read:false,write:false,create:false}
}
