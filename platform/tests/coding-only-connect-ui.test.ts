import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,describe,expect,it,vi } from 'vitest';
import Connect from '../src/pages/Connect';

vi.mock('../src/api',()=>({useApp:()=>({project:{id:'coding-project',name:'Coding work'},reload:vi.fn()}),api:vi.fn(),json:vi.fn()}));
afterEach(()=>vi.unstubAllGlobals());
describe('Coding-only connection guide',()=>{
  it.each(['','?tab=api'])('keeps a %s bookmark on coding setup while application building is deferred',search=>{
    vi.stubGlobal('location',{origin:'https://app.test',search});
    const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Connect)));
    expect(html).toContain('Connect your coding agent');
    expect(html).toContain('Install the Traqiva CLI');
    expect(html).not.toContain('API / SDK');
    expect(html).not.toContain('Point your client to Traqiva');
    expect(html).not.toContain('import OpenAI');
  });
});
