export type DeveloperSession={
  id:string;repository:string|null;models:string[];started_at:string;last_at:string;
  requests:number;input_tokens:number|null;output_tokens:number|null;cached_tokens:number|null;
  priced_cost_usd:number|null;priced_requests:number;trace_ids:string[];
};
export type DeveloperSessionsResponse={items:DeveloperSession[];range:{from:string;to:string}|null;truncated:boolean};
export type SessionColumn='repository'|'models'|'requests'|'cost'|'activity';
export const sessionColumns:{id:SessionColumn;label:string}[]=[{id:'repository',label:'Repository'},{id:'models',label:'Models'},{id:'requests',label:'Requests'},{id:'cost',label:'Priced cost'},{id:'activity',label:'Last activity'}];

export function sessionDays(value:string|null){return value==='30'||value==='90'?value:'7';}
export function sessionsResource(projectId:string|undefined,days:string){return projectId?`/api/developer-sessions?project=${encodeURIComponent(projectId)}&days=${sessionDays(days)}`:null;}
export function filterSessions(items:DeveloperSession[],search:string,model:string){
  const query=search.trim().toLocaleLowerCase();
  return items.filter(item=>(!model||item.models.includes(model))&&(!query||[item.id,item.repository??'',...item.models].some(value=>value.toLocaleLowerCase().includes(query))));
}
export function sessionMetrics(items:DeveloperSession[]){
  const requests=items.reduce((sum,item)=>sum+item.requests,0),pricedRequests=items.reduce((sum,item)=>sum+item.priced_requests,0);
  const cost=items.reduce((sum,item)=>sum+(item.priced_cost_usd??0),0);
  const cacheKnown=items.length>0&&items.every(item=>item.input_tokens!==null&&item.cached_tokens!==null);
  const input=cacheKnown?items.reduce((sum,item)=>sum+item.input_tokens!,0):null;
  const cached=cacheKnown?items.reduce((sum,item)=>sum+item.cached_tokens!,0):null;
  return {sessions:items.length,requests,pricedRequests,cost:pricedRequests>0?cost:null,cached,cacheRead:input!==null&&input>0&&cached!==null?cached/input*100:null};
}
export function sessionPage(items:DeveloperSession[],requestedPage:string|null,pageSize=20){
  const total=items.length,pages=Math.max(1,Math.ceil(total/pageSize));
  const numeric=Number(requestedPage),page=Number.isSafeInteger(numeric)&&numeric>0?Math.min(numeric,pages):1;
  const start=total?(page-1)*pageSize+1:0,end=Math.min(page*pageSize,total);
  return {page,pages,start,end,total,items:items.slice((page-1)*pageSize,page*pageSize),hasPrevious:page>1,hasNext:page<pages};
}
