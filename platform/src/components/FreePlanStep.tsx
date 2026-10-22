import { useState, type FormEvent } from 'react';
import { Modal, Spinner } from '../ui';
import FreePlanTerms from './FreePlanTerms';
import { FREE_PLAN_AVAILABILITY, FREE_PLAN_TEAM_TRIAL, PROVIDER_BILLING_NOTE } from '../pricing';

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
      <FreePlanTerms/>
      <div className="free-plan-settings"><span>Bringing your team? <button type="button" className="text-button" disabled aria-describedby="free-plan-availability">{FREE_PLAN_TEAM_TRIAL}</button><small>Coming soon</small></span><button type="button" className="text-button" onClick={()=>setSettingsOpen(true)} disabled={busy}>Account settings</button></div>
      <p className="plan-policy-status" id="free-plan-availability">{FREE_PLAN_AVAILABILITY} {PROVIDER_BILLING_NOTE}</p>
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
