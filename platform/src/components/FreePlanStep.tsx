import { useState, type FormEvent } from 'react';
import { Modal, Spinner } from '../ui';

type FreePlanStepProps = {
  email: string;
  name: string;
  busy: boolean;
  saving: boolean;
  onNameChange: (name: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
};

export default function FreePlanStep({email,name,busy,saving,onNameChange,onSubmit,onBack}:FreePlanStepProps){
  const [settingsOpen,setSettingsOpen]=useState(false);
  return <>
    <form className="free-plan-step" onSubmit={onSubmit}>
      <dl className="free-plan-details">
        <div><dt>Today</dt><dd>$0. No card.</dd></div>
        <div><dt>Included</dt><dd>Traces, usage analytics, evaluations, routing rules, waste checks and Ask.</dd></div>
        <div><dt>Provider usage</dt><dd>Use your own provider key. Model usage is billed separately by your provider.</dd></div>
        <div><dt>Who</dt><dd>Your personal workspace.</dd></div>
      </dl>
      <div className="free-plan-settings"><button type="button" className="text-button" onClick={()=>setSettingsOpen(true)} disabled={busy}>Account settings</button></div>
      <button type="submit" className="button primary free-plan-start" disabled={!name.trim()||busy}>{saving?<Spinner/>:'Start on Free'}</button>
      <button type="button" className="text-button free-plan-back" onClick={onBack} disabled={busy}>Back</button>
    </form>
    {settingsOpen&&<Modal title="Account settings" onClose={()=>setSettingsOpen(false)}>
      <div className="free-plan-account">
        <label className="field">Email<input type="email" value={email} readOnly/></label>
        <label className="field">Project name<input maxLength={100} value={name} onChange={event=>onNameChange(event.target.value)} disabled={busy}/></label>
        <p>Your project name is saved when you select Start on Free.</p>
        <button type="button" className="button primary" onClick={()=>setSettingsOpen(false)} disabled={!name.trim()||busy}>Done</button>
      </div>
    </Modal>}
  </>;
}
