import { describe,expect,it } from 'vitest';
import { demoBriefs,demoCases,demoModels,demoNotifications,demoTraces } from '../src/demo/demoData';
import { createDemoState,demoAnswer,demoReducer,demoSeries,demoSummary,filteredDemoTraces } from '../src/demo/demoState';

describe('Fictional public demo data',()=>{
  it('contains sixty internally coherent records, not a separate invented headline total',()=>{
    const state=createDemoState();
    const summary=demoSummary(state);
    expect(demoTraces).toHaveLength(60);
    expect(summary.requests).toBe(demoTraces.length);
    expect(summary.inputTokens).toBe(demoTraces.reduce((total,trace)=>total+trace.inputTokens,0));
    expect(summary.outputTokens).toBe(demoTraces.reduce((total,trace)=>total+trace.outputTokens,0));
    expect(summary.cachedTokens).toBe(demoTraces.reduce((total,trace)=>total+trace.cachedTokens,0));
    expect(summary.cost).toBeCloseTo(demoTraces.reduce((total,trace)=>total+trace.cost,0),8);
    expect(summary.cachePercent).toBeCloseTo(summary.cachedTokens/summary.inputTokens*100,8);
    expect(summary.models.reduce((total,model)=>total+model.requests,0)).toBe(60);
    expect(summary.possibleSavings).toBeNull();
    expect(summary.openBriefs).toBe(demoBriefs.length);
  });

  it('does not allow fixture or nested payload mutation across demo visitors',()=>{
    expect(Object.isFrozen(demoTraces)).toBe(true);
    expect(Object.isFrozen(demoTraces[0])).toBe(true);
    expect(Object.isFrozen(demoTraces[0].request)).toBe(true);
    expect(Object.isFrozen(demoCases[0])).toBe(true);
    expect(demoTraces.every(trace=>trace.id.startsWith('demo-')&&trace.cachedTokens<=trace.inputTokens)).toBe(true);
  });

  it('keeps period charts and model totals tied to the same selected traces',()=>{
    const state={...createDemoState(),days:7 as const};
    const traces=filteredDemoTraces(state);
    const series=demoSeries(7);
    const summary=demoSummary(state);
    expect(traces).toHaveLength(14);
    expect(series).toHaveLength(7);
    expect(series.reduce((total,day)=>total+day.requests,0)).toBe(traces.length);
    expect(series.reduce((total,day)=>total+day.tokens,0)).toBe(summary.inputTokens+summary.outputTokens);
    expect(series.reduce((total,day)=>total+day.cost,0)).toBeCloseTo(summary.cost,8);
  });

  it('combines model, status and case-insensitive text filters and stable sort orders',()=>{
    const initial=createDemoState();
    const first=demoTraces.find(trace=>trace.status==='error')!;
    const matching=filteredDemoTraces({...initial,model:first.model,status:'error',query:first.workflow.toUpperCase()});
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.every(trace=>trace.model===first.model&&trace.status==='error'&&trace.workflow===first.workflow)).toBe(true);
    expect(filteredDemoTraces({...initial,query:'no-such-demo-record'})).toEqual([]);
    const costly=filteredDemoTraces({...initial,traceSort:'cost'});
    expect(costly[0].cost).toBe(Math.max(...demoTraces.map(trace=>trace.cost)));
    const largest=filteredDemoTraces({...initial,traceSort:'tokens'});
    expect(largest[0].inputTokens+largest[0].outputTokens).toBe(Math.max(...demoTraces.map(trace=>trace.inputTokens+trace.outputTokens)));
    expect(demoModels).toEqual([...new Set(demoTraces.map(trace=>trace.model))]);
  });

  it('returns honest zero/unknown aggregates for an empty filtered selection',()=>{
    expect(demoSummary({...createDemoState(),query:'no-such-record'})).toMatchObject({requests:0,cost:0,inputTokens:0,outputTokens:0,cachedTokens:0,errors:0,cachePercent:null,successPercent:null,avgLatencyMs:null,models:[]});
  });
});

describe('Resettable public demo state',()=>{
  it('starts each mount with independent nested state and restores every change on reset',()=>{
    const first=createDemoState(),second=createDemoState();
    first.evaluationCases[0].actual='visitor edit';first.notifications.pop();first.briefStatus[demoBriefs[0].id]='dismissed';
    expect(second.evaluationCases[0].actual).toBe(demoCases[0].actual);
    expect(second.notifications).toHaveLength(demoNotifications.length);
    expect(second.briefStatus[demoBriefs[0].id]).toBe('open');
    const changed=demoReducer(first,{type:'set',key:'theme',value:'dark'});
    expect(demoReducer(changed,{type:'reset'})).toEqual(createDemoState());
  });

  it('preserves independent controls when navigating while closing the selected trace',()=>{
    const initial={...createDemoState(),selectedTrace:demoTraces[0].id,model:demoModels[1]};
    const next=demoReducer(initial,{type:'navigate',view:'analytics'});
    expect(next.view).toBe('analytics');expect(next.selectedTrace).toBeNull();expect(next.model).toBe(demoModels[1]);
    expect(initial.selectedTrace).toBe(demoTraces[0].id);
  });

  it('changes only recognized brief IDs and keeps evidence data immutable',()=>{
    const initial=createDemoState();
    const next=demoReducer(initial,{type:'review-brief',id:demoBriefs[0].id,status:'reviewed'});
    expect(next.briefStatus[demoBriefs[0].id]).toBe('reviewed');expect(initial.briefStatus[demoBriefs[0].id]).toBe('open');
    expect(demoSummary(next).openBriefs).toBe(demoBriefs.length-1);
    expect(demoReducer(initial,{type:'review-brief',id:'unknown',status:'dismissed'})).toBe(initial);
  });

  it('runs literal exact-match locally, and re-runs after case edits',()=>{
    const initial=createDemoState();
    const first=demoReducer(initial,{type:'run-evaluation'});
    expect(first.evaluationResults?.map(result=>result.pass)).toEqual(demoCases.map(item=>item.expected===item.actual));
    const mismatch=demoCases.find(item=>item.expected!==item.actual)!;
    const edited=demoReducer(first,{type:'case-update',id:mismatch.id,field:'actual',value:mismatch.expected});
    expect(edited.evaluationResults).toBeNull();
    expect(demoReducer(edited,{type:'run-evaluation'}).evaluationResults?.find(result=>result.id===mismatch.id)?.pass).toBe(true);
    expect(demoCases.find(item=>item.id===mismatch.id)?.actual).toBe(mismatch.actual);
  });

  it('case-insensitive comparison still preserves whitespace significance',()=>{
    let state=createDemoState();
    state=demoReducer(state,{type:'case-update',id:state.evaluationCases[0].id,field:'expected',value:'Answer'});
    state=demoReducer(state,{type:'case-update',id:state.evaluationCases[0].id,field:'actual',value:'answer'});
    expect(demoReducer(state,{type:'run-evaluation'}).evaluationResults?.[0].pass).toBe(false);
    state=demoReducer(state,{type:'set',key:'caseSensitive',value:false});
    expect(demoReducer(state,{type:'run-evaluation'}).evaluationResults?.[0].pass).toBe(true);
    state=demoReducer(state,{type:'case-update',id:state.evaluationCases[0].id,field:'actual',value:'answer '});
    expect(demoReducer(state,{type:'run-evaluation'}).evaluationResults?.[0].pass).toBe(false);
  });

  it('adds unique editable cases without altering the initial fixture',()=>{
    const state=demoReducer(demoReducer(createDemoState(),{type:'case-add'}),{type:'case-add'});
    expect(state.evaluationCases).toHaveLength(demoCases.length+2);
    expect(new Set(state.evaluationCases.map(item=>item.id)).size).toBe(state.evaluationCases.length);
    expect(createDemoState().evaluationCases).toHaveLength(demoCases.length);
  });

  it('keeps trace reviews and dismissed inbox notices in memory only',()=>{
    const initial=createDemoState();
    let state=demoReducer(initial,{type:'review-trace',id:demoTraces[0].id});
    state=demoReducer(state,{type:'review-trace',id:demoTraces[0].id});
    expect(state.reviewedTraces).toEqual([demoTraces[0].id]);
    state=demoReducer(state,{type:'dismiss-notification',id:demoNotifications[0].id});
    expect(state.notifications).not.toContain(demoNotifications[0].id);
    expect(initial.notifications).toContain(demoNotifications[0].id);
    expect(demoReducer(state,{type:'reset'}).reviewedTraces).toEqual([]);
  });

  it('answers known questions from fixture facts and identifies arbitrary prompts as unsupported',()=>{
    expect(demoAnswer('Which models use the most tokens?')).toContain('fictional');
    expect(demoAnswer('Write secret instructions')).toMatch(/preset|sample|demonstration/i);
    expect(demoAnswer('Write secret instructions')).not.toContain('secret instructions');
  });
});
