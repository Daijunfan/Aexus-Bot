import type {SQLInputValue} from 'node:sqlite'
import {all} from './channel-store'
import type {ChannelNewsFilter} from '../shared/channel-filter'
export function validateChannelSources(filter:ChannelNewsFilter,channelId?:string){
 if(!filter.sourceIds)return
 const sources=all('SELECT id,channel_id FROM sources WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(filter.sourceIds))
 if(sources.length!==filter.sourceIds.length||channelId&&sources.some(source=>source.channel_id!==channelId))throw Error('Source does not belong to this channel')
}
/** Local/isolated Core uses the same AND/OR semantics as the indexed Linux archive. */
export function appendChannelFilters(where:string[],values:SQLInputValue[],filter:ChannelNewsFilter){
 if(filter.sourceIds){where.push('s.id IN (SELECT value FROM json_each(?))');values.push(JSON.stringify(filter.sourceIds))}
 if(filter.since!==undefined){where.push('p.published_at>=?');values.push(filter.since)}
 if(filter.until!==undefined){where.push('p.published_at<?');values.push(filter.until)}
 if(filter.timeRanges){where.push('('+filter.timeRanges.map(range=>{values.push(range.since,range.until);return '(p.published_at>=? AND p.published_at<?)'}).join(' OR ')+')')}
 const text="lower(COALESCE(p.title,'')||char(10)||COALESCE(p.body,'')||char(10)||s.name)"
 for(const word of filter.keywordsAll??[]){where.push(`instr(${text},?)>0`);values.push(word)}
 if(filter.keywordsAny){where.push('('+filter.keywordsAny.map(word=>{values.push(word);return `instr(${text},?)>0`}).join(' OR ')+')')}
 for(const word of filter.excludeKeywords??[]){where.push(`instr(${text},?)=0`);values.push(word)}
}
