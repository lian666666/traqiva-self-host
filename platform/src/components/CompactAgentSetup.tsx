import { Check } from 'lucide-react';
import { Code,Select } from '../ui';
import { buildTerminalSetupSteps,type TerminalShell } from '../setupPrompt';

export default function CompactAgentSetup({origin,projectId,shell,onShellChange}:{origin:string;projectId:string;shell:TerminalShell;onShellChange:(shell:TerminalShell)=>void}){
  const commands=buildTerminalSetupSteps(origin,projectId,shell);
  return <div className="setup-terminal-method">
    <div className="setup-terminal-heading"><p>Run each command separately in your private terminal.</p><Select label="Terminal shell" value={shell} onChange={value=>onShellChange(value as TerminalShell)}><option value="windows">Windows · PowerShell</option><option value="posix">macOS / Linux</option></Select></div>
    <div className="setup-terminal-commands">
      <section className="setup-terminal-step" aria-label="Install local tools"><h3><span>1</span>Install &amp; configure</h3><Code>{commands.install}</Code></section>
      <section className="setup-terminal-step" aria-label="Connect Traqiva"><h3><span>2</span>Connect Traqiva</h3><Code>{commands.connect}</Code></section>
    </div>
    <ul className="setup-quick-notes">
      <li><Check size={15}/><span>Choose Codex or Claude Code in the installer. Follow its MCP setup prompts.</span></li>
      <li><Check size={15}/><span>Enter your project key only when prompted. Input is hidden.</span></li>
    </ul>
  </div>;
}
