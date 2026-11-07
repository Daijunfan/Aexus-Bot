/** News filters are shared by the GUI and authenticated employee read APIs. */
const instant={oneOf:[{type:'integer',minimum:0},{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$'}]}
const words={type:'array',items:{type:'string',minLength:1,maxLength:200},minItems:1,maxItems:32,uniqueItems:true}
export const CHANNEL_FILTER_SCHEMA={
 sourceId:{type:'string',minLength:1},sourceIds:{type:'array',items:{type:'string',minLength:1},minItems:1,maxItems:10000,uniqueItems:true},
 since:instant,until:instant,timeRanges:{type:'array',minItems:1,maxItems:31,items:{type:'object',additionalProperties:false,properties:{since:instant,until:instant},required:['since','until']}},
 keywordsAll:words,keywordsAny:words,excludeKeywords:words
}
export const CHANNEL_FILTER_FIELDS=Object.keys(CHANNEL_FILTER_SCHEMA)
export type ChannelNewsFilter={sourceIds?:string[];since?:number;until?:number;timeRanges?:{since:number;until:number}[];keywordsAll?:string[];keywordsAny?:string[];excludeKeywords?:string[]}
export function normalizeChannelFilter(args:Record<string,any>):ChannelNewsFilter{
 const filter:ChannelNewsFilter={}
 if(args.sourceId!==undefined&&args.sourceIds!==undefined)throw Error('Choose sourceId or sourceIds, not both')
 const ids=args.sourceIds??(args.sourceId!==undefined?[args.sourceId]:undefined)
 if(ids!==undefined){if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'||!id.trim()))throw Error('Choose one or more source IDs');filter.sourceIds=[...new Set<string>(ids)].sort()}
 const time=(value:unknown)=>{const stamp=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):value;if(typeof stamp!=='number'||!Number.isSafeInteger(stamp)||stamp<0)throw Error('Use epoch milliseconds or an ISO date-time with an explicit UTC offset');return stamp}
 if(args.since!==undefined)filter.since=time(args.since)
 if(args.until!==undefined)filter.until=time(args.until)
 if(filter.since!==undefined&&filter.until!==undefined&&filter.since>=filter.until)throw Error('since must precede until; time ranges are [since, until)')
 if(args.timeRanges!==undefined){if(!Array.isArray(args.timeRanges)||!args.timeRanges.length||args.timeRanges.length>31)throw Error('Choose 1–31 time ranges');filter.timeRanges=args.timeRanges.map((range:any)=>{const since=time(range?.since),until=time(range?.until);if(since>=until)throw Error('Each time range must have since before until');return {since,until}}).sort((a,b)=>a.since-b.since||a.until-b.until)}
 for(const key of ['keywordsAll','keywordsAny','excludeKeywords'] as const)if(args[key]!==undefined){const values=args[key];if(!Array.isArray(values)||!values.length||values.length>32||values.some(value=>typeof value!=='string'||!value.trim()||value.length>200))throw Error('Choose 1–32 nonempty keywords');filter[key]=[...new Set<string>(values.map(value=>value.trim().toLowerCase()))].sort()}
 return filter
}
export const withoutSummaryHeading=(text:string)=>text.replace(/^\s*(?:#{1,6}\s*)?视频总结\s*(?:[：:]\s*|\r?\n+|$)/,'').trimStart()
