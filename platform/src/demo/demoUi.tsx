import { useId, type Dispatch, type ReactNode } from 'react';
import type { DemoView } from './demoData';
import type { DemoAction, DemoState } from './demoState';

export type DemoViewProps={state:DemoState;dispatch:Dispatch<DemoAction>;go:(view:DemoView)=>void};
const currency=new Intl.NumberFormat('en',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
const headlineCurrency=new Intl.NumberFormat('en',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
const count=new Intl.NumberFormat('en',{maximumFractionDigits:1});
const compactCount=new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1});
const chartDate=new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'});
export const demoMoney=(value:number)=>currency.format(value);
export const demoNumber=(value:number)=>count.format(value);
export const demoHeadlineMoney=(value:number)=>headlineCurrency.format(Number.isFinite(value)?value:0);
export const demoCompactNumber=(value:number)=>compactCount.format(Number.isFinite(value)?value:0);
export const demoChartDate=(date:string)=>{
  const parsed=Date.parse(date.length===10?`${date}T00:00:00.000Z`:date);
  return Number.isFinite(parsed)?chartDate.format(parsed):date;
};

type DemoChartProps={values:number[];tone?:'blue'|'green';label:string;dates?:string[];formatValue?:(value:number)=>string;selectedIndex?:number};
export function DemoChart({values,tone='blue',label,dates,formatValue=demoCompactNumber,selectedIndex}:DemoChartProps){
  const gradient='demo-'+useId().replaceAll(':','');
  const samples=values.map(value=>Number.isFinite(value)?Math.max(0,value):0);
  const max=Math.max(...samples,0)||1;
  const x=(index:number)=>index/Math.max(1,samples.length-1)*360;
  const y=(value:number)=>92-value/max*84;
  const points=samples.map((value,index)=>`${x(index)},${y(value)}`).join(' ');
  const selected=selectedIndex!==undefined&&Number.isInteger(selectedIndex)&&selectedIndex>=0&&selectedIndex<samples.length?selectedIndex:null;
  const selectedLabel=selected===null?'':`Selected: ${dates?.[selected]?`${demoChartDate(dates[selected])}, `:''}${formatValue(samples[selected])}`;
  return <div className={`demo-chart-frame ${tone}`}>
    <svg className={`demo-chart ${tone}`} viewBox="0 0 360 100" preserveAspectRatio="none" role="img" aria-label={label}>
    <title>{`${label}${selectedLabel?`. ${selectedLabel}`:''}`}</title>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".18"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
    {[max,max/2,0].map((value,index)=><line key={index} x1="0" x2="360" y1={y(value)} y2={y(value)} className="demo-chart-grid"/>)}
    {samples.length>0&&<><polygon points={`0,92 ${points} ${x(samples.length-1)},92`} fill={`url(#${gradient})`}/><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/></>}
    {selected!==null&&<g className="demo-chart-selection"><line x1={x(selected)} x2={x(selected)} y1="8" y2="92" stroke="currentColor" strokeDasharray="3 4" strokeOpacity=".45"/><circle className="demo-chart-point" cx={x(selected)} cy={y(samples[selected])} r="3.5" fill="currentColor"><title>{selectedLabel}</title></circle></g>}
    </svg>
    <div className="demo-chart-axis" aria-hidden="true">{[max,max/2,0].map((value,index)=><span key={index}>{formatValue(value)}</span>)}</div>
    {dates&&dates.length>0&&<div className="demo-chart-dates" aria-hidden="true"><span>{demoChartDate(dates[0])}</span><span>{demoChartDate(dates[dates.length-1])}</span></div>}
  </div>;
}
export function DemoMetric({label,value,detail,green=false}:{label:string;value:ReactNode;detail?:ReactNode;green?:boolean}){
  return <article className={`demo-metric ${green?'green':''}`}><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</article>;
}
export function DemoPanel({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}){
  return <section className="demo-panel"><header><h2>{title}</h2>{action}</header>{children}</section>;
}
