import { FREE_PLAN_AI_ALLOWANCE, FREE_PLAN_MONTHLY_ALLOWANCE, FREE_PLAN_OVERAGE } from '../pricing';

export default function FreePlanTerms(){
  return <dl className="free-plan-details">
    <div><dt>Today</dt><dd>$0. No card.</dd></div>
    <div><dt>Traqiva AI</dt><dd>{FREE_PLAN_AI_ALLOWANCE}</dd></div>
    <div><dt>Each month <small>Planned</small></dt><dd>{FREE_PLAN_MONTHLY_ALLOWANCE}</dd></div>
    <div><dt>Past that <small>Planned</small></dt><dd>{FREE_PLAN_OVERAGE}</dd></div>
    <div><dt>Who</dt><dd>One person.</dd></div>
  </dl>;
}
