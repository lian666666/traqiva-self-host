import { Link } from 'react-router-dom';
import { ArrowRight,Box,ShieldCheck } from 'lucide-react';
import { Code } from '../../ui';
import type { SetupGoal } from '../../types';

/** Deferred application-builder onboarding; rendered only by the release capability gate. */
export const builderSetupGoal={id:'observe' as SetupGoal,icon:Box,title:'Build more efficient agents',description:'Trace agents in your own code. Understand their quality, costs, and opportunities to improve.'};

function apiSample(origin:string){return `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "${origin}/v1",
  defaultHeaders: { "x-traqiva-key": process.env.TRAQIVA_KEY }
});

const result = await client.chat.completions.create({
  model: "YOUR_PROVIDER_MODEL",
  messages: [{ role: "user", content: "Hello, Traqiva." }]
});`;}

export function BuilderApiSetup({origin}:{origin:string}){
  return <div className="setup-manual-guide"><h2>Point your API client to Traqiva</h2><p>Use your own provider account and model. Keep both API keys in your server environment, never browser code.</p><Code>{apiSample(origin)}</Code><div className="notice subtle"><ShieldCheck size={17}/><span>Sending a provider request may incur that provider’s charges. Run it only when you choose to. A real Traces record and reported usage are needed before drawing conclusions about costs.</span></div></div>;
}

export function BuilderConnectionSteps({origin}:{origin:string}){
  return <><section className="guide-step"><span className="step-number">2</span><div><h2>Point your client to Traqiva</h2><p>Use an OpenAI-compatible SDK. Keep your provider key and scoped project key in server environment variables.</p><Code>{apiSample(origin)}</Code><p className="small muted">Use a model supported by your provider account. Your provider bills its own usage.</p></div></section><section className="guide-step"><span className="step-number">3</span><div><h2>Send a request, then inspect it</h2><p>A successful provider call creates a trace with its payload, latency and reported usage.</p><Link className="button primary" to="/app/traces">View request traces<ArrowRight size={15}/></Link></div></section></>;
}
