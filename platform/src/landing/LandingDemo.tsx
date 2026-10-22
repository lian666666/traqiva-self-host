import { lazy,Suspense,useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import './landing-demo.css';
const InteractiveDemo=lazy(()=>import('../demo/InteractiveDemo'));
export default function LandingDemo(){
  const ref=useRef<HTMLElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{if(!ref.current)return;if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'250px'});observer.observe(ref.current);return()=>observer.disconnect();},[]);
  const placeholder=<div className="landing-demo-loading">Loading the sample workspace…</div>;
  return <section className="landing-demo-section" id="demo" ref={ref} aria-labelledby="landing-demo-title"><div className="landing-demo-heading"><div><h2 id="landing-demo-title">See where every token goes.</h2><p>Explore spend, follow the evidence, and try a quality check. No signup needed.</p></div><Link to="/demo">Open full screen<ArrowUpRight size={14}/></Link></div>{visible?<Suspense fallback={placeholder}><InteractiveDemo/></Suspense>:placeholder}</section>;
}
