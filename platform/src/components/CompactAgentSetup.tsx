import { Check } from 'lucide-react';
import { Code } from '../ui';
import type { SetupAssistant } from '../setupPrompt';

export function buildConnectCommand(assistant:SetupAssistant,origin:string,projectId:string){
  return `npm install --global ${origin}/downloads/traqiva-cli-0.1.0.tgz
traqiva connect --url ${origin} --project ${projectId} --key YOUR_PROJECT_KEY
traqiva engine install --url ${origin}
traqiva setup --agent ${assistant} --print`;
}

export default function CompactAgentSetup({assistant,origin,projectId}:{assistant:SetupAssistant;origin:string;projectId:string}){
  const assistantName=assistant==='codex'?'Codex':'Claude Code';
  return <div className="setup-quick-start">
    <Code>{buildConnectCommand(assistant,origin,projectId)}</Code>
    <ul className="setup-quick-notes">
      <li><Check size={15}/><span>Replace <code>YOUR_PROJECT_KEY</code> with your private key from More setup options.</span></li>
      <li><Check size={15}/><span>Add the printed MCP settings to {assistantName}, then restart it. Tools run when called.</span></li>
    </ul>
  </div>;
}
