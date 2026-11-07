export const CHANNEL_FETCH_APIS=new Set(['channel.fetch-text','channel.fetch-images','channel.search'])
import type {ChannelNewsFilter} from './channel-filter'
import type {ChannelDocument,ChannelPlugin} from './channels'

export type ChannelFetchedImage={id:string;mimeType:string;data:string}
export type ChannelFetchedMessage={id:string;sourceId:string;sourceName:string;platform:ChannelPlugin;authorName:string;title:string;text:string;publishedAt:number;url?:string;files?:ChannelDocument[];images?:ChannelFetchedImage[]}
export type ChannelFetchPage={kind:'channel-messages';channelId:string;mode:'text'|'images';messages:ChannelFetchedMessage[];limit:number;total:number;filters?:ChannelNewsFilter;nextCursor:string|null}
