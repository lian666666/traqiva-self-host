import { Link } from 'react-router-dom';
import { ArrowRight, Inbox, SlidersHorizontal } from 'lucide-react';
import { date,useApp,useResource } from '../api';
import { Empty,ErrorNotice,PageIntro } from '../ui';
type InboxItem={id:string;title:string;body?:string;message?:string;description?:string;type?:string;created_at:string;href?:string};
export default function InboxPage(){const {project}=useApp();const {data,error,refresh}=useResource<{items:InboxItem[]}>(project?`/api/inbox?project=${project.id}`:null,{items:[]});return <><PageIntro title="The things worth your attention." description="Project updates and supported findings, in one place."/><ErrorNotice message={error} retry={refresh}/><section className="panel">{data.items?.length?<div className="inbox-list">{data.items.map(i=><article key={i.id}><span className="inbox-item-icon"><SlidersHorizontal size={19}/></span><div><h3>{i.title}</h3><p>{i.body||i.message||i.description}</p><Link className="text-button" to={i.href?.startsWith('/app/')?i.href:'/app/improvements'}>Review finding<ArrowRight size={13}/></Link></div><time>{date(i.created_at)}</time></article>)}</div>:<Empty icon={<Inbox size={30}/>} title="You’re all caught up">When your project has an update worth reviewing,<br/>it will appear here.</Empty>}</section></>;
}
