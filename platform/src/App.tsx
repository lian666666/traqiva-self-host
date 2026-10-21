import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './api';
import { ErrorNotice, Spinner } from './ui';
import Marketing from './Marketing';
import Auth from './Auth';
import Onboarding from './Onboarding';
import Shell from './Shell';
import Home from './pages/Home';
import Gateway from './pages/Gateway';
import Traces from './pages/Traces';
import Improvements from './pages/Improvements';
import Evals from './pages/Evals';
import Admin from './pages/Admin';
import Ask from './pages/Ask';
import InboxPage from './pages/Inbox';
import Connect from './pages/Connect';
import Developers from './pages/Developers';
import { setupRequired } from './setupState';
import PublicDocument from './PublicDocuments';
import Deployment from './Deployment';
function Protected(){const {loading,session,error,reload}=useApp();if(loading)return <div className="loading-screen"><Spinner/><span>Opening your workspace…</span></div>;if(error)return <div className="loading-screen"><ErrorNotice message={error} retry={()=>void reload()}/></div>;if(!session?.user)return <Navigate to="/login" replace/>;if(setupRequired(session))return <Navigate to="/onboarding" replace/>;return <Shell/>;}
export default function App(){return <Routes><Route path="/" element={<Marketing/>}/><Route path="/terms" element={<PublicDocument kind="terms"/>}/><Route path="/privacy" element={<PublicDocument kind="privacy"/>}/><Route path="/data" element={<PublicDocument kind="data"/>}/><Route path="/deploy" element={<Deployment/>}/><Route path="/login" element={<Auth/>}/><Route path="/signup" element={<Auth signup/>}/><Route path="/onboarding" element={<Onboarding/>}/><Route path="/app" element={<Protected/>}><Route index element={<Navigate to="home" replace/>}/><Route path="home" element={<Home/>}/><Route path="analytics" element={<Home analytics/>}/><Route path="dashboards" element={<Home dashboards/>}/><Route path="gateway" element={<Gateway/>}/><Route path="traces" element={<Traces/>}/><Route path="improvements" element={<Improvements/>}/><Route path="evals" element={<Evals/>}/><Route path="admin" element={<Admin/>}/><Route path="billing" element={<Admin billing/>}/><Route path="ask" element={<Ask/>}/><Route path="inbox" element={<InboxPage/>}/><Route path="connect" element={<Connect/>}/><Route path="developers" element={<Navigate to="/app/developers/sessions" replace/>}/><Route path="developers/sessions" element={<Developers/>}/><Route path="developers/usage" element={<Home analytics/>}/></Route><Route path="/dashboard" element={<Navigate to="/app/home" replace/>}/><Route path="/optimization" element={<Navigate to="/app/improvements" replace/>}/><Route path="*" element={<div className="not-found"><h1>This page isn’t here.</h1><p>The workspace has moved. Open Traqiva to continue.</p><a className="button primary" href="/">Back to Traqiva</a></div>}/></Routes>;}
