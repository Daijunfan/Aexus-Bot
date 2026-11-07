import type {EngineId} from './engines'
export type EngineProviderProfile={id:string;name:string;source:'native'|'router'|'saved'|'app';baseUrl?:string;models:string[];active:boolean;credential:{configured:boolean;kind:'key'|'file'|'helper'|'login'|'none';fingerprint?:string};sourceFile:string}
export type EngineProviderCatalog={engine:EngineId;source:'native'|'app';activeModel?:string;endpoint?:string;profiles:EngineProviderProfile[];files:string[];updatedAt:number;clients:{cli:string;vscode:string;app:string};note?:string}
