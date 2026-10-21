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
  it('shows the active product and its description directly in the sidebar',()=>{
    const html=render();
    expect(html).toContain('Switch product. Current product: Developer insights');
    expect(html).toContain('Coding agents you use');
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
  it('keeps observability routes available outside the developer product',()=>{
    const html=render('/app/gateway');
    expect(html).toContain('Agents you build');
    expect(html).toContain('href="/app/traces"');
    expect(html).toContain('href="/app/dashboards"');
    expect(html).toContain('<strong>Gateway</strong>');
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
