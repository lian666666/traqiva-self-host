import { useEffect,useState } from 'react';
import { api } from './api';
import { canCheckConnection } from './setupState';
import type { ConnectionStatus } from './types';

export function useConnectionStatus(stage:string,projectId:string|null,accepted:boolean){
  const [status,setStatus]=useState<ConnectionStatus|null>(null),[checking,setChecking]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[online,setOnline]=useState(()=>navigator.onLine);
  useEffect(()=>{
    let disposed=false,inFlight=false;const controller=new AbortController();
    setStatus(null);setError('');
    async function check(){
      const connectedToNetwork=navigator.onLine!==false;setOnline(connectedToNetwork);
      if(!projectId||inFlight||!canCheckConnection(stage,accepted,document.visibilityState==='visible',connectedToNetwork))return;
      inFlight=true;setChecking(true);
      try{const result=await api<ConnectionStatus>('/api/onboarding/status',{signal:controller.signal});if(!disposed){setStatus(result);setError('');}}
      catch(e){if(!disposed&&!controller.signal.aborted){setStatus(null);setError((e as Error).message);}}
      finally{inFlight=false;if(!disposed)setChecking(false);}
    }
    function activityChanged(){setOnline(navigator.onLine!==false);void check();}
    void check();const interval=window.setInterval(()=>void check(),10000);
    document.addEventListener('visibilitychange',activityChanged);window.addEventListener('online',activityChanged);window.addEventListener('offline',activityChanged);
    return()=>{disposed=true;controller.abort();window.clearInterval(interval);document.removeEventListener('visibilitychange',activityChanged);window.removeEventListener('online',activityChanged);window.removeEventListener('offline',activityChanged);};
  },[stage,projectId,accepted,revision]);
  return {status,checking,error,online,refresh:()=>setRevision(value=>value+1)};
}
