import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import Shell from '../src/Shell';

const state=vi.hoisted(()=>({connected:false}));
vi.mock('../src/api',()=>({
  useApp:()=>({session:{user:{name:'Alex',email:'alex@example.invalid'},workspace:{name:'Studio'},projects:[{id:'p',name:'Default'}],setup:{project_id:'p'},terms:{accepted:true}},project:{id:'p',name:'Default'},setProject:vi.fn(),reload:vi.fn(),notify:vi.fn()}),
  api:vi.fn(),json:vi.fn(),
}));
vi.mock('../src/useConnectionStatus',()=>({useConnectionStatus:()=>({status:{connected:state.connected,method:state.connected?'project_key':null,last_activity_at:null},checking:false,error:'',online:true})}));
const render=(path='/app/developers/sessions')=>renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[path]},createElement(Shell)));
beforeEach(()=>{state.connected=false;});

describe('Reference workspace layout',()=>{
  it('shows all four product options directly, with the deferred Evals option disabled',()=>{
    const html=render();
    expect(html).toContain('aria-label="Products"');
    expect(html).toContain('Observability');
    expect(html).toContain('Developer insights');
    expect(html).toContain('Admin');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Evals[\s\S]*?Coming soon/);
    expect(html).not.toContain('Switch product.');
    expect(html).toContain('Ask Traqiva');
    expect(html).toContain('Inbox');
  });
  it('uses Developers / Sessions and the developer work/tools navigation',()=>{
    const html=render();
    expect(html).toContain('<span>Developers</span>');
    expect(html).toContain('<strong>Sessions</strong>');
    expect(html).toContain('href="/app/developers/sessions"');
    expect(html).toContain('href="/app/developers/usage"');
    expect(html).toContain('Repositories');
    expect(html).toContain('Delivery');
    expect(html).not.toContain('href="/app/developers/repositories"');
    expect(html).not.toContain('href="/app/developers/delivery"');
  });
  it('keeps recorded-traffic tools available without activating the deferred builder product',()=>{
    const html=render('/app/gateway');
    expect(html).not.toContain('Agents you build');
    expect(html).not.toContain('href="/app/evals"');
    expect(html).toContain('href="/app/traces"');
    expect(html).toContain('href="/app/dashboards"');
    expect(html).toContain('href="/app/controls"');
    expect(html).toContain('<strong>Project keys</strong>');
  });
  it('uses the Agent usage title and a focused Admin sidebar',()=>{
    expect(render('/app/developers/usage')).toContain('<strong>Agent usage</strong>');
    const admin=render('/app/admin');
    expect(admin).toContain('Governance');
    expect(admin).toContain('<strong>Settings</strong>');
    expect(admin).not.toContain('reference-group-traffic');
  });
  it('shows setup progress from project and real connection evidence',()=>{
    expect(render()).toContain('1 of 2');
    state.connected=true;
    const connected=render();
    expect(connected).toContain('2 of 2');
    expect(connected).toContain('Project connected');
    expect(connected).not.toContain('MCP connected');
  });
});
