import {Icon} from './Icon'

/** Shared plugin identity in the application launcher and external extensions. */
export function PluginIcon({id:_id}:{id:string}){
  return <span className="plugin-generic" aria-hidden="true"><Icon name="extensions"/></span>
}
