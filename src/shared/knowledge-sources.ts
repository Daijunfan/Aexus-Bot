/** Public source identity only. Fetching and credentials belong to the external collector. */
export function knowledgeSource(plugin:'zhihu'|'linkedin'|'reddit',value:string){
 const invalid=()=>Error(plugin==='reddit'?'Use a Reddit community or user homepage':plugin==='zhihu'?'Use a Zhihu author/organization homepage or https://daily.zhihu.com/':'Use a LinkedIn person, company, showcase or school homepage')
 if(plugin==='reddit'&&/^\/?(?:r|u|user)\//i.test(value))value='https://www.reddit.com/'+value.replace(/^\//,'')
 let url:URL;try{url=new URL(value)}catch{throw invalid()}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw invalid()
 const host=url.hostname.toLowerCase(),path=decodeURIComponent(url.pathname).replace(/\/+$/,'')
 if(plugin==='reddit'){
  if(!['reddit.com','www.reddit.com','old.reddit.com'].includes(host))throw invalid()
  const match=path.match(/^\/(r|u|user)\/([a-z\d_-]{2,30})(?:\/(?:new|hot|top|submitted))?$/i)
  if(!match||['all','popular','friends','mod'].includes(match[2].toLowerCase()))throw invalid()
  const kind=match[1].toLowerCase()==='r'?'r':'user',identity=kind+'/'+match[2].toLowerCase()
  return {identity,url:'https://www.reddit.com/'+identity+'/'}
 }
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
