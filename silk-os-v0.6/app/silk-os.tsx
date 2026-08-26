"use client";

import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive,
  useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  Activity, AlertTriangle, ArrowUp, BookOpen, Bot, Brain, CalendarDays, Check, CheckCircle2, ChevronRight,
  Circle, Cloud, CloudSun, Cpu, Database, Dumbbell, FolderKanban, Gauge, HeartPulse, Home, Link2,
  ListChecks, LockKeyhole, Menu, MessageCircle, Mic, MoreHorizontal, Pencil, Plus, RefreshCw,
  Radio, Search, Settings, ShieldCheck, Sparkles, Trash2, Webhook, Wifi, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { SilkCoreWebGL, type SilkCoreState } from "./components/silk-core-webgl";
import { MemoryGalaxyWebGL } from "./components/memory-galaxy-webgl";

type View = "home"|"chat"|"today"|"calendar"|"projects"|"study"|"workouts"|"memory"|"integrations"|"activity"|"agents"|"devices"|"settings";
type CoreState = SilkCoreState;
type Source = { title:string; url:string; snippet?:string };
type ChatMessage = { id:string; role:"user"|"assistant"; text:string; model?:string; sources?:Source[] };
type DailyItem = { id:number; title:string; kind:string; source_type:string; source_id?:string|null; status:"todo"|"doing"|"done"|"skipped"; scheduled_at?:number|null; duration_minutes?:number; priority?:number; notes?:string };
type Memory = { id:number; category:string; content:string; importance:number; privacy?:"public"|"personal"|"sensitive"|"restricted"; confidence?:number; source?:string; locked?:number; updated_at?:number };
type Project = { id:number; name:string; description?:string; status:string; priority:number; due_at?:number|null; done_tasks:number; task_count:number; open_tasks:number; tasks?:Array<{id:number;title:string;status:string;due_at?:number|null}> };
type GraphNode = { id:number; label:string; node_type:string; privacy:string; importance:number; memory_id?:number|null };
type GraphEdge = { id:number; source:number; target:number; relation:string; weight:number };
type ActivityItem = { id:number;provider:string;action:string;target:string;detail?:Record<string,unknown>;status:string;created_at:number };
type Approval = { id:number;provider:string;action:string;target:string;summary:string;risk_level:"low"|"medium"|"high";status:string;expires_at:number;created_at:number };
type Weather = { configured:boolean;status:string;location:string;condition?:string;temperature?:number;feels_like?:number;high?:number;low?:number;precipitation_probability?:number;unit?:string;source?:string;updated_at?:number;error?:string };
type SilkData = {
  history:Array<{id:number;role:"user"|"assistant";content:string;sources?:Source[]}>; memories:Memory[]; projects:Project[];
  today:{date:string;items:DailyItem[];progress:{completed:number;total:number;percent:number};week:{completed:number;total:number};focus_minutes:number;deadlines:Array<{id:number;name:string;due_at:number;priority:number}>;synced_at:number};
  study:{sessions?:Array<Record<string,unknown>>;latest?:Record<string,unknown>;weakest_topics?:Array<Record<string,unknown>>};
  workouts:{active?:Record<string,unknown>|null;recent?:Array<Record<string,unknown>>;history?:Array<Record<string,unknown>>};
  usage:Record<string,unknown>&{requests?:number;paid_cost_cad?:number;openai_spend_limit_usd?:number;openai_remaining_usd?:number;providers?:Record<string,Record<string,number>>};
  google:{configured:boolean;connected:boolean;account_email?:string};
  microsoft:{configured:boolean;connected:boolean;account_email?:string;section_id?:string;section_name?:string;auto_sync?:boolean};
  web:{configured?:boolean;provider?:string}; weather:Weather; activity:ActivityItem[]; approvals:Approval[];
  ai:{primary_provider?:string;router_model?:string;routine_model?:string;complex_model?:string;spent_this_month_usd?:number;spend_limit_usd?:number;remaining_usd?:number;circuit_open?:boolean};
  settings:{owner_name:string;assistant_name:string;model_mode:string;response_length:string;monthly_budget_cad:string;home_city:string;time_zone:string;temperature_unit:string;morning_brief_enabled:string};
};

const dateKey=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const now=()=>Math.floor(Date.now()/1000);
const previewData:SilkData={
  history:[{id:1,role:"assistant",content:"Silk OS is online. This preview uses sample data until your Cloudflare secrets and private D1 database are attached."}],
  memories:[
    {id:1,category:"assistant",content:"Lead with evidence, then give the recommendation.",importance:5,privacy:"personal",confidence:1,source:"manual"},
    {id:2,category:"school",content:"Pre-Health study results should be reviewed by topic.",importance:4,privacy:"personal",confidence:.95,source:"conversation"},
    {id:3,category:"fitness",content:"Track weights, reps, RPE, warmups, and personal records.",importance:4,privacy:"sensitive",confidence:.9,source:"conversation"},
  ],
  projects:[
    {id:1,name:"Build Silk",description:"Turn Silk into a real assistant OS.",status:"active",priority:5,done_tasks:8,task_count:12,open_tasks:4,tasks:[{id:1,title:"Connect Google Calendar",status:"doing"},{id:2,title:"Finish memory controls",status:"todo"}]},
    {id:2,name:"Pre-Health Review",description:"Organize study gaps and comeback exams.",status:"active",priority:4,done_tasks:3,task_count:6,open_tasks:3,tasks:[]},
  ],
  today:{date:dateKey(),items:[
    {id:1,title:"Anatomical planes review",kind:"task",source_type:"study",status:"todo",duration_minutes:45,priority:5},
    {id:2,title:"Build Silk v0.7",kind:"task",source_type:"project",status:"doing",duration_minutes:90,priority:5},
    {id:3,title:"Incline chest press",kind:"task",source_type:"workout",status:"done",duration_minutes:25,priority:3},
  ],progress:{completed:1,total:3,percent:33},week:{completed:9,total:14},focus_minutes:270,deadlines:[{id:1,name:"Silk v0.7 deployment",due_at:now()+259200,priority:5}],synced_at:now()},
  study:{sessions:[],weakest_topics:[{topic:"Anatomical planes",score:40}]},workouts:{active:null,recent:[]},
  usage:{requests:23,paid_cost_cad:.08,openai_spend_limit_usd:10,openai_remaining_usd:9.94,providers:{openai:{requests:8},cloudflare:{requests:15}}},
  google:{configured:false,connected:false},microsoft:{configured:false,connected:false,auto_sync:true},web:{configured:false,provider:"Tavily"},
  weather:{configured:true,status:"ready",location:"Toronto, Ontario",condition:"Partly cloudy",temperature:21,feels_like:20,high:24,low:15,precipitation_probability:20,unit:"°C",source:"Open-Meteo",updated_at:now()},
  activity:[
    {id:1,provider:"silk",action:"daily_brief_refreshed",target:"Today",status:"completed",created_at:now()-120},
    {id:2,provider:"openai",action:"assistant_response",target:"gpt-5-nano",status:"completed",created_at:now()-540},
    {id:3,provider:"google",action:"calendar_sync",target:"Primary calendar",status:"completed",created_at:now()-900},
  ],approvals:[],
  ai:{primary_provider:"openai",router_model:"gpt-5-nano",routine_model:"gpt-5.6-luna",complex_model:"gpt-5.6-terra",spent_this_month_usd:.06,spend_limit_usd:10,remaining_usd:9.94},
  settings:{owner_name:"Jaed",assistant_name:"Silk",model_mode:"automatic",response_length:"concise",monthly_budget_cad:"2",home_city:"Toronto, Ontario",time_zone:"America/Toronto",temperature_unit:"celsius",morning_brief_enabled:"true"},
};

const NAV:Array<{id:View;label:string;icon:typeof Home}>=[
  {id:"home",label:"Overview",icon:Home},{id:"chat",label:"Ask Silk",icon:MessageCircle},{id:"today",label:"Today",icon:ListChecks},
  {id:"calendar",label:"Calendar",icon:CalendarDays},{id:"projects",label:"Projects",icon:FolderKanban},{id:"study",label:"Study",icon:BookOpen},
  {id:"workouts",label:"Workouts",icon:Dumbbell},{id:"memory",label:"Memory",icon:Brain},{id:"integrations",label:"Connections",icon:Link2},
  {id:"activity",label:"Activity",icon:Activity},{id:"agents",label:"Agents",icon:Bot},{id:"devices",label:"Devices",icon:Cpu},{id:"settings",label:"Settings",icon:Settings},
];

async function api<T=Record<string,unknown>>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(path,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const body=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof body.error==="string"?body.error:`Request failed (${response.status})`);return body as T;
}

export default function SilkOS(){
  const [session,setSession]=useState<{configured:boolean;authenticated:boolean;version:string}|null>(null);
  const [data,setData]=useState<SilkData>(previewData);const [view,setView]=useState<View>("home");const [preview,setPreview]=useState(false);
  const [loading,setLoading]=useState(true);const [menu,setMenu]=useState(false);const [notice,setNotice]=useState("");const [voice,setVoice]=useState(false);
  const [activity,setActivity]=useState<{state:CoreState;label:string}>({state:"idle",label:"Ready"});
  const load=useCallback(async()=>{try{setData(await api<SilkData>("/api/bootstrap"));setPreview(false);}catch(error){setNotice(error instanceof Error?error.message:"Silk could not load your data.");}},[]);
  useEffect(()=>{let active=true;(async()=>{try{const current=await api<{configured:boolean;authenticated:boolean;version:string}>("/api/session",{headers:{}});if(!active)return;setSession(current);if(!current.configured){setPreview(true);setData(previewData);}else if(current.authenticated)await load();}catch{if(active){setSession({configured:false,authenticated:false,version:"Silk OS v0.7"});setPreview(true);}}finally{if(active)setLoading(false);}})();return()=>{active=false};},[load]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const url=new URL(window.location.href);
      const provider=url.searchParams.has("calendar")?"Google Calendar":url.searchParams.has("microsoft")?"Microsoft OneNote":"";
      if(!provider)return;
      const result=url.searchParams.get(provider==="Google Calendar"?"calendar":"microsoft");
      setView("integrations");
      setNotice(result==="connected"?`${provider} connected successfully.`:`${provider} could not connect${url.searchParams.get("detail")?`: ${url.searchParams.get("detail")}`:"."}`);
      url.searchParams.delete("calendar");
      url.searchParams.delete("microsoft");
      url.searchParams.delete("detail");
      window.history.replaceState({},"",url.pathname+url.search);
    },0);
    return()=>window.clearTimeout(timer);
  },[]);
  const refresh=useCallback(async()=>{if(preview)return;setActivity({state:"retrieving",label:"Refreshing Silk"});await load();setActivity({state:"idle",label:"Ready"});},[load,preview]);
  if(loading)return <Boot/>;
  if(session?.configured&&!session.authenticated)return <Login onSuccess={async()=>{setSession({...session,authenticated:true});await load();}}/>;
  const title=NAV.find(item=>item.id===view)?.label||"Silk";
  return <main className="silk-shell">
    <aside className={`silk-sidebar ${menu?"open":""}`}><div className="brand-block"><Mark small/><div><strong>SILK</strong><span>Personal intelligence</span></div><button className="icon-button mobile-only" onClick={()=>setMenu(false)}><X size={18}/></button></div>
      <nav className="side-nav">{NAV.map(({id,label,icon:Icon})=><button key={id} className={view===id?"active":""} onClick={()=>{setView(id);setMenu(false)}}><Icon size={18}/><span>{label}</span>{view===id&&<i/>}</button>)}</nav>
      <div className="sidebar-foot"><div className="security-chip"><ShieldCheck size={15}/> Owner-only</div><span>{preview?"Preview data":"Cloudflare + private D1"}</span></div>
    </aside>
    <section className="silk-workspace"><header className="topbar"><div className="topbar-title"><button className="icon-button mobile-only" onClick={()=>setMenu(true)}><Menu size={20}/></button><div><span className="eyebrow">SILK OS / {title.toUpperCase()}</span><h1>{title}</h1></div></div><div className="top-actions">{preview&&<span className="preview-badge">PREVIEW</span>}<button className="quiet-button" onClick={()=>setVoice(!voice)}><Activity size={16}/> Voice {voice?"on":"off"}</button><button className="icon-button" onClick={refresh}><RefreshCw size={17}/></button></div></header>
      {notice&&<div className="notice"><span>{notice}</span><button onClick={()=>setNotice("")}><X size={16}/></button></div>}
      <div className="workspace-scroll">
        {view==="home"&&<Dashboard data={data} preview={preview} nav={setView} refresh={refresh}/>}
        {view==="chat"&&<Chat initial={data.history} preview={preview} voice={voice} setActivity={setActivity} refresh={refresh}/>}
        {view==="today"&&<Today data={data.today} preview={preview} refresh={refresh} notice={setNotice}/>}
        {view==="calendar"&&<Calendar data={data} preview={preview} refresh={refresh} notice={setNotice}/>}
        {view==="projects"&&<Projects data={data.projects} preview={preview} refresh={refresh} notice={setNotice}/>}
        {view==="study"&&<Study data={data.study}/>} {view==="workouts"&&<Workouts data={data.workouts}/>}
        {view==="memory"&&<MemoryView data={data.memories} preview={preview} refresh={refresh} notice={setNotice}/>}
        {view==="integrations"&&<Integrations data={data} preview={preview} refresh={refresh} notice={setNotice}/>}
        {view==="activity"&&<ActivityView data={data} preview={preview} refresh={refresh} notice={setNotice}/>}
        {view==="agents"&&<AgentsView/>} {view==="devices"&&<DevicesView/>}
        {view==="settings"&&<SettingsView data={data} preview={preview} refresh={refresh} notice={setNotice}/>}
      </div>
    </section>
    <aside className="core-rail"><Core activity={activity} data={data}/></aside>
    <nav className="mobile-tabs">{NAV.filter(item=>["home","chat","today","memory"].includes(item.id)).map(({id,label,icon:Icon})=><button key={id} className={view===id?"active":""} onClick={()=>setView(id)}><Icon size={19}/><span>{label}</span></button>)}<button onClick={()=>setMenu(true)}><MoreHorizontal size={19}/><span>More</span></button></nav>
  </main>;
}

function Mark({small=false}:{small?:boolean}){return <div className={`silk-mark ${small?"small":""}`} aria-hidden><span/><span/><span/></div>}
function Boot(){return <main className="boot-screen"><Mark/><div><strong>SILK OS</strong><span>Initializing private workspace</span></div></main>}
function Login({onSuccess}:{onSuccess:()=>Promise<void>}){const [password,setPassword]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{await api("/api/login",{method:"POST",body:JSON.stringify({password})});await onSuccess()}catch(reason){setError(reason instanceof Error?reason.message:"Sign-in failed.")}finally{setBusy(false)}};return <main className="login-screen"><div className="login-panel"><Mark/><span className="eyebrow">PRIVATE PERSONAL OS</span><h1>Unlock Silk</h1><p>Your data stays behind your owner passphrase and same-origin session.</p><form onSubmit={submit}><label htmlFor="pass">Owner passphrase</label><input id="pass" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus/>{error&&<div className="field-error">{error}</div>}<button className="primary-button" disabled={busy||!password}>{busy?"Unlocking…":"Unlock workspace"}<ChevronRight size={17}/></button></form></div></main>}
function Panel({title,eyebrow,action,className="",children}:{title:string;eyebrow?:string;action?:ReactNode;className?:string;children:ReactNode}){return <section className={`panel ${className}`}><header className="panel-head"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</header>{children}</section>}
function Metric({label,value,detail,progress}:{label:string;value:string;detail:string;progress?:number}){return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small>{progress!==undefined&&<div className="progress"><i style={{width:`${Math.min(100,Math.max(0,progress))}%`}}/></div>}</article>}
function Timeline({item,toggle}:{item:DailyItem;toggle?:(item:DailyItem)=>void}){return <article className={`timeline-item ${item.status}`}><button className="task-check" onClick={()=>toggle?.(item)}>{item.status==="done"?<Check size={14}/>:<Circle size={14}/>}</button><div><strong>{item.title}</strong><span>{item.source_type} · {minutes(Number(item.duration_minutes||0))}{item.scheduled_at?` · ${clock(item.scheduled_at)}`:""}</span></div><em>P{item.priority||3}</em></article>}
function Empty({icon:Icon,title,detail}:{icon:typeof Home;title:string;detail:string}){return <div className="empty-state"><Icon size={21}/><div><strong>{title}</strong><span>{detail}</span></div></div>}
function Signal({icon:Icon,label,value,muted=false}:{icon:typeof Home;label:string;value:string;muted?:boolean}){return <div className={`signal ${muted?"muted":""}`}><Icon size={18}/><span><small>{label}</small><strong>{value}</strong></span></div>}
function Rule({children}:{children:ReactNode}){return <div className="rule"><Check size={14}/><span>{children}</span></div>}

function Dashboard({data,preview,nav,refresh}:{data:SilkData;preview:boolean;nav:(v:View)=>void;refresh:()=>Promise<void>}){const todo=data.today.items.filter(i=>!["done","skipped"].includes(i.status)).slice(0,4);const deadline=data.today.deadlines[0];const pending=data.approvals.filter(item=>item.status==="pending").length;return <div className="page-grid"><section className="status-strip"><div><i/><span>{preview?"Preview workspace":"Systems operational"}</span></div><span>Synced {relative(data.today.synced_at)}</span></section><section className="command-deck span-3"><div className="command-brief"><span className="eyebrow">LIVE PERSONAL INTELLIGENCE</span><h2>{dayPart()}, {data.settings.owner_name}.</h2><p>{todo[0]?`${todo[0].title} is currently the highest-priority unfinished item. I recommend starting there.`:"Your tracked queue is clear. Choose one meaningful priority before the day fills up."}</p><div className="command-actions"><button className="primary-button" onClick={()=>nav("chat")}><MessageCircle size={15}/> Ask Silk</button><button className="quiet-button" onClick={refresh}><RefreshCw size={15}/> Run briefing</button></div></div><SilkCoreWebGL state={pending?"approval":"idle"} label={pending?`${pending} action${pending===1?"":"s"} awaiting approval`:"All connected systems ready"}/><div className="command-signals"><Signal icon={CloudSun} label={data.weather.location||"Weather"} value={data.weather.status==="ready"?`${Math.round(Number(data.weather.temperature))}${data.weather.unit} · ${data.weather.condition}`:"Weather unavailable"}/><Signal icon={CalendarDays} label="Calendar" value={`${data.today.items.filter(item=>item.source_type==="calendar").length} events today`}/><Signal icon={ShieldCheck} label="Approvals" value={pending?`${pending} waiting for you`:"Nothing pending"}/></div></section><div className="metric-row"><Metric label="Completed today" value={`${data.today.progress.completed}/${data.today.progress.total}`} detail={`${data.today.progress.percent}% of tracked items`} progress={data.today.progress.percent}/><Metric label="This week" value={`${data.today.week.completed}/${data.today.week.total}`} detail="tasks completed" progress={data.today.week.total?data.today.week.completed/data.today.week.total*100:0}/><Metric label="Focus capacity" value={minutes(data.today.focus_minutes)} detail="after calendar blocks"/><Metric label="Paid AI this month" value={money(Number(data.usage.paid_cost_cad||0))} detail={`${Number(data.usage.requests||0)} total calls`}/></div>
  <Panel title="Today" eyebrow={data.today.date} className="span-2" action={<button className="text-button" onClick={()=>nav("today")}>Open tracker <ChevronRight size={15}/></button>}><div className="timeline-list">{todo.length?todo.map(item=><Timeline key={item.id} item={item}/>):<Empty icon={CheckCircle2} title="The queue is clear" detail="Add a task or sync Calendar."/>}</div></Panel>
  <Panel title="Priority signal" eyebrow="NEXT RECOMMENDATION"><div className="recommendation-card"><Sparkles size={20}/><p>{todo[0]?`${todo[0].title} is the highest-priority unfinished item. I recommend starting there.`:"No unfinished work is tracked. I recommend planning the next meaningful task first."}</p></div>{deadline&&<div className="deadline-line"><span>Nearest</span><strong>{deadline.name}</strong><small>{date(deadline.due_at)}</small></div>}</Panel>
  <Panel title="Active projects" eyebrow="SILK-ONLY TRACKER" className="span-2" action={<button className="text-button" onClick={()=>nav("projects")}>All projects <ChevronRight size={15}/></button>}><div className="project-mini-grid">{data.projects.filter(p=>p.status==="active").slice(0,3).map(p=><ProjectMini key={p.id} p={p}/>)}</div></Panel>
  <Panel title="Readiness" eyebrow="STUDY + TRAINING"><Signal icon={BookOpen} label="Study focus" value={String(data.study.weakest_topics?.[0]?.topic||"No gap recorded")}/><Signal icon={Dumbbell} label="Workout" value={data.workouts.active?"Session in progress":"No active session"}/><Signal icon={HeartPulse} label="Apple Health" value="Native companion required" muted/></Panel>
  <button className="sync-banner" onClick={refresh}><RefreshCw size={17}/><span><strong>Refresh the daily brief</strong><small>Calendar, projects, usage, study, and workouts</small></span><ChevronRight size={17}/></button></div>}
function ProjectMini({p}:{p:Project}){const percent=p.task_count?Math.round(p.done_tasks/p.task_count*100):0;return <article className="project-mini"><div><FolderKanban size={18}/><span>P{p.priority}</span></div><h3>{p.name}</h3><p>{p.description||`${p.open_tasks} tasks remain`}</p><div className="progress"><i style={{width:`${percent}%`}}/></div><small>{p.done_tasks}/{p.task_count} complete</small></article>}

function Chat({
  initial,
  preview,
  voice,
  setActivity,
  refresh,
}: {
  initial: SilkData["history"];
  preview: boolean;
  voice: boolean;
  setActivity: (value: { state: CoreState; label: string }) => void;
  refresh: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initial.map((message) => ({
      id: String(message.id),
      role: message.role,
      text: message.content,
      sources: message.sources,
    })),
  );
  const [running, setRunning] = useState(false);

  const send = useCallback(
    async (text: string) => {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", text },
      ]);

      if (preview) {
        setActivity({ state: "routing", label: "Previewing model selection" });
        window.setTimeout(() => {
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "This is the interface preview. After deployment, this composer streams factual tool activity and routes work through Nano, Luna, or Terra.",
              model: "Preview",
            },
          ]);
          setActivity({ state: "idle", label: "Ready" });
        }, 450);
        return;
      }

      setRunning(true);
      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!response.ok || !response.body) {
          throw new Error("Silk could not open the response stream.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";

          for (const frame of frames) {
            const event = frame
              .split("\n")
              .find((line) => line.startsWith("event:"))
              ?.slice(6)
              .trim();
            const raw = frame
              .split("\n")
              .find((line) => line.startsWith("data:"))
              ?.slice(5)
              .trim();
            if (!event || !raw) continue;

            const payload = JSON.parse(raw);
            if (event === "activity") setActivity(payload);
            if (event === "message") {
              setMessages((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text: payload.reply,
                  model: payload.model,
                  sources: payload.sources || [],
                },
              ]);
              if (voice && "speechSynthesis" in window) {
                setActivity({ state: "speaking", label: "Speaking" });
                const speech = new SpeechSynthesisUtterance(payload.reply);
                speech.rate = 1.03;
                speech.onend = () => setActivity({ state: "idle", label: "Ready" });
                window.speechSynthesis.speak(speech);
              }
            }
            if (event === "error") {
              throw new Error(payload.error || "Silk could not answer.");
            }
          }
        }
        await refresh();
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: error instanceof Error ? error.message : "Silk could not answer.",
            model: "Error",
          },
        ]);
        setActivity({ state: "error", label: "Connection error" });
      } finally {
        setRunning(false);
      }
    },
    [preview, refresh, setActivity, voice],
  );

  const listen = useCallback(async () => {
    try {
      setActivity({ state: "retrieving", label: "Listening" });
      const text = await captureSpeech();
      if (text) await send(text);
      else setActivity({ state: "idle", label: "Ready" });
    } catch (error) {
      setActivity({
        state: "error",
        label: error instanceof Error ? error.message : "Voice input unavailable",
      });
    }
  }, [send, setActivity]);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: running,
    convertMessage: (message: ChatMessage): ThreadMessageLike => ({
      id: message.id,
      role: message.role,
      content: [{ type: "text", text: message.text }],
    }),
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) await send(text);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          <div className="chat-intro">
            <SilkCoreWebGL
              compact
              state={running ? "thinking" : "idle"}
              label={running ? "Working on your request" : "Direct channel ready"}
            />
            <div>
              <span className="eyebrow">DIRECT CHANNEL</span>
              <h2>Ask Silk</h2>
              <p>Conversation, tools, and private context in one workspace.</p>
            </div>
          </div>

          <ThreadPrimitive.Messages>
            {({ message }) => (
              <MessagePrimitive.Root className={`chat-message ${message.role}`}>
                <div className="message-label">
                  {message.role === "assistant" ? "SILK" : "YOU"}
                </div>
                <div className="message-bubble">
                  <MessagePrimitive.Parts />
                </div>
              </MessagePrimitive.Root>
            )}
          </ThreadPrimitive.Messages>

          {running && (
            <div className="typing-line">
              <i />
              <i />
              <i /> Silk is working
            </div>
          )}

          <ThreadPrimitive.ViewportFooter className="composer-footer">
            <div className="voice-capture">
              <button type="button" onClick={listen}>
                <Mic size={15} /> Speak to Silk
              </button>
              <span>{voice ? "Replies will be spoken" : "Voice replies are off"}</span>
            </div>
            <ComposerPrimitive.Root className="composer-root">
              <ComposerPrimitive.Input
                className="composer-input"
                placeholder="Ask Silk, update your day, or say good morning…"
                rows={1}
              />
              <ComposerPrimitive.Send className="composer-send">
                <ArrowUp size={18} />
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
            <small>Nano routes · Luna handles routine work · Terra handles complex work</small>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function Today({data,preview,refresh,notice}:{data:SilkData["today"];preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){const [title,setTitle]=useState("");const toggle=async(item:DailyItem)=>{if(preview)return notice("Preview tasks do not change your private database.");try{await api(`/api/today/${item.id}`,{method:"PATCH",body:JSON.stringify({status:item.status==="done"?"todo":"done",completion_source:"dashboard"})});await refresh()}catch(e){notice(e instanceof Error?e.message:"Could not update the task.")}};const add=async(e:FormEvent)=>{e.preventDefault();if(!title.trim())return;if(preview)return notice("Deploy Silk to add real tasks.");try{await api("/api/today",{method:"POST",body:JSON.stringify({date:data.date,title,priority:3})});setTitle("");await refresh()}catch(err){notice(err instanceof Error?err.message:"Could not add the task.")}};return <div className="page-grid"><div className="metric-row"><Metric label="Today" value={`${data.progress.completed}/${data.progress.total}`} detail="items complete" progress={data.progress.percent}/><Metric label="Week" value={`${data.week.completed}/${data.week.total}`} detail="tracked completions"/><Metric label="Focus room" value={minutes(data.focus_minutes)} detail="estimated capacity"/></div><Panel title="Daily tracker" eyebrow={data.date} className="span-2" action={<button className="quiet-button" onClick={refresh}><RefreshCw size={15}/> Sync</button>}><form className="inline-add" onSubmit={add}><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Add a task to today"/><button><Plus size={18}/></button></form><div className="timeline-list expanded">{data.items.map(item=><Timeline key={item.id} item={item} toggle={toggle}/>)}</div></Panel><Panel title="Upcoming deadlines" eyebrow="NEXT 7 DAYS">{data.deadlines.length?data.deadlines.map(d=><div className="deadline-line" key={d.id}><span>P{d.priority}</span><strong>{d.name}</strong><small>{date(d.due_at)}</small></div>):<Empty icon={CheckCircle2} title="No nearby deadlines" detail="Project deadlines will appear here."/>}</Panel></div>}
function Calendar({data,preview,refresh,notice}:{data:SilkData;preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){const events=data.today.items.filter(i=>i.source_type==="calendar");return <div className="page-grid"><Panel title="Google Calendar" eyebrow="SECURE OAUTH CONNECTION" className="span-2" action={data.google.connected?<span className="connected-chip"><Check size={14}/> Connected</span>:null}><div className="connection-hero"><div className="connection-icon"><CalendarDays/></div><div><h3>{data.google.connected?data.google.account_email||"Google Calendar connected":"Calendar is not connected"}</h3><p>{data.google.connected?"Events are copied into Today as linked items. Completing one never deletes the Google event.":"Google protects sign-in. Silk stores encrypted OAuth tokens; your Google password never enters Silk."}</p></div>{!data.google.connected&&<button className="primary-button" onClick={()=>preview?notice("Google OAuth is connected after Cloudflare deployment."):location.assign("/api/google/connect")}>Connect Google</button>}</div></Panel><Panel title="Today’s events" eyebrow="LIVE CALENDAR COPY" className="span-2">{events.length?<div className="timeline-list expanded">{events.map(item=><Timeline key={item.id} item={item}/>)}</div>:<Empty icon={CalendarDays} title="No events loaded" detail="Connect Calendar or refresh today."/>}</Panel><Panel title="Sync rules" eyebrow="SAFE BY DEFAULT"><Rule>Google remains the source of truth.</Rule><Rule>Silk creates linked Today items.</Rule><Rule>Completing an item does not edit Calendar.</Rule><button className="quiet-button full" onClick={refresh}><RefreshCw size={15}/> Refresh Calendar</button></Panel></div>}
function Projects({data,preview,refresh,notice}:{data:Project[];preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){const [name,setName]=useState("");const add=async(e:FormEvent)=>{e.preventDefault();if(!name.trim())return;if(preview)return notice("Deploy Silk to save projects.");try{await api("/api/projects",{method:"POST",body:JSON.stringify({name,priority:3})});setName("");await refresh()}catch(err){notice(err instanceof Error?err.message:"Could not create the project.")}};return <div className="page-grid"><Panel title="Private project tracker" eyebrow="SILK-ONLY DATA" className="span-3"><form className="inline-add" onSubmit={add}><input value={name} onChange={e=>setName(e.target.value)} placeholder="Create a project"/><button><Plus size={18}/></button></form><div className="project-board">{data.map(p=><article className="project-card" key={p.id}><header><span>{p.status}</span><em>P{p.priority}</em></header><h3>{p.name}</h3><p>{p.description||"No description yet."}</p><div className="progress"><i style={{width:`${p.task_count?p.done_tasks/p.task_count*100:0}%`}}/></div><small>{p.done_tasks}/{p.task_count} tasks complete</small><div className="project-tasks">{p.tasks?.filter(t=>t.status!=="done").slice(0,3).map(t=><span key={t.id}><Circle size={11}/>{t.title}</span>)}</div></article>)}</div></Panel></div>}
function Study({data}:{data:SilkData["study"]}){const sessions=(data.sessions||[]) as Array<Record<string,unknown>>;return <div className="page-grid"><Panel title="Learning signal" eyebrow="PRE-HEALTH REVIEW" className="span-2"><div className="hero-stat"><BookOpen/><div><strong>{sessions.length}</strong><span>saved study sessions</span></div></div><p className="panel-copy">Paste a graded study summary into Silk. She structures the grade, strengths, weak areas, topic scores, and next step, then saves the finished record to OneNote when connected.</p></Panel><Panel title="Priority gap" eyebrow="EVIDENCE FIRST">{data.weakest_topics?.length?data.weakest_topics.slice(0,4).map((t,i)=><div className="score-row" key={i}><span>{String(t.topic||"Topic")}</span><strong>{t.score==null?"—":`${t.score}%`}</strong></div>):<Empty icon={BookOpen} title="No graded topics" detail="Save a study session to build this view."/>}</Panel><Panel title="OneNote workflow" eyebrow="AUTOMATIC WHEN CONNECTED" className="span-3"><div className="pipeline"><span>ChatGPT recap</span><ChevronRight/><span>Silk structures evidence</span><ChevronRight/><span>Private D1 record</span><ChevronRight/><span>OneNote page</span></div><div className="sync-history">{sessions.slice(0,5).map(session=><article key={String(session.id)}><div><strong>{String(session.subject||"Study session")}</strong><span>{String(session.session_type||"Study session")}{session.overall_grade==null?"":` · ${session.overall_grade}%`}</span></div><em className={`sync-${String(session.onenote_sync_status||"pending")}`}>{String(session.onenote_sync_status||"pending")}</em></article>)}</div></Panel></div>}
function Workouts({data}:{data:SilkData["workouts"]}){return <div className="page-grid"><Panel title="Workout control" eyebrow="LIVE SESSION" className="span-2">{data.active?<div className="hero-stat"><Dumbbell/><div><strong>{String(data.active.name||"Active workout")}</strong><span>session in progress</span></div></div>:<Empty icon={Dumbbell} title="No workout running" detail="Tell Silk you are starting a workout."/>}<div className="workout-command">“I finished incline chest press at 70 lbs for 8 reps, RPE 8.”</div></Panel><Panel title="Health signal" eyebrow="NATIVE APP REQUIRED"><Signal icon={HeartPulse} label="Apple Health" value="Not connected" muted/><p className="panel-copy">HealthKit cannot be read by a website. A future iPhone companion will sync only approved categories.</p></Panel><Panel title="What Silk tracks" eyebrow="D1 WORKOUT HISTORY" className="span-3"><div className="feature-pills">{["Exercises","Weights","Reps","RPE","Warmups","PR history"].map(x=><span key={x}>{x}</span>)}</div></Panel></div>}

function MemoryView({data,preview,refresh,notice}:{data:Memory[];preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){const [mode,setMode]=useState<"library"|"map">("library");const [graph,setGraph]=useState<{nodes:GraphNode[];edges:GraphEdge[]}>({nodes:[],edges:[]});const [query,setQuery]=useState("");const [editing,setEditing]=useState<Memory|null>(null);const loadGraph=useCallback(async(search="")=>{if(preview)return setGraph(previewGraph(data,search));try{setGraph(await api(`/api/memory/graph?limit=52&query=${encodeURIComponent(search)}`))}catch(e){notice(e instanceof Error?e.message:"Could not load the memory map.")}},[data,notice,preview]);const remove=async(m:Memory)=>{if(!confirm(`Delete this memory?\n\n${m.content}`))return;if(preview)return notice("Preview memories cannot be deleted.");try{await api(`/api/memories/${m.id}`,{method:"DELETE"});await refresh()}catch(e){notice(e instanceof Error?e.message:"Could not delete memory.")}};const save=async(m:Memory)=>{if(preview){notice("Deploy Silk to edit real memories.");setEditing(null);return}try{await api(`/api/memories/${m.id}`,{method:"PATCH",body:JSON.stringify(m)});setEditing(null);await refresh()}catch(e){notice(e instanceof Error?e.message:"Could not update memory.")}};return <div className="page-grid"><section className="memory-toolbar span-3"><div><span className="eyebrow">SECOND BRAIN</span><h2>{data.length} durable memories</h2></div><div className="segmented"><button className={mode==="library"?"active":""} onClick={()=>setMode("library")}><Database size={15}/> Library</button><button className={mode==="map"?"active":""} onClick={()=>{setMode("map");void loadGraph(query)}}><Webhook size={15}/> Map</button></div></section>{mode==="library"?<Panel title="Memory library" eyebrow="VIEW · EDIT · DELETE · PRIVACY" className="span-3"><div className="memory-list">{data.map(m=><article className="memory-row" key={m.id}><i className={m.privacy||"personal"}/><div><header><span>{m.category}</span><small>{m.privacy||"personal"} · importance {m.importance}/5</small></header><p>{m.content}</p></div><div className="row-actions"><button onClick={()=>setEditing(m)}><Pencil size={15}/></button><button onClick={()=>remove(m)}><Trash2 size={15}/></button></div></article>)}</div></Panel>:<Panel title="Focused memory map" eyebrow="MAXIMUM 52 RELEVANT NODES" className="span-3"><form className="graph-search" onSubmit={e=>{e.preventDefault();void loadGraph(query)}}><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Focus on a person, project, course, or topic"/><button type="submit">Focus</button></form><Graph graph={graph}/></Panel>}{editing&&<MemoryEditor memory={editing} close={()=>setEditing(null)} save={save}/>}</div>}
function MemoryEditor({memory,close,save}:{memory:Memory;close:()=>void;save:(m:Memory)=>Promise<void>}){const [draft,setDraft]=useState(memory);return <div className="modal-backdrop"><form className="modal-panel" onSubmit={e=>{e.preventDefault();void save(draft)}}><header><div><span className="eyebrow">MEMORY CONTROL</span><h2>Edit memory</h2></div><button type="button" className="icon-button" onClick={close}><X size={18}/></button></header><label>Content<textarea value={draft.content} onChange={e=>setDraft({...draft,content:e.target.value})} rows={5}/></label><div className="form-grid"><label>Category<input value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}/></label><label>Privacy<select value={draft.privacy||"personal"} onChange={e=>setDraft({...draft,privacy:e.target.value as Memory["privacy"]})}><option value="public">Public context</option><option value="personal">Personal</option><option value="sensitive">Sensitive</option><option value="restricted">Restricted — never inject</option></select></label><label>Importance<select value={draft.importance} onChange={e=>setDraft({...draft,importance:Number(e.target.value)})}>{[1,2,3,4,5].map(x=><option key={x}>{x}</option>)}</select></label><label className="check-label"><input type="checkbox" checked={Boolean(draft.locked)} onChange={e=>setDraft({...draft,locked:e.target.checked?1:0})}/> Lock from automatic edits</label></div><div className="modal-actions"><button type="button" className="quiet-button" onClick={close}>Cancel</button><button className="primary-button">Save changes</button></div></form></div>}
function Graph({graph}:{graph:{nodes:GraphNode[];edges:GraphEdge[]}}){return <MemoryGalaxyWebGL nodes={graph.nodes} edges={graph.edges}/>}

function Integrations({data,preview,refresh,notice}:{data:SilkData;preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){
  const [sections,setSections]=useState<Array<{id:string;name:string}>>([]);const [section,setSection]=useState(data.microsoft.section_id||"");const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!preview&&data.microsoft.connected){api<{sections:Array<{id:string;name:string}>}>("/api/microsoft/sections").then(result=>setSections(result.sections)).catch(()=>setSections([]))}},[data.microsoft.connected,preview]);
  const disconnect=async(provider:"google"|"microsoft")=>{if(preview)return notice("Connections are disabled in preview mode.");if(!confirm(`Disconnect ${provider==="google"?"Google Calendar":"Microsoft OneNote"}?`))return;setBusy(true);try{await api(`/api/${provider}/disconnect`,{method:"POST",body:"{}"});await refresh();notice("Connection removed.")}catch(error){notice(error instanceof Error?error.message:"Could not disconnect.")}finally{setBusy(false)}};
  const saveSection=async()=>{const selected=sections.find(item=>item.id===section);if(!selected)return notice("Choose a OneNote section first.");setBusy(true);try{await api("/api/microsoft/settings",{method:"PATCH",body:JSON.stringify({section_id:selected.id,section_name:selected.name,auto_sync:true})});await refresh();notice(`Study notes will now save automatically to ${selected.name}.`)}catch(error){notice(error instanceof Error?error.message:"Could not select the OneNote section.")}finally{setBusy(false)}};
  const cards:Array<{icon:typeof Home;name:string;detail:string;status:string;connected:boolean;action?:()=>void;disconnect?:()=>void}>=[
    {icon:CalendarDays,name:"Google Calendar",detail:"Reads your schedule and writes only after confirmation.",status:data.google.connected?data.google.account_email||"Connected":data.google.configured?"Ready to authorize":"Secrets required",connected:data.google.connected,action:()=>!preview&&location.assign("/api/google/connect"),disconnect:()=>disconnect("google")},
    {icon:BookOpen,name:"Microsoft OneNote",detail:"Automatically saves structured study results to your chosen section.",status:data.microsoft.connected?data.microsoft.account_email||"Connected":data.microsoft.configured?"Ready to authorize":"Secrets required",connected:data.microsoft.connected,action:()=>!preview&&location.assign("/api/microsoft/connect"),disconnect:()=>disconnect("microsoft")},
    {icon:Search,name:"Tavily web search",detail:"Current web results with source links.",status:data.web.configured?"Available":"API key required",connected:Boolean(data.web.configured)},
    {icon:CloudSun,name:"Weather",detail:"No-key forecast data used by the morning briefing.",status:data.weather.status==="ready"?data.weather.location:"Set a home city",connected:data.weather.status==="ready"},
    {icon:Cloud,name:"OpenAI",detail:"Nano routes; Luna and Terra handle increasingly difficult work.",status:data.ai.primary_provider==="openai"?"Primary provider":"Cloudflare fallback",connected:data.ai.primary_provider==="openai"},
    {icon:Database,name:"Cloudflare D1",detail:"Private records, memory, projects, activity, and approvals.",status:preview?"Preview":"Bound and encrypted at rest",connected:!preview},
    {icon:HeartPulse,name:"Apple Health",detail:"HealthKit requires the future native iPhone companion.",status:"Not available in a website",connected:false},
    {icon:Wifi,name:"Local device bridge",detail:"Future bridge for files, lights, wake words, and local models.",status:"Planned after core software",connected:false},
  ];
  return <div className="page-grid"><Panel title="Connections" eyebrow="TRUTHFUL CAPABILITY STATUS" className="span-3"><div className="integration-grid">{cards.map(card=>{const Icon=card.icon;return <article className={`integration-card ${card.connected?"is-connected":""}`} key={card.name}><div className="connection-icon"><Icon/></div><div><h3>{card.name}</h3><p>{card.detail}</p><small>{card.status}</small></div><div className="integration-actions">{card.connected&&<span className="connected-chip"><Check size={13}/> Connected</span>}{!card.connected&&card.action&&<button className="quiet-button" onClick={card.action}>Set up</button>}{card.connected&&card.disconnect&&<button className="text-button danger" disabled={busy} onClick={card.disconnect}>Disconnect</button>}</div></article>})}</div></Panel>{data.microsoft.connected&&<Panel title="OneNote destination" eyebrow="AUTOMATIC STUDY WORKFLOW" className="span-2"><p className="panel-copy">Every new study record will save to this OneNote section. Silk keeps the D1 record even if Microsoft is temporarily unavailable, then shows the failed sync for retry.</p><div className="section-picker"><select value={section} onChange={event=>setSection(event.target.value)}><option value="">Choose a section</option>{sections.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary-button" disabled={busy||!section} onClick={saveSection}>Save destination</button></div></Panel>}<Panel title="Safety boundary" eyebrow="OWNER APPROVALS"><Rule>Reading connected data is automatic.</Rule><Rule>Calendar writes enter a confirmation queue.</Rule><Rule>Secrets never reach the browser or the AI prompt.</Rule><Rule>Disconnecting deletes the stored encrypted token.</Rule></Panel></div>
}

function ActivityView({data,preview,refresh,notice}:{data:SilkData;preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){const pending=data.approvals.filter(item=>item.status==="pending");const resolve=async(item:Approval,status:"approved"|"rejected")=>{if(preview)return notice("Preview approvals cannot be changed.");try{const result=await api<{executed?:boolean}>(`/api/approvals/${item.id}`,{method:"PATCH",body:JSON.stringify({status})});await refresh();notice(status==="approved"?(result.executed?"Action approved and completed.":"Action approved."):"Action rejected.")}catch(error){notice(error instanceof Error?error.message:"Could not update the approval.")}};return <div className="page-grid"><Panel title="Approval queue" eyebrow="YOU CONTROL EXTERNAL CHANGES" className="span-3">{pending.length?<div className="approval-list">{pending.map(item=><article className={`approval-card risk-${item.risk_level}`} key={item.id}><div className="approval-icon"><AlertTriangle/></div><div><span>{item.provider} · {item.risk_level} risk</span><h3>{item.summary}</h3><p>{item.action}{item.target?` · ${item.target}`:""}</p></div><div><button className="quiet-button" onClick={()=>resolve(item,"rejected")}>Reject</button><button className="primary-button" onClick={()=>resolve(item,"approved")}>Approve & run</button></div></article>)}</div>:<Empty icon={ShieldCheck} title="Nothing needs approval" detail="Risky external actions will wait here before they run."/>}</Panel><Panel title="Live activity history" eyebrow="AUDITABLE, NOT INVENTED" className="span-2"><div className="activity-feed">{data.activity.length?data.activity.map(item=><article key={item.id}><i className={item.status}/><div><strong>{humanAction(item.action)}</strong><span>{item.provider}{item.target?` · ${item.target}`:""}</span></div><time>{relative(item.created_at)}</time></article>):<Empty icon={Activity} title="No recorded activity" detail="Tool calls and connection changes will appear here."/>}</div></Panel><Panel title="What the Core displays" eyebrow="HONEST SYSTEM STATES"><Rule>Retrieval when D1 context is loading.</Rule><Rule>Search only while Tavily is running.</Rule><Rule>Calendar and sync only during those tools.</Rule><Rule>No chain-of-thought or fake reasoning text.</Rule></Panel></div>}

function AgentsView(){return <div className="page-grid"><Panel title="Agent workshop" eyebrow="DESIGNED · NOT ACTIVE YET" className="span-2"><div className="agent-lab-visual"><SilkCoreWebGL compact state="idle" label="Agent runtime locked"/><div className="future-hero"><Bot/><div><h3>Purpose-built local agents come after the local bridge.</h3><p>SILK will be able to create restricted agents for bounded jobs, but generated code will run in a sandbox, require tests, and need your approval before gaining tools.</p></div></div></div><div className="agent-blueprints"><Blueprint title="Study curator" detail="Structures results and syncs OneNote"/><Blueprint title="Project auditor" detail="Finds stalled tasks and missing next actions"/><Blueprint title="Morning operator" detail="Builds a brief from approved data sources"/></div></Panel><Panel title="Guardrails" eyebrow="NO SELF-REWRITING IN PRODUCTION"><Rule>Agents receive the minimum tools they need.</Rule><Rule>Generated changes are versioned and tested.</Rule><Rule>External writes require explicit approval.</Rule><Rule>Rollback remains available.</Rule></Panel></div>}

function DevicesView(){return <div className="page-grid"><Panel title="Device mesh" eyebrow="FUTURE LOCAL BRIDGE" className="span-2"><div className="device-map"><Device icon={Cloud} name="Cloudflare core" status="Online" ready/><Device icon={Database} name="Private D1" status="Online" ready/><Device icon={Cpu} name="Home bridge" status="Not installed"/><Device icon={HeartPulse} name="iPhone companion" status="Not built"/><Device icon={Radio} name="Raspberry Pi node" status="Optional later"/><Device icon={Wifi} name="Smart-home bridge" status="Not connected"/></div></Panel><Panel title="Why it waits" eyebrow="SOFTWARE FIRST"><p className="panel-copy">The web app, permissions, memory, calendar, OneNote, search, weather, and approval architecture should be stable before SILK is trusted with your computer or home.</p><Rule>No device is shown as connected unless it checks in.</Rule><Rule>Every bridge gets a revocable device key.</Rule><Rule>File and home actions stay permission-scoped.</Rule></Panel></div>}

function Blueprint({title,detail}:{title:string;detail:string}){return <article><Sparkles size={16}/><div><strong>{title}</strong><span>{detail}</span></div><em>Blueprint</em></article>}
function Device({icon:Icon,name,status,ready=false}:{icon:typeof Home;name:string;status:string;ready?:boolean}){return <article className={ready?"ready":""}><Icon/><div><strong>{name}</strong><span>{status}</span></div><i/></article>}
function SettingsView({data,preview,refresh,notice}:{data:SilkData;preview:boolean;refresh:()=>Promise<void>;notice:(s:string)=>void}){const [settings,setSettings]=useState(data.settings);const save=async()=>{if(preview)return notice("Preview settings are not persisted.");try{await api("/api/settings",{method:"PATCH",body:JSON.stringify(settings)});await refresh();notice("Settings saved.")}catch(e){notice(e instanceof Error?e.message:"Could not save settings.")}};const models=[["Router",data.ai.router_model||"gpt-5-nano","Commands, classification, and memory extraction"],["Routine",data.ai.routine_model||"gpt-5.6-luna","Normal assistant and tool work"],["Complex",data.ai.complex_model||"gpt-5.6-terra","Difficult analysis only"]];return <div className="page-grid"><Panel title="Model routing" eyebrow="REAL SERVER CONFIGURATION" className="span-2"><div className="model-stack">{models.map(m=><article key={m[0]}><span>{m[0]}</span><strong>{m[1]}</strong><small>{m[2]}</small></article>)}</div><div className="form-grid"><label className="field-label">Routing mode<select value={settings.model_mode} onChange={e=>setSettings({...settings,model_mode:e.target.value})}><option value="efficient">Efficient</option><option value="automatic">Automatic</option><option value="best">Best available</option></select></label><label className="field-label">Response length<select value={settings.response_length} onChange={e=>setSettings({...settings,response_length:e.target.value})}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label></div></Panel><Panel title="Usage & cost" eyebrow="THIS MONTH"><div className="hero-stat"><Gauge/><div><strong>{money(Number(data.usage.paid_cost_cad||0))}</strong><span>estimated paid OpenAI cost</span></div></div><div className="usage-lines"><span><small>Requests</small><strong>{Number(data.usage.requests||0)}</strong></span><span><small>USD guardrail</small><strong>${Number(data.ai.spend_limit_usd||data.usage.openai_spend_limit_usd||0).toFixed(2)}</strong></span><span><small>Remaining</small><strong>${Number(data.ai.remaining_usd||data.usage.openai_remaining_usd||0).toFixed(2)}</strong></span><span><small>Cloudflare neurons</small><strong>{Number(data.usage.neurons||0).toLocaleString()}</strong></span></div></Panel><Panel title="Morning brief" eyebrow="LOCATION + DAILY SEQUENCE" className="span-2"><div className="form-grid"><label className="field-label">Home city<input value={settings.home_city} onChange={e=>setSettings({...settings,home_city:e.target.value})}/></label><label className="field-label">Time zone<input value={settings.time_zone} onChange={e=>setSettings({...settings,time_zone:e.target.value})}/></label><label className="field-label">Temperature<select value={settings.temperature_unit} onChange={e=>setSettings({...settings,temperature_unit:e.target.value})}><option value="celsius">Celsius</option><option value="fahrenheit">Fahrenheit</option></select></label><label className="field-label">Morning sequence<select value={settings.morning_brief_enabled} onChange={e=>setSettings({...settings,morning_brief_enabled:e.target.value})}><option value="true">Enabled</option><option value="false">Disabled</option></select></label></div><p className="panel-copy">Any phrase containing “good morning” triggers weather, today’s Calendar, task progress, deadlines, and one evidence-led recommendation.</p></Panel><Panel title="Personality" eyebrow="FACTS BEFORE RECOMMENDATION"><label className="field-label">Owner name<input value={settings.owner_name} onChange={e=>setSettings({...settings,owner_name:e.target.value})}/></label><Rule>Evidence comes before advice.</Rule><Rule>Direct, calm, concise, and never theatrical.</Rule><Rule>No unnecessary repetition of what you just said.</Rule></Panel><button className="settings-save span-3" onClick={save}><Check size={17}/><span><strong>Save all settings</strong><small>Weather and future briefings update after saving</small></span></button><Panel title="Security posture" eyebrow="OWNER-ONLY" className="span-3"><div className="security-grid"><Signal icon={LockKeyhole} label="API secrets" value="Server-side Worker variables"/><Signal icon={ShieldCheck} label="Session" value="Secure same-origin cookie"/><Signal icon={Database} label="Memory" value="Private D1 + privacy controls"/></div></Panel></div>}

function Core({activity,data}:{activity:{state:CoreState;label:string};data:SilkData}){const pending=data.approvals.filter(item=>item.status==="pending").length;return <div className="core-panel"><div className="core-heading"><span className="eyebrow">SILK CORE</span><span className="online-chip"><i/> ONLINE</span></div><SilkCoreWebGL compact state={activity.state} label={activity.label}/><div className="core-models"><CoreLine label="Router" value={short(data.ai.router_model)}/><CoreLine label="Routine" value={short(data.ai.routine_model)}/><CoreLine label="Complex" value={short(data.ai.complex_model)}/></div><div className="core-systems"><span><i className={data.google.connected?"ok":""}/>Calendar</span><span><i className={data.microsoft.connected?"ok":""}/>OneNote</span><span><i className={data.web.configured?"ok":""}/>Web</span><span><i className="ok"/>Memory</span></div>{pending>0&&<div className="core-alert"><AlertTriangle size={14}/>{pending} action{pending===1?"":"s"} waiting</div>}<div className="core-note">Live states represent observable tool activity only. SILK never exposes or invents hidden reasoning.</div></div>}
function CoreLine({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>}
function minutes(v:number){const h=Math.floor(v/60),m=v%60;return h?`${h}h${m?` ${m}m`:""}`:`${m}m`}
function clock(v:number){return new Date(v*1000).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
function date(v:number){return new Date(v*1000).toLocaleDateString([],{month:"short",day:"numeric"})}
function relative(v:number){const m=Math.max(0,Math.round((Date.now()/1000-v)/60));return m<1?"just now":m<60?`${m}m ago`:`${Math.round(m/60)}h ago`}
function money(v:number){return new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(v||0)}
function short(v?:string){return String(v||"Not set").replace("gpt-5.6-","").replace("gpt-5-","").toUpperCase()}
function dayPart(){const hour=new Date().getHours();return hour<12?"Good morning":hour<18?"Good afternoon":"Good evening"}
function humanAction(value:string){return String(value||"activity").split("_").map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(" ")}
type SpeechResultEvent={results:ArrayLike<{0?:{transcript?:string}}>} ;
type SpeechRecognitionLike={lang:string;continuous:boolean;interimResults:boolean;onresult:((event:SpeechResultEvent)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;abort:()=>void};
type SpeechRecognitionConstructor=new()=>SpeechRecognitionLike;
function captureSpeech(){return new Promise<string>((resolve,reject)=>{const host=window as unknown as {SpeechRecognition?:SpeechRecognitionConstructor;webkitSpeechRecognition?:SpeechRecognitionConstructor};const Recognition=host.SpeechRecognition||host.webkitSpeechRecognition;if(!Recognition)return reject(new Error("Voice input is not supported in this browser."));const recognition=new Recognition();let settled=false;recognition.lang="en-CA";recognition.continuous=false;recognition.interimResults=false;const finish=(value:string)=>{if(settled)return;settled=true;resolve(value.trim())};recognition.onresult=event=>finish(event.results[0]?.[0]?.transcript||"");recognition.onerror=()=>{if(!settled){settled=true;reject(new Error("Silk could not hear that clearly."))}};recognition.onend=()=>finish("");recognition.start()})}
function previewGraph(memories:Memory[],query:string){const filtered=memories.filter(m=>!query||`${m.category} ${m.content}`.toLowerCase().includes(query.toLowerCase()));const nodes:GraphNode[]=[],edges:GraphEdge[]=[];const cats=new Map<string,number>();filtered.forEach(m=>{let id=cats.get(m.category);if(!id){id=10000+cats.size;cats.set(m.category,id);nodes.push({id,label:m.category,node_type:"category",privacy:"personal",importance:3})}nodes.push({id:m.id,label:m.content,node_type:"memory",privacy:m.privacy||"personal",importance:m.importance,memory_id:m.id});edges.push({id:m.id,source:m.id,target:id,relation:"category",weight:.8})});return{nodes,edges}}
