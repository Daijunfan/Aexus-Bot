/** Public source identity only. Fetching and credentials belong to the external collector. */
export function knowledgeSource(plugin:'zhihu'|'linkedin',value:string){
 const invalid=()=>Error(plugin==='zhihu'?'Use a Zhihu author/organization homepage or https://daily.zhihu.com/':'Use a LinkedIn person, company, showcase or school homepage')
 let url:URL;try{url=new URL(value)}catch{throw invalid()}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw invalid()
 const host=url.hostname.toLowerCase(),path=decodeURIComponent(url.pathname).replace(/\/+$/,'')
 if(plugin==='zhihu'){
  if(host==='daily.zhihu.com'&&!path)return {identity:'daily',url:'https://daily.zhihu.com/'}
  if(!['zhihu.com','www.zhihu.com'].includes(host))throw invalid()
  const match=path.match(/^\/(people|org)\/([\p{L}\p{N}_.-]+)(?:\/(?:activities|answers|posts|articles))?$/u)
  if(!match)throw invalid()
  const identity=match[1]+'/'+match[2].toLowerCase();return {identity,url:'https://www.zhihu.com/'+identity}
 }
 if(!['linkedin.com','www.linkedin.com'].includes(host)&&!/^([a-z]{2})\.linkedin\.com$/.test(host))throw invalid()
 const match=path.match(/^\/(in|company|school|showcase)\/([\p{L}\p{N}_.-]+)(?:\/posts|\/recent-activity\/(?:all|posts))?$/u)
 if(!match)throw invalid()
 const identity=match[1]+'/'+match[2].toLowerCase();return {identity,url:'https://www.linkedin.com/'+identity}
}
