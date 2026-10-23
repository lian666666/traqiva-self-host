import { Check } from 'lucide-react';
import { Code } from '../ui';
import type { SetupAssistant } from '../setupPrompt';

export function buildConnectCommand(assistant:SetupAssistant,origin:string,projectId:string){
  return `npm install --global ${origin}/cli.tgz
traqiva connect --url ${origin} --project ${projectId} --key-prompt
traqiva engine install --url ${origin}
traqiva setup --agent ${assistant} --print`;
}

export default function CompactAgentSetup({assistant,origin,projectId}:{assistant:SetupAssistant;origin:string;projectId:string}){
  const assistantName=assistant==='codex'?'Codex':'Claude Code';
  return <div className="setup-quick-start">
    <Code>{buildConnectCommand(assistant,origin,projectId)}</Code>
    <ul className="setup-quick-notes">
      <li><Check size={15}/><span>Run in your private terminal and enter your project key when prompted. Input is hidden.</span></li>
      <li><Check size={15}/><span>Add the printed MCP settings to {assistantName}, then restart it. Tools run when called.</span></li>
    </ul>
  </div>;
}
