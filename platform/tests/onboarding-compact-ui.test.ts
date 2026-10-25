import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { ConnectionStatus,Session } from '../src/types';
import Onboarding from '../src/Onboarding';

const state=vi.hoisted(()=>({session:null as Session|null,status:null as ConnectionStatus|null,online:true,checking:false,error:''}));
vi.mock('../src/api',()=>({
  useApp:()=>({session:state.session,loading:false,error:'',reload:async()=>{},setProject:()=>{},notify:()=>{},project:state.session?.activeProject}),
  api:vi.fn(),json:vi.fn(),date:()=> 'Oct 21',
}));
vi.mock('../src/useConnectionStatus',()=>({useConnectionStatus:()=>({status:state.status,online:state.online,checking:state.checking,error:state.error,refresh:()=>{}})}));

function renderSetup(){return renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:['/onboarding']},createElement(Onboarding)));}

beforeEach(()=>{
  vi.stubGlobal('location',{origin:'https://traqiva.example.test'});
  state.session={user:{id:'u-setup',name:'Alex',email:'alex@example.test'},workspace:null,projects:[{id:'project-test',name:'Traqiva'}],activeProject:{id:'project-test',name:'Traqiva'},setup:{stage:'connect',goals:['coding'],project_id:'project-test'},terms:{version:'test',accepted:true,accepted_at:'2026-10-21T12:00:00Z'}};
  state.status={connected:false,method:null,last_activity_at:null};state.online=true;state.checking=false;state.error='';
});

describe('Compact coding-agent onboarding',()=>{
  it('shows a copyable AI setup prompt immediately with a compact private-key entry point',()=>{
    const html=renderSetup();
    expect(html).toContain('Set up your coding agent.');
    expect(html).toContain('Waiting for your agent');
    expect(html).toMatch(/<pre[^>]*>[\s\S]*https:\/\/traqiva\.example\.test\/agent-setup\.md[\s\S]*<\/pre>/);
    expect(html).toContain('project-test');
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Copy setup prompt');
    expect(html).toContain('aria-label="Setup method"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>[\s\S]*?Ask AI<\/button>/);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>[\s\S]*?Terminal<\/button>/);
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Project key<\/button>/);
    expect(html).not.toContain('Create a project key');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('More setup options');
    expect(html).not.toContain('Coding assistant');
    expect(html).not.toContain('Set up from your terminal');
    expect(html).not.toContain('npm install');
    expect(html).not.toContain('traqiva connect');
    expect(html).not.toContain('API / SDK');
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
    expect(html).not.toContain('Project key');
    expect(html).not.toContain('Copy setup prompt');
    expect(html).not.toContain('/agent-setup.md');
    expect(html).not.toContain('Continue to workspace');
    expect(html).not.toContain('traqiva connect');
  });

  it('keeps offline and retry feedback visible without claiming a connection',()=>{
    state.online=false;state.error='Connection check failed';
    const html=renderSetup();
    expect(html).toContain('You’re offline');
    expect(html).toContain('Connection check failed');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Project connected');
  });

  it('does not expose a deferred API setup through a legacy application-only goal',()=>{
    state.session!.setup!.goals=['observe'];
    const html=renderSetup();
    expect(html).toContain('Set up your coding agent.');
    expect(html).toContain('Copy setup prompt');
    expect(html).not.toContain('Connect your application.');
    expect(html).not.toContain('Point your API client to Traqiva');
    expect(html).not.toContain('baseURL:');
  });

  it('starts at an explicit first step with only the current coding-agent product',()=>{
    state.session!.setup={stage:'goals',goals:[],project_id:null};
    const html=renderSetup();
    expect(html.replace(/<[^>]*>/g,'')).toContain('Step 1 of 3');
    expect(html).toContain('What do you want to do?');
    expect(html).toContain('Spend less on coding agents');
    expect(html).not.toContain('Build more efficient agents');
    expect(html).not.toContain('Choose one or both');
    expect(html).not.toContain('Start on Free');
  });

});
