/** Isolated, fictional examples for the public product tour. Never customer traffic. */
export type DemoView='home'|'gateway'|'analytics'|'traces'|'dashboards'|'improvements'|'experiments'|'datasets'|'scorers'|'monitors'|'reviews'|'scenarios'|'quality-gates'|'governance'|'settings'|'sessions'|'ask'|'inbox';
export type DemoTrace={
  id:string;workflow:string;model:string;provider:string;status:'success'|'error';inputTokens:number;outputTokens:number;cachedTokens:number;cost:number;latencyMs:number;startedAt:string;sessionId:string;repository:string;request:Record<string,unknown>;response:Record<string,unknown>;
};
export type DemoBrief={id:string;title:string;summary:string;evidence:string;nextStep:string;potentialDaily:number|null;kind:string};
export type DemoCase={id:string;input:string;expected:string;actual:string};
export type DemoNotification={id:string;title:string;body:string;view:DemoView};

function freeze<T>(value:T):Readonly<T>{
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const demoAnchor='2026-10-21T18:00:00.000Z';
const anchorDay=Date.parse('2026-10-21T00:00:00.000Z');
const workflows=['Support assistant','Invoice extraction','Knowledge search','Release summary'];
const models=['atlas-small','atlas-balanced','atlas-reasoning'];
const scenarios=[
  {input:'Where is my sample order DEMO-1042?',output:'The sample order is in transit. This is a fictional demonstration response.'},
  {input:'Extract the total from sample invoice DEMO-082: EUR 184.50.',output:'{"currency":"EUR","total":184.50}'},
  {input:'Find the retention rule in the fictional Northstar handbook.',output:'The sample handbook retains request metadata for 30 days.'},
  {input:'Summarize the fictional release notes for v0.8.',output:'The sample release adds project-level filters and a clearer request timeline.'},
];

export const demoTraces:readonly DemoTrace[]=freeze(Array.from({length:60},(_,index)=>{
  const day=Math.floor(index/2),variant=index%2,modelIndex=index%models.length;
  const inputTokens=1800+(index%9)*740+(modelIndex===2?2600:0);
  const outputTokens=140+(index%7)*56;
  const cachedTokens=index%5===0?0:Math.floor(inputTokens*(.32+(index%4)*.13));
  const status=index%17===0?'error' as const:'success' as const;
  const scenario=scenarios[index%scenarios.length];
  const cost=Number(((inputTokens-cachedTokens)*.0000012*(modelIndex+1)+cachedTokens*.0000003*(modelIndex+1)+outputTokens*.000004*(modelIndex+1)).toFixed(6));
  return {
    id:`demo-trace-${String(index+1).padStart(3,'0')}`,
    workflow:workflows[index%workflows.length],model:models[modelIndex],provider:'Fictional provider',status,
    inputTokens,outputTokens,cachedTokens,cost,latencyMs:status==='error'?2400:420+(index%11)*115+modelIndex*290,
    startedAt:new Date(anchorDay-(29-day)*86400000+(variant?15:9)*3600000).toISOString(),
    sessionId:`demo-session-${String(Math.floor(index/5)+1).padStart(2,'0')}`,repository:'northstar-demo/assistant',
    request:{model:models[modelIndex],messages:[{role:'system',content:'You are a fictional support assistant in the Traqiva interactive demo. These records are synthetic.'},{role:'user',content:scenario.input}],metadata:{session_id:`demo-session-${String(Math.floor(index/5)+1).padStart(2,'0')}`,demo:true}},
    response:status==='error'?{error:{type:'sample_rate_limit',message:'Simulated rate-limit response; no provider was contacted.'}}:{message:{role:'assistant',content:scenario.output},usage:{input_tokens:inputTokens,output_tokens:outputTokens,cached_tokens:cachedTokens},demo:true},
  };
}));

export const demoModels:readonly string[]=freeze([...new Set(demoTraces.map(trace=>trace.model))]);
export const demoBriefs:readonly DemoBrief[]=freeze([
  {id:'demo-brief-retries',title:'Give repeated failures a retry boundary',summary:'Four sample requests ended in the same simulated rate-limit response.',evidence:'In this fictional 60-request dataset, 4 requests have an error status. Inspect those traces before changing a retry policy.',nextStep:'Review the failed samples, then compare a bounded backoff policy against the same evaluation cases.',potentialDaily:null,kind:'Reliability'},
  {id:'demo-brief-context',title:'Review the largest context blocks',summary:'Some requests carry materially more input than the rest of the sample workload.',evidence:'The atlas-reasoning examples include an additional 2,600 input tokens. This is fixture design, not proof that those tokens can safely be removed.',nextStep:'Inspect the request payload and test a smaller context against the expected outputs before applying a change.',potentialDaily:null,kind:'Input efficiency'},
  {id:'demo-brief-cache',title:'Check which prefixes could remain stable',summary:'Cache usage varies across the sample requests.',evidence:'Sample records explicitly report both input and cached token counts. The chart derives its share from those same counts.',nextStep:'Compare stable prefixes and their reported usage. A cache percentage alone does not establish invoice savings.',potentialDaily:null,kind:'Cache visibility'},
]);

export const demoCases:readonly DemoCase[]=freeze([
  {id:'demo-case-1',input:'Return the sample order status only.',expected:'In transit',actual:'In transit'},
  {id:'demo-case-2',input:'Return the currency code from the sample invoice.',expected:'EUR',actual:'EUR'},
  {id:'demo-case-3',input:'Return the sample retention window, in days.',expected:'30',actual:'30 days'},
]);
export const demoQuestions:readonly string[]=freeze(['How much did this demo spend?','Which models use the most tokens?','Where can we improve this workflow?']);
export const demoNotifications:readonly DemoNotification[]=freeze([
  {id:'demo-notice-brief',title:'Three sample briefs are ready',body:'Explore the evidence and mark a suggestion as reviewed. Changes stay in this demo.',view:'improvements'},
  {id:'demo-notice-quality',title:'One sample answer needs a closer look',body:'The retention case returns an extra word. Run the exact-match check to inspect the mismatch.',view:'experiments'},
  {id:'demo-notice-trace',title:'A simulated request failed',body:'Filter the traces by error to inspect the fictional rate-limit response.',view:'traces'},
]);
