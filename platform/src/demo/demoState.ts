import { demoAnchor,demoBriefs,demoCases,demoNotifications,demoTraces,type DemoCase,type DemoTrace,type DemoView } from './demoData';
export type { DemoView } from './demoData';
export type DemoState={
  view:DemoView;days:7|30;query:string;model:string;status:''|'success'|'error';traceSort:'newest'|'cost'|'tokens';
  selectedTrace:string|null;traceTab:'request'|'response';selectedBrief:string;briefStatus:Record<string,'open'|'reviewed'|'dismissed'>;keyVisible:boolean;
  evaluationCases:DemoCase[];evaluationResults:{id:string;pass:boolean}[]|null;caseSensitive:boolean;
  budget:number;retention:number;maskEmails:boolean;blockSecrets:boolean;projectName:string;theme:'light'|'dark';question:string;answer:string;notifications:string[];reviewedTraces:string[];monitorThreshold:number;scenario:string;
};
type SetAction={[Key in keyof DemoState]:{type:'set';key:Key;value:DemoState[Key]}}[keyof DemoState];
export type DemoAction=SetAction|{type:'navigate';view:DemoView}|{type:'review-brief';id:string;status:'open'|'reviewed'|'dismissed'}|{type:'run-evaluation'}|{type:'case-update';id:string;field:'input'|'expected'|'actual';value:string}|{type:'case-add'}|{type:'dismiss-notification';id:string}|{type:'review-trace';id:string}|{type:'reset'};

export function createDemoState():DemoState{
  return {view:'home',days:30,query:'',model:'',status:'',traceSort:'newest',selectedTrace:null,traceTab:'request',selectedBrief:demoBriefs[0].id,briefStatus:Object.fromEntries(demoBriefs.map(brief=>[brief.id,'open'])),keyVisible:false,evaluationCases:demoCases.map(item=>({...item})),evaluationResults:null,caseSensitive:true,budget:250,retention:30,maskEmails:true,blockSecrets:true,projectName:'Northstar Demo',theme:'light',question:'',answer:'',notifications:demoNotifications.map(item=>item.id),reviewedTraces:[],monitorThreshold:1500,scenario:'support'};
}

export function demoReducer(state:DemoState,action:DemoAction):DemoState{
  switch(action.type){
    case 'reset':return createDemoState();
    case 'set':return {...state,[action.key]:action.value,...(action.key==='caseSensitive'||action.key==='evaluationCases'?{evaluationResults:null}:{})};
    case 'navigate':return {...state,view:action.view,selectedTrace:null};
    case 'review-brief':return demoBriefs.some(brief=>brief.id===action.id)?{...state,briefStatus:{...state.briefStatus,[action.id]:action.status}}:state;
    case 'case-update':return {...state,evaluationCases:state.evaluationCases.map(item=>item.id===action.id?{...item,[action.field]:action.value}:item),evaluationResults:null};
    case 'case-add':{
      let next=state.evaluationCases.length+1;while(state.evaluationCases.some(item=>item.id===`demo-case-${next}`))next++;
      return {...state,evaluationCases:[...state.evaluationCases,{id:`demo-case-${next}`,input:'',expected:'',actual:''}],evaluationResults:null};
    }
    case 'run-evaluation':return {...state,evaluationResults:state.evaluationCases.map(item=>({id:item.id,pass:!!item.input&&!!item.expected&&!!item.actual&&(state.caseSensitive?item.expected===item.actual:item.expected.toLocaleLowerCase('en')===item.actual.toLocaleLowerCase('en'))}))};
    case 'dismiss-notification':return {...state,notifications:state.notifications.filter(id=>id!==action.id)};
    case 'review-trace':return demoTraces.some(trace=>trace.id===action.id)&&!state.reviewedTraces.includes(action.id)?{...state,reviewedTraces:[...state.reviewedTraces,action.id]}:state;
  }
}

function periodTraces(days:7|30):DemoTrace[]{
  const end=Date.parse(demoAnchor),start=Date.parse(`${demoAnchor.slice(0,10)}T00:00:00.000Z`)-(days-1)*86400000;
  return demoTraces.filter(trace=>Date.parse(trace.startedAt)>=start&&Date.parse(trace.startedAt)<=end);
}
export function filteredDemoTraces(state:DemoState):DemoTrace[]{
  const query=state.query.trim().toLocaleLowerCase('en');
  return periodTraces(state.days).filter(trace=>(!state.model||trace.model===state.model)&&(!state.status||trace.status===state.status)&&(!query||[trace.id,trace.model,trace.provider,trace.workflow,trace.repository,trace.sessionId].some(value=>value.toLocaleLowerCase('en').includes(query)))).sort((a,b)=>state.traceSort==='cost'?b.cost-a.cost||b.startedAt.localeCompare(a.startedAt):state.traceSort==='tokens'?(b.inputTokens+b.outputTokens)-(a.inputTokens+a.outputTokens)||b.startedAt.localeCompare(a.startedAt):b.startedAt.localeCompare(a.startedAt));
}
export type DemoSummary={requests:number;inputTokens:number;outputTokens:number;cachedTokens:number;cachePercent:number|null;cost:number;errors:number;successPercent:number|null;avgLatencyMs:number|null;models:{model:string;requests:number;tokens:number;cost:number}[];openBriefs:number;possibleSavings:null};
export function demoSummary(state:DemoState):DemoSummary{
  const traces=filteredDemoTraces(state),inputTokens=traces.reduce((total,trace)=>total+trace.inputTokens,0),outputTokens=traces.reduce((total,trace)=>total+trace.outputTokens,0),cachedTokens=traces.reduce((total,trace)=>total+trace.cachedTokens,0),errors=traces.filter(trace=>trace.status==='error').length;
  const models=[...new Set(traces.map(trace=>trace.model))].map(model=>{const matching=traces.filter(trace=>trace.model===model);return {model,requests:matching.length,tokens:matching.reduce((total,trace)=>total+trace.inputTokens+trace.outputTokens,0),cost:matching.reduce((total,trace)=>total+trace.cost,0)};}).sort((a,b)=>b.tokens-a.tokens);
  return {requests:traces.length,inputTokens,outputTokens,cachedTokens,cachePercent:inputTokens?cachedTokens/inputTokens*100:null,cost:traces.reduce((total,trace)=>total+trace.cost,0),errors,successPercent:traces.length?(traces.length-errors)/traces.length*100:null,avgLatencyMs:traces.length?traces.reduce((total,trace)=>total+trace.latencyMs,0)/traces.length:null,models,openBriefs:demoBriefs.filter(brief=>state.briefStatus[brief.id]==='open').length,possibleSavings:null};
}

export function demoSeries(days:7|30):{date:string;requests:number;tokens:number;cost:number;cachedPercent:number|null}[]{
  const traces=periodTraces(days),end=Date.parse(`${demoAnchor.slice(0,10)}T00:00:00.000Z`);
  return Array.from({length:days},(_,index)=>{
    const date=new Date(end-(days-index-1)*86400000).toISOString().slice(0,10),matching=traces.filter(trace=>trace.startedAt.startsWith(date));
    const input=matching.reduce((total,trace)=>total+trace.inputTokens,0),cached=matching.reduce((total,trace)=>total+trace.cachedTokens,0);
    return {date,requests:matching.length,tokens:matching.reduce((total,trace)=>total+trace.inputTokens+trace.outputTokens,0),cost:matching.reduce((total,trace)=>total+trace.cost,0),cachedPercent:input?cached/input*100:null};
  });
}

export function demoAnswer(question:string):string{
  const text=question.trim().toLocaleLowerCase('en'),summary=demoSummary(createDemoState());
  if(/model|tokens?/.test(text))return `${summary.models[0].model} has the largest token total in this fictional dataset: ${summary.models[0].tokens.toLocaleString('en')} tokens. Compare the model breakdown in Analytics; these are sample records, not a benchmark.`;
  if(/cost|spend|spent/.test(text))return `The 60 fictional request records sum to $${summary.cost.toFixed(2)} in sample cost. Analytics and Traces use the same records. This is demonstration arithmetic, not your spending or a provider invoice.`;
  if(/improve|investigate|save|saving|workflow/.test(text))return `Start with the ${summary.errors} simulated failures and the largest input blocks. Three sample briefs explain what to inspect. This fictional tour has no comparable savings baseline, so it does not claim verified monetary savings.`;
  return 'This demonstration answers preset questions about its fictional dataset. Try a sample question about cost, models or improvement briefs. No model receives your question.';
}
