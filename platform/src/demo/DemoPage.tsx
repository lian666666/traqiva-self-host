import { useEffect } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { ArrowLeft,ArrowRight } from 'lucide-react';
import InteractiveDemo,{demoTitles} from './InteractiveDemo';
import type { DemoView } from './demoData';
export default function DemoPage(){
  const [params]=useSearchParams(),requested=params.get('view')||'home';
  const view:DemoView=Object.prototype.hasOwnProperty.call(demoTitles,requested)?requested as DemoView:'home';
  useEffect(()=>{document.title='Interactive demo — Traqiva';},[]);
  return <main className="demo-page"><header className="demo-page-top"><Link to="/"><ArrowLeft size={14}/>Back to Traqiva</Link><span>Try the product. Keep your account untouched.</span><Link to="/signup">Create your workspace<ArrowRight size={14}/></Link></header><InteractiveDemo standalone initialView={view}/></main>;
}
