import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Developers from '../src/pages/Developers';
import { filterSessions,sessionMetrics,sessionPage,type DeveloperSession } from '../src/pages/developerSessions';

const state=vi.hoisted(()=>({
  items:[] as Record<string,unknown>[],loading:false,error:'',truncated:false,paths:[] as string[],
}));
vi.mock('../src/api',async()=>{
  const actual=await vi.importActual<typeof import('../src/api')>('../src/api');
  const project={id:'project-real',name:'Real project'};
  return {...actual,useApp:()=>({project,session:{projects:[project]},notify:()=>{},setProject:()=>{}}),useResource:(path:string|null)=>{
    if(path)state.paths.push(path);
    return path?.startsWith('/api/developer-sessions')?{data:{items:state.items,range:{from:'2026-10-14T00:00:00.000Z',to:'2026-10-21T00:00:00.000Z'},truncated:state.truncated},loading:state.loading,error:state.error,refresh:()=>{}}:{data:{items:[]},loading:false,error:'',refresh:()=>{}};
  }};
});

describe('Session evidence calculations',()=>{
  it('keeps priced subtotals and their request coverage separate from missing cost and cache data',()=>{
    const items=[example('priced',{priced_cost_usd:.25,priced_requests:1}),example('unpriced',{requests:1,input_tokens:null,cached_tokens:null})] as DeveloperSession[];
    expect(sessionMetrics(items)).toEqual({sessions:2,requests:3,pricedRequests:1,cost:.25,cached:null,cacheRead:null});
    expect(sessionMetrics([])).toEqual({sessions:0,requests:0,pricedRequests:0,cost:null,cached:null,cacheRead:null});
  });

  it('calculates cache share only for fully reported input and cache usage',()=>{
    const items=[example('a'),example('b',{input_tokens:300,cached_tokens:75})] as DeveloperSession[];
    expect(sessionMetrics(items).cacheRead).toBe(25);
    expect(sessionMetrics(items).cached).toBe(100);
    expect(sessionMetrics([example('zero',{input_tokens:0,cached_tokens:0})] as DeveloperSession[]).cacheRead).toBeNull();
  });

  it('finds session IDs and model names case-insensitively and clamps stale page numbers',()=>{
    const items=[example('Explicit-Session-ID',{models:['Real-Model']})] as DeveloperSession[];
    expect(filterSessions(items,'explicit-session','')).toHaveLength(1);
    expect(filterSessions(items,'real-model','')).toHaveLength(1);
    expect(filterSessions(items,'','unrecorded-model')).toEqual([]);
    expect(sessionPage(items,'999')).toMatchObject({page:1,pages:1,start:1,end:1,hasPrevious:false,hasNext:false});
    expect(sessionPage(items,'-2')).toMatchObject({page:1});
    expect(sessionPage([],'2')).toMatchObject({page:1,start:0,end:0,hasPrevious:false,hasNext:false});
  });
});

function renderSessions(path='/app/developers'){return renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[path]},createElement(Developers)));}
const example=(id:string,extra:Record<string,unknown>={})=>({id,repository:null,models:['model-real'],started_at:'2026-10-21T10:00:00Z',last_at:'2026-10-21T10:01:00Z',requests:2,input_tokens:100,output_tokens:50,cached_tokens:25,priced_cost_usd:null,priced_requests:0,trace_ids:['trace-a','trace-b'],...extra});

beforeEach(()=>{state.items=[];state.loading=false;state.error='';state.truncated=false;state.paths=[];});

describe('Developer Sessions view',()=>{
  it('starts with session controls, four real-data metrics and an honest empty state',()=>{
    const html=renderSessions();
    expect(state.paths).toContain('/api/developer-sessions?project=project-real&days=7');
    expect(html).toContain('Search sessions');
    expect(html).toContain('No sessions in this window. Sessions appear when connected traffic includes a session ID.');
    expect(html).toContain('Personal key');expect(html).toContain('Delivery');
    expect(html).toContain('href="/app/connect?tab=cli"');
    expect(html.match(/class="developer-session-metric"/g)).toHaveLength(4);
    expect(html).not.toContain('Smaller context. A clear record.');
    expect(html).toContain('<details class="developer-local-compression">');
    expect(html).not.toContain('<details class="developer-local-compression" open');
  });

  it('preserves unknown price and cache instead of displaying invented zero measurements',()=>{
    state.items=[example('real-session',{input_tokens:null,cached_tokens:null})];
    const html=renderSessions();
    expect(html).toContain('real-session');
    expect(html).toContain('Not reported');
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('0%');
    expect(html).toContain('No priced requests');
    expect(html).toContain('Cache usage unavailable');
  });

  it('shows loading and errors distinctly from an empty successful result',()=>{
    state.loading=true;
    const loading=renderSessions();
    expect(loading).toContain('Loading sessions');
    expect(loading).not.toContain('No sessions in this window.');
    state.loading=false;state.error='Session traffic could not be loaded';
    const failed=renderSessions();
    expect(failed).toContain('Session traffic could not be loaded');
    expect(failed).toContain('Try again');
    expect(failed).not.toContain('No sessions in this window.');
  });

  it('uses the selected date window in the actual resource path',()=>{
    renderSessions('/app/developers?days=30');
    expect(state.paths).toContain('/api/developer-sessions?project=project-real&days=30');
    state.paths=[];renderSessions('/app/developers?days=999');
    expect(state.paths).toContain('/api/developer-sessions?project=project-real&days=7');
  });

  it('searches explicit session IDs, repositories and models and applies real model filtering',()=>{
    state.items=[example('session-alpha',{repository:'team/api',models:['model-alpha']}),example('session-beta',{repository:'team/web',models:['model-beta']})];
    const byRepo=renderSessions('/app/developers?search=TEAM%2FAPI');
    expect(byRepo).toContain('session-alpha');expect(byRepo).not.toContain('<code title="session-beta"');
    const byModel=renderSessions('/app/developers?model=model-beta');
    expect(byModel).toContain('session-beta');expect(byModel).not.toContain('<code title="session-alpha"');
    const none=renderSessions('/app/developers?search=not-present');
    expect(none).toContain('No sessions match these filters.');
  });

  it('paginates session rows and bounds previous/next navigation',()=>{
    state.items=Array.from({length:21},(_,index)=>example(`session-${String(index+1).padStart(2,'0')}`));
    const first=renderSessions();
    expect(first).toContain('1–20 of 21 sessions');expect(first).not.toContain('<code title="session-21"');
    expect(first).toMatch(/aria-label="Previous page"[^>]*disabled/);
    const last=renderSessions('/app/developers?page=2');
    expect(last).toContain('21–21 of 21 sessions');expect(last).toContain('<code title="session-21"');
    expect(last).toMatch(/aria-label="Next page"[^>]*disabled/);
  });

  it('warns when the bounded request sample can make session totals incomplete',()=>{
    state.items=[example('session-partial')];state.truncated=true;
    const html=renderSessions();
    expect(html).toContain('Session totals may be incomplete.');
  });
});
