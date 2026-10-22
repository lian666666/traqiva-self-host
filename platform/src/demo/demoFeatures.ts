import { AGENT_BUILDER_ENABLED } from '../features/agentBuilder';
import type { DemoView } from './demoData';

/** Retain builder modules separately without advertising or routing to them. */
export const builderDemoViews: ReadonlySet<DemoView> = new Set([
  'experiments','datasets','scorers','monitors','reviews','scenarios','quality-gates',
]);

export function availableDemoView(view: DemoView): DemoView {
  return !AGENT_BUILDER_ENABLED && builderDemoViews.has(view) ? 'home' : view;
}
