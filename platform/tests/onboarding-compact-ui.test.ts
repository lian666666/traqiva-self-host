import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { ConnectionStatus,Session } from '../src/types';
import Onboarding from '../src/Onboarding';
import CompactAgentSetup from '../src/components/CompactAgentSetup';

const state=vi.hoisted(()=>({session:null as Session|null,status:null as ConnectionStatus|null,online:true,checking:false,error:''}));
vi.mock('../src/api',()=>({
  useApp:()=>({session:state.session,loading:false,error:'',reload:async()=>{},setProject:()=>{},notify:()=>{},project:state.session?.activeProject}),
  api:vi.fn(),json:vi.fn(),date:()=> 'Oct 21',
}));
vi.mock('../src/useConnectionStatus',()=>({useConnectionStatus:()=>({status:state.status,online:state.online,checking:state.checking,error:state.error,refresh:()=>{}})}));

function renderSetup(){return renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:['/onboarding']},createElement(Onboarding)));}
function primarySetup(html:string){return html.split('<details class="setup-more-options"')[0];}

beforeEach(()=>{
  vi.stubGlobal('location',{origin:'https://traqiva.example.test'});
  state.session={user:{id:'u-setup',name:'Alex',email:'alex@example.test'},workspace:null,projects:[{id:'project-test',name:'My project'}],activeProject:{id:'project-test',name:'My project'},setup:{stage:'connect',goals:['coding'],project_id:'project-test'},terms:{version:'test',accepted:true,accepted_at:'2026-10-21T12:00:00Z'}};
  state.status={connected:false,method:null,last_activity_at:null};state.online=true;state.checking=false;state.error='';
});

describe('Compact coding-agent onboarding',()=>{
  it('keeps one terminal block in the main view and puts longer setup options behind closed details',()=>{
    const html=renderSetup(),primary=primarySetup(html);
    expect(html).toContain('<details class="setup-more-options">');
    expect(html).not.toContain('<details class="setup-more-options" open');
    expect(primary.match(/class="code-block"/g)).toHaveLength(1);
    expect(primary).toContain('Set up your coding agent.');
    expect(primary).toContain('Waiting for your terminal');
    expect(primary).not.toContain('Create a project key');
    expect(primary).not.toContain('Let your AI handle setup');
    expect(html).toContain('Create a project key');
    expect(html).toContain('Copy setup prompt');
    expect(html).toContain('API / SDK');
  });

  it('requires real connection evidence before enabling continue and still allows skipping',()=>{
    const waiting=renderSetup();
    expect(waiting.match(/<button[^>]*disabled[^>]*>Continue to workspace/)).toBeTruthy();
    expect(waiting).toContain('Skip for now');
    state.status={connected:true,method:'project_key',last_activity_at:'2026-10-21T12:00:00Z'};
    const connected=renderSetup();
    expect(connected).toContain('Project connected');
    expect(connected.match(/<button[^>]*disabled[^>]*>Continue to workspace/)).toBeNull();
    expect(connected.match(/<button[^>]*>Continue to workspace/)).toBeTruthy();
  });

  it('keeps setup instructions and keys gated behind accepted terms',()=>{
    state.session!.terms!.accepted=false;
    state.status={connected:true,method:'traffic',last_activity_at:'2026-10-21T12:00:00Z'};
    const html=renderSetup();
    expect(html).toContain('Review your workspace terms');
    expect(html).not.toContain('Create a project key');
    expect(html).not.toContain('Continue to workspace');
    expect(html).not.toContain('traqiva connect');
  });

  it('keeps offline and retry feedback visible without claiming a connection',()=>{
    state.online=false;state.error='Connection check failed';
    const primary=primarySetup(renderSetup());
    expect(primary).toContain('You’re offline');
    expect(primary).toContain('Connection check failed');
    expect(primary).toContain('Try again');
    expect(primary).not.toContain('Project connected');
  });

  it('keeps the API connection example visible for an API-only setup goal',()=>{
    state.session!.setup!.goals=['observe'];
    const primary=primarySetup(renderSetup());
    expect(primary).toContain('Connect your application.');
    expect(primary).toContain('Point your API client to Traqiva');
    expect(primary).toContain('baseURL:');
  });

  it.each(['codex','claude'] as const)('uses the selected %s integration in one supported command sequence',assistant=>{
    const html=renderToStaticMarkup(createElement(CompactAgentSetup,{assistant,origin:'https://traqiva.example.test',projectId:'project-test'}));
    expect(html).toContain('npm install --global https://traqiva.example.test/cli.tgz');
    expect(html).toContain('traqiva connect --url https://traqiva.example.test --project project-test --key YOUR_PROJECT_KEY');
    expect(html).toContain('traqiva engine install --url https://traqiva.example.test');
    expect(html).toContain(`traqiva setup --agent ${assistant} --print`);
    expect(html).not.toContain('&lt;PRIVATE_PROJECT_KEY&gt;');
    expect(html).toContain(assistant==='codex'?'settings to Codex':'settings to Claude Code');
    expect(html).toContain('Tools run when called.');
  });
});
