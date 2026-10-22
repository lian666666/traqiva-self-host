import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { demoSeries, demoSummary, type DemoState } from './demoState';
import { DemoChart, demoChartDate, demoCompactNumber, demoHeadlineMoney, demoMoney, demoNumber } from './demoUi';

export type DemoInspectableMetric='spend'|'cache'|'requests'|'input';
type DemoMetricDialogProps={metric:DemoInspectableMetric;state:DemoState;onClose:()=>void;onInspect:()=>void;onAnalytics:()=>void};
const metricLabels={spend:'Spend',cache:'Input cached',requests:'Requests',input:'Input tokens'};
const percent=(value:number|null)=>value===null?'—':`${value.toFixed(1)}%`;

export function DemoMetricDialog({metric,state,onClose,onInspect,onAnalytics}:DemoMetricDialogProps){
  const dialog=useRef<HTMLDivElement>(null);
  const close=useRef<HTMLButtonElement>(null);
  const heading=useId(),meaning=useId(),dayControl=useId();
  const [selectedDay,setSelectedDay]=useState(state.days-1);
  const summary=demoSummary({...state,query:'',model:'',status:''});
  const series=demoSeries(state.days);
  const dayIndex=Math.min(selectedDay,series.length-1),day=series[dayIndex];
  const formatValue=metric==='spend'?demoMoney:metric==='cache'?(value:number)=>`${value.toFixed(1)}%`:demoCompactNumber;
  const values=series.map(point=>metric==='spend'?point.cost:metric==='cache'?point.cachedPercent??0:metric==='requests'?point.requests:point.inputTokens);
  const value=metric==='spend'?demoHeadlineMoney(summary.cost):metric==='cache'?percent(summary.cachePercent):demoCompactNumber(metric==='input'?summary.inputTokens:summary.requests);
  const selectedValue=metric==='cache'&&day.cachedPercent===null?'No input recorded':formatValue(values[dayIndex]);
  const descriptions={
    spend:'The sum of sample request costs. Use this view to see which models account for the most spending.',
    cache:'The share of input tokens marked as cached in the sample records. A cache hit is not a measurement of money saved.',
    requests:'The number of sample requests in this period. Inspect failures before changing your retry policy.',
    input:'All input tokens sent across the sample requests, including cached input. Find large inputs before testing a smaller context.',
  };

  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    close.current?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[]);

  function handleKeyDown(event:KeyboardEvent<HTMLDivElement>){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]')??[]).filter(element=>element.getAttribute('aria-hidden')!=='true');
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }

  return <div className="demo-metric-dialog-overlay" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div ref={dialog} className="demo-metric-dialog" role="dialog" aria-modal="true" aria-labelledby={heading} aria-describedby={meaning} onKeyDown={handleKeyDown}>
      <header className="demo-metric-dialog-heading"><div><span>Last {state.days} days · UTC</span><h2 id={heading}>{metricLabels[metric]} details</h2></div><button ref={close} className="demo-icon-button" aria-label="Close metric details" onClick={onClose}><X size={18}/></button></header>
      <div className="demo-metric-dialog-value"><strong>{value}</strong><span>{metric==='input'?`${demoNumber(summary.inputTokens)} input tokens`:metric==='spend'?`${demoNumber(summary.requests)} sample requests`:metric==='cache'?`${demoCompactNumber(summary.cachedTokens)} of ${demoCompactNumber(summary.inputTokens)} input tokens`:`${percent(summary.successPercent)} success · ${summary.errors} simulated failures`}</span></div>
      <p className="demo-metric-dialog-meaning" id={meaning}>{descriptions[metric]}</p>
      <div className="demo-metric-dialog-chart"><DemoChart values={values} dates={series.map(point=>point.date)} tone={metric==='cache'?'green':'blue'} label={`Sample ${metricLabels[metric].toLowerCase()} by day`} formatValue={formatValue} selectedIndex={dayIndex}/></div>
      <div className="demo-metric-dialog-day"><label htmlFor={dayControl}>Inspect day <strong>{demoChartDate(day.date)} · {selectedValue}</strong></label><input id={dayControl} type="range" min="0" max={series.length-1} step="1" value={dayIndex} aria-valuetext={`${demoChartDate(day.date)}: ${selectedValue}`} onChange={event=>setSelectedDay(Number(event.target.value))}/></div>
      <section className="demo-metric-dialog-breakdown" aria-label={metric==='spend'?'Sample spending by model':'Metric breakdown'}>
        {metric==='spend'?<><h3>Where the spend comes from</h3>{[...summary.models].sort((a,b)=>b.cost-a.cost).map(model=><div key={model.model}><span><strong>{model.model}</strong><small>{demoNumber(model.requests)} sample requests</small></span><strong>{demoMoney(model.cost)}</strong></div>)}</>:metric==='requests'?<><h3>Request outcomes</h3><div><span>Successful requests</span><strong>{demoNumber(summary.requests-summary.errors)}</strong></div><div><span>Simulated failures</span><strong>{demoNumber(summary.errors)}</strong></div><div><span>Average latency</span><strong>{summary.avgLatencyMs===null?'—':`${demoNumber(summary.avgLatencyMs)} ms`}</strong></div></>:<><h3>Input token breakdown</h3><div><span>Cached input</span><strong>{demoNumber(summary.cachedTokens)}</strong></div><div><span>Uncached input</span><strong>{demoNumber(summary.inputTokens-summary.cachedTokens)}</strong></div><div><span>Total input</span><strong>{demoNumber(summary.inputTokens)}</strong></div>{metric==='input'&&<div><span>Output tokens · counted separately</span><strong>{demoNumber(summary.outputTokens)}</strong></div>}</>}
      </section>
      <footer><div className="demo-metric-dialog-actions"><button className="demo-button" onClick={onInspect}>Inspect sample traces<ArrowRight size={14}/></button><button className="demo-button" onClick={onAnalytics}>Open analytics<ArrowRight size={14}/></button></div><p className="demo-metric-dialog-notice">Fictional sample · no account data or provider requests.</p></footer>
    </div>
  </div>;
}
