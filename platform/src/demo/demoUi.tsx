import { useId, type Dispatch, type ReactNode } from 'react';
import type { DemoView } from './demoData';
import type { DemoAction, DemoState } from './demoState';

export type DemoViewProps={state:DemoState;dispatch:Dispatch<DemoAction>;go:(view:DemoView)=>void};
const currency=new Intl.NumberFormat('en',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
const count=new Intl.NumberFormat('en',{maximumFractionDigits:1});
export const demoMoney=(value:number)=>currency.format(value);
export const demoNumber=(value:number)=>count.format(value);

export function DemoChart({values,tone='blue',label}:{values:number[];tone?:'blue'|'green';label:string}){
  const gradient='demo-'+useId().replaceAll(':','');
  const max=Math.max(...values)||1,points=values.map((v,i)=>`${i/Math.max(1,values.length-1)*400},${92-v/max*76}`).join(' ');
  return <svg className={`demo-chart ${tone}`} viewBox="0 0 400 100" preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".18"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
    {[16,54,92].map(y=><line key={y} x1="0" x2="400" y1={y} y2={y} className="demo-chart-grid"/>)}
    {values.length>0&&<><polygon points={`0,100 ${points} 400,100`} fill={`url(#${gradient})`}/><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></>}
  </svg>;
}
export function DemoMetric({label,value,detail,green=false}:{label:string;value:ReactNode;detail?:ReactNode;green?:boolean}){
  return <article className={`demo-metric ${green?'green':''}`}><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</article>;
}
export function DemoPanel({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}){
  return <section className="demo-panel"><header><h2>{title}</h2>{action}</header>{children}</section>;
}
