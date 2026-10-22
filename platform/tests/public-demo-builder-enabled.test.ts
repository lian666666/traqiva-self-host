import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {describe,expect,it,vi} from 'vitest';

vi.mock('../src/features/agentBuilder',()=>({AGENT_BUILDER_ENABLED:true,ONBOARDING_FLOW_VERSION:2}));

import InteractiveDemo from '../src/demo/InteractiveDemo';
import {createDemoState,demoReducer} from '../src/demo/demoState';
import {DemoTraffic} from '../src/demo/DemoTraffic';
import {DemoWorkspace} from '../src/demo/DemoWorkspace';

describe('Deferred builder demo remains independently available for a future release',()=>{
  it('retains explicit builder modules and direct module navigation when enabled',()=>{
    const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(InteractiveDemo)));
    for(const name of ['Experiments','Datasets','Scorers','Try a quality check'])expect(html).toContain(name);
    for(const view of ['experiments','datasets','scorers','monitors','reviews','scenarios','quality-gates'] as const){
      const direct=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(InteractiveDemo,{initialView:view})));
      expect(direct).not.toContain('Good morning, Demo');
      expect(demoReducer(createDemoState(),{type:'navigate',view}).view).toBe(view);
    }
    expect(createDemoState().notifications).toHaveLength(3);
  });
  it('retains evaluation next steps, quality dashboards and SDK previews when enabled',()=>{
    const state=createDemoState();
    const render=(component:typeof DemoTraffic|typeof DemoWorkspace,view:typeof state.view)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(component,{state:{...state,view},dispatch:()=>{},go:()=>{}})));
    expect(render(DemoWorkspace,'improvements')).toContain('Test a change');
    expect(render(DemoTraffic,'gateway')).toContain('Connect an SDK');
    expect(render(DemoTraffic,'dashboards')).toContain('>Quality<');
    const results=demoReducer(state,{type:'run-evaluation'}).evaluationResults;
    expect(results?.map(result=>result.pass)).toEqual([true,true,false]);
  });
});
