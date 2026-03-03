"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Activity,
  Github,
  ExternalLink,
  Terminal,
  FileCode,
  Settings,
  RefreshCw,
  Archive,
  X,
  Pause,
  Play,
  Package,
} from "lucide-react";
import Link from "next/link";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function CustomModal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-backdrop-fade">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 w-full max-w-md animate-modal-enter">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-serif">{title}</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface Project {
  id: number;
  name: string;
  repo_url: string;
  branch: string;
  root_directory: string;
  install_command: string;
  build_command: string;
  start_command: string;
  output_directory: string;
  custom_port: number;
  internal_port: number;
  docker_compose: string;
  custom_dockerfile: string;
  webhook_secret: string;
  git_provider: string;
  webhook_branch: string;
  deployments?: any[];
  env_vars?: any[];
  backups?: any[];
  volumes?: any[];
}

export default function ProjectPage() {
  const { id } = useParams();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [liveInfo, setLiveInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [logType, setLogType] = useState<"build" | "runtime">("build");
  const [logs, setLogs] = useState("");
  const [runtimeLogs, setRuntimeLogs] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isVolumeModalOpen, setIsVolumeModalOpen] = useState(false);
  const [newEnv, setNewEnv] = useState({ key: "", value: "" });
  const [newVolume, setNewVolume] = useState({ host_path: "", container_path: "" });
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  const fetchRuntimeLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/projects/${id}/logs/runtime`);
      if (res.ok) {
        const text = await res.text();
        setRuntimeLogs(text);
      }
    } catch (err) {
      console.error("Failed to fetch runtime logs:", err);
    }
  };

  const fetchProject = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/projects/${id}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      const data = await res.json();
      setProject(data.project || null);
      setLiveInfo(data.live || {});
      if (data.project?.deployments?.[0]?.logs && logs === "")
        setLogs(data.project.deployments[0].logs || "");
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProject();
    let ws: WebSocket;
    let reconnectTimeout: NodeJS.Timeout;
    const connect = () => {
      ws = new WebSocket(`${API_URL.replace("http", "ws")}/ws`);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.project_id === Number(id)) {
          if (data.type === "log") setLogs((prev) => prev + data.log);
          else if (data.type === "status") fetchProject();
        }
      };
    };
    connect();
    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, [id, API_URL]);

  useEffect(() => {
    if (logType === "runtime" && activeTab === "logs") {
      const interval = setInterval(fetchRuntimeLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [logType, activeTab, id]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, runtimeLogs]);

  const handleDeploy = async () => {
    setLogs("Starting deployment...\n");
    await fetch(`${API_URL}/api/v1/projects/${id}/deploy`, { method: "POST" });
    fetchProject();
  };

  const handlePause = async () => {
    setIsActionLoading(true);
    try {
      await fetch(`${API_URL}/api/v1/projects/${id}/pause`, { method: "POST" });
      fetchProject();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResume = async () => {
    setIsActionLoading(true);
    try {
      await fetch(`${API_URL}/api/v1/projects/${id}/resume`, { method: "POST" });
      fetchProject();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUpdateProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!project) return;
    setIsSaving(true);
    try {
      await fetch(`${API_URL}/api/v1/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      fetchProject();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnv.key || !newEnv.value) return;
    await fetch(`${API_URL}/api/v1/projects/${id}/env`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEnv),
    });
    setIsEnvModalOpen(false);
    setNewEnv({ key: "", value: "" });
    fetchProject();
  };

  const handleDeleteEnv = async (envId: number) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Variable",
      message: "Are you sure you want to delete this environment variable?",
      onConfirm: async () => {
        await fetch(`${API_URL}/api/v1/projects/${id}/env/${envId}`, { method: "DELETE" });
        setConfirmModal(null);
        fetchProject();
      },
    });
  };

  const handleAddVolume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVolume.host_path || !newVolume.container_path) return;
    await fetch(`${API_URL}/api/v1/projects/${id}/volumes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newVolume),
    });
    setIsVolumeModalOpen(false);
    setNewVolume({ host_path: "", container_path: "" });
    fetchProject();
  };

  const handleDeleteVolume = async (volumeId: number) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Volume",
      message: "Are you sure you want to remove this volume mapping?",
      onConfirm: async () => {
        await fetch(`${API_URL}/api/v1/projects/${id}/volumes/${volumeId}`, { method: "DELETE" });
        setConfirmModal(null);
        fetchProject();
      },
    });
  };

  const handleCreateBackup = async () => {
    await fetch(`${API_URL}/api/v1/projects/${id}/backups`, { method: "POST" });
    fetchProject();
  };

  if (!project) return (
    <div className="min-h-screen bg-black text-white font-sans p-8">
      <div className="max-w-6xl mx-auto space-y-12">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div className="w-10 h-10 bg-zinc-900 rounded-full animate-pulse" />
            <div className="w-48 h-8 bg-zinc-900 rounded-xl animate-pulse" />
          </div>
          <div className="flex gap-3">
            <div className="w-24 h-10 bg-zinc-900 rounded-full animate-pulse" />
            <div className="w-24 h-10 bg-zinc-900 rounded-full animate-pulse" />
          </div>
        </div>
        <div className="h-px bg-zinc-900" />
        <div className="grid grid-cols-3 gap-8">
          <div className="col-span-2 h-64 bg-zinc-900/50 rounded-3xl animate-pulse" />
          <div className="h-64 bg-zinc-900/50 rounded-3xl animate-pulse" />
        </div>
      </div>
    </div>
  );

  const currentStatus = project.deployments?.[0]?.status || "no deployments";
  const currentPort = project.deployments?.[0]?.port;
  const externalUrl = currentPort ? `http://${window.location.hostname}:${currentPort}` : "#";

  return (
    <div className="min-h-screen bg-black text-white font-sans animate-backdrop-fade">
      <nav className="border-b border-zinc-900 p-4 sticky top-0 bg-black/80 backdrop-blur-md z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-zinc-500 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <h1 className="text-2xl font-serif">{project.name}</h1>
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs">
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${currentStatus === "ready" || liveInfo?.state === "running" ? "bg-green-500" : "bg-zinc-500"}`}
                          />
                          <span className="capitalize">{currentStatus}</span>
                        </div>
            
          </div>
          <div className="flex gap-3">
            {currentStatus === "ready" ? (
              <button 
                onClick={handlePause} 
                disabled={isActionLoading} 
                className="border border-zinc-800 px-4 py-1.5 rounded-full text-sm font-medium hover:bg-zinc-900 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isActionLoading ? <RefreshCw size={16} className="animate-spin" /> : <Pause size={16} />}
                {isActionLoading ? "Pausing..." : "Pause"}
              </button>
            ) : currentStatus === "paused" ? (
              <button 
                onClick={handleResume} 
                disabled={isActionLoading} 
                className="bg-zinc-900 border border-zinc-800 px-4 py-1.5 rounded-full text-sm font-medium hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isActionLoading ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                {isActionLoading ? "Resuming..." : "Resume"}
              </button>
            ) : null}
            <button onClick={handleDeploy} disabled={currentStatus === "building"} className="bg-white text-black px-4 py-1.5 rounded-full text-sm font-medium hover:bg-zinc-200 transition-all flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={16} className={currentStatus === "building" ? "animate-spin" : ""} />
              {currentStatus === "building" ? "Building..." : project.deployments?.length ? "Redeploy" : "Deploy"}
            </button>
            {currentStatus === "ready" && (
              <a href={externalUrl} className="border border-zinc-800 px-4 py-1.5 rounded-full text-sm font-medium hover:bg-zinc-900 transition-colors flex items-center gap-2">
                <ExternalLink size={16} /> Open App
              </a>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-8 animate-float-up">
        <div className="flex gap-8 border-b border-zinc-900 mb-8">
          {[
            { id: "overview", label: "Overview", icon: Activity },
            { id: "logs", label: "Logs", icon: Terminal },
            { id: "data", label: "Data Manager", icon: FileCode },
            { id: "backups", label: "Backups", icon: Archive },
            { id: "settings", label: "Settings", icon: Settings },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 pb-4 text-sm font-medium transition-colors relative ${activeTab === tab.id ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
              <tab.icon size={16} /> {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {activeTab === "overview" && (
            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 space-y-6">
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8">
                  <h3 className="text-xl font-serif mb-4 text-zinc-300">Deployment Details</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between border-b border-zinc-900 pb-4">
                      <span className="text-zinc-500">Repository</span>
                      <a href={project.repo_url} className="flex items-center gap-1 text-zinc-300 hover:text-white">{project.repo_url} <Github size={14} /></a>
                    </div>
                    <div className="flex justify-between border-b border-zinc-900 pb-4">
                      <span className="text-zinc-500">Branch</span>
                      <span className="text-zinc-300">{project.branch}</span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-900 pb-4">
                      <span className="text-zinc-500">Build Command</span>
                      {project.build_command ? <code className="bg-black px-2 py-0.5 rounded text-zinc-400">{project.build_command}</code> : <span className="text-zinc-600 italic text-sm">No build step required</span>}
                    </div>
                    <div className="flex justify-between border-b border-zinc-900 pb-4">
                      <span className="text-zinc-500">Start Command</span>
                      <code className="bg-black px-2 py-0.5 rounded text-zinc-400">{project.start_command || "bun run start"}</code>
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6">
                  <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">Status</h4>
                                    <div className="flex items-center gap-3">
                                      <div
                                        className={`w-3 h-3 rounded-full ${
                                          liveInfo?.state === "running" ||
                                          currentStatus === "ready"
                                            ? "bg-green-500"
                                            : currentStatus === "paused"
                                              ? "bg-yellow-500"
                                              : currentStatus === "failed"
                                                ? "bg-red-500"
                                                : currentStatus === "building"
                                                  ? "bg-blue-500 animate-pulse"
                                                  : "bg-zinc-700 animate-pulse"
                                        }`}
                                      />
                                      <span className="text-lg font-medium capitalize">
                                        {liveInfo?.state === "running" ? "Online" : currentStatus}
                                      </span>
                                    </div>
                  
                  {liveInfo?.memory > 0 && (
                    <div className="mt-4 bg-black/40 border border-zinc-900 rounded-2xl p-4">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold mb-1">Memory Usage</p>
                      <p className="text-xl font-mono text-zinc-300">{(liveInfo.memory / 1024 / 1024).toFixed(1)} <span className="text-xs text-zinc-500">MB</span></p>
                    </div>
                  )}
                  <div className="mt-6 space-y-3 pt-6 border-t border-zinc-900">
                    <div className="flex justify-between items-center text-[11px]"><span className="text-zinc-500">Public Port</span><span className="font-mono text-zinc-300 bg-white/5 px-2 py-0.5 rounded">{currentPort || "---"}</span></div>
                    {project.deployments?.[0]?.created_at && <div className="flex justify-between items-center text-[11px]"><span className="text-zinc-500">Last Deploy</span><span className="text-zinc-300">{new Date(project.deployments[0].created_at).toLocaleDateString()}</span></div>}
                  </div>
                  {wsConnected && <div className="mt-4 text-[10px] text-zinc-600 flex items-center gap-1"><div className="w-1 h-1 bg-green-500 rounded-full" /> Live Updates Connected</div>}
                </div>
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="bg-zinc-950 border border-zinc-900 rounded-3xl overflow-hidden flex flex-col h-[60vh] animate-modal-enter">
              <div className="bg-zinc-900/50 p-4 border-b border-zinc-900 flex justify-between items-center">
                <div className="flex gap-4">
                  <button onClick={() => setLogType("build")} className={`text-[10px] uppercase tracking-widest font-bold transition-colors ${logType === "build" ? "text-white" : "text-zinc-600 hover:text-zinc-400"}`}>Build Logs</button>
                  <button onClick={() => setLogType("runtime")} className={`text-[10px] uppercase tracking-widest font-bold transition-colors ${logType === "runtime" ? "text-white" : "text-zinc-600 hover:text-zinc-400"}`}>Runtime Logs</button>
                </div>
                <button onClick={() => logType === "build" ? setLogs("") : setRuntimeLogs("")} className="text-xs text-zinc-500 hover:text-white">Clear</button>
              </div>
              <pre className="p-6 overflow-auto font-mono text-xs text-zinc-400 whitespace-pre-wrap flex-1 scrollbar-hide">
                {logType === "build" ? (logs || "Waiting for deployment logs...") : (runtimeLogs || "Container logs will appear here when the app is ready.")}
                <div ref={logEndRef} />
              </pre>
            </div>
          )}

          {activeTab === "data" && (
            <div className="space-y-8 animate-modal-enter pb-20">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 flex flex-col h-[400px]">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2"><Terminal size={18} className="text-zinc-500" /><h3 className="text-lg font-serif">Environment</h3></div>
                    <button onClick={() => setIsEnvModalOpen(true)} className="text-[10px] uppercase tracking-widest font-bold bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">Add Var</button>
                  </div>
                  <div className="space-y-2 overflow-y-auto pr-2 flex-1 scrollbar-hide">
                    {project.env_vars?.length === 0 ? <div className="h-full flex items-center justify-center border border-dashed border-zinc-900 rounded-2xl italic text-zinc-600 text-xs">No variables defined</div> : project.env_vars?.map((ev: any) => (
                      <div key={ev.id} className="flex justify-between items-center bg-black/40 border border-zinc-900 p-3 rounded-xl group transition-colors hover:border-zinc-800">
                        <div className="flex flex-col gap-0.5 overflow-hidden"><span className="text-[10px] text-zinc-600 font-bold uppercase tracking-tighter">Key</span><code className="text-zinc-400 text-[11px] font-mono truncate">{ev.key}</code></div>
                        <button onClick={() => handleDeleteEnv(ev.id)} className="p-2 text-zinc-700 hover:text-red-500 transition-colors"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 flex flex-col h-[400px]">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2"><Archive size={18} className="text-zinc-500" /><h3 className="text-lg font-serif">Volumes</h3></div>
                    <button onClick={() => setIsVolumeModalOpen(true)} className="text-[10px] uppercase tracking-widest font-bold bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">Add Mount</button>
                  </div>
                  <div className="space-y-2 overflow-y-auto pr-2 flex-1 scrollbar-hide">
                    {project.volumes?.length === 0 ? <div className="h-full flex items-center justify-center border border-dashed border-zinc-900 rounded-2xl italic text-zinc-600 text-xs">No persistent volumes</div> : project.volumes?.map((v: any) => (
                      <div key={v.id} className="bg-black/40 border border-zinc-900 p-3 rounded-xl group transition-colors hover:border-zinc-800 relative">
                        <div className="flex flex-col gap-2 overflow-hidden">
                          <div className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-zinc-700" /><code className="text-[10px] text-zinc-500 truncate">{v.host_path}</code></div>
                          <div className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-blue-500" /><code className="text-[11px] text-zinc-300 truncate">{v.container_path}</code></div>
                        </div>
                        <button onClick={() => handleDeleteVolume(v.id)} className="absolute top-3 right-3 p-1.5 text-zinc-700 hover:text-red-500 transition-colors"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 flex flex-col h-[400px]">
                  <div className="flex items-center gap-2 mb-6"><FileCode size={18} className="text-zinc-500" /><h3 className="text-lg font-serif">Custom Dockerfile</h3></div>
                  <div className="relative flex-1 group">
                    <textarea value={project.custom_dockerfile || ""} onChange={(e) => setProject({ ...project, custom_dockerfile: e.target.value })} className="w-full h-full bg-black border border-zinc-900 rounded-2xl p-4 font-mono text-[10px] text-zinc-500 focus:outline-none focus:border-zinc-700 resize-none scrollbar-hide transition-colors" placeholder="Override auto-generated Dockerfile. Leave empty to use default..." />
                    <div className="absolute bottom-4 right-4"><button onClick={() => handleUpdateProject()} disabled={isSaving} className="bg-white text-black px-4 py-2 rounded-xl text-[10px] uppercase font-bold hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50">{isSaving ? "Saving..." : "Save Config"}</button></div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-zinc-950 border border-zinc-900 rounded-3xl p-8">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3"><Activity size={20} className="text-zinc-500" /><h3 className="text-xl font-serif">Deployment History</h3></div>
                    <span className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">{project.deployments?.length || 0} Records</span>
                  </div>
                  <div className="space-y-3">
                    {project.deployments?.length === 0 ? <div className="py-12 text-center text-zinc-700 italic bg-black/20 border border-dashed border-zinc-900 rounded-2xl">No deployment history available</div> : project.deployments?.slice(0, 5).map((d: any) => (
                      <div key={d.id} className="flex justify-between items-center bg-black/40 border border-zinc-900 p-4 rounded-2xl group hover:border-zinc-800 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={`w-2 h-2 rounded-full ${d.status === "ready" ? "bg-green-500" : d.status === "failed" ? "bg-red-500" : "bg-zinc-700"}`} />
                          <div><p className="text-sm font-medium capitalize text-zinc-300">{d.status}</p><p className="text-[10px] text-zinc-600 font-mono">{new Date(d.created_at).toLocaleString()}</p></div>
                        </div>
                        <button onClick={() => { setLogs(d.logs); setActiveTab("logs"); }} className="text-[10px] uppercase font-bold text-zinc-500 group-hover:text-white transition-colors flex items-center gap-2"><Terminal size={14} /> Inspect Logs</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 opacity-40 grayscale pointer-events-none h-full">
                    <h3 className="text-lg font-serif mb-4">Workspace</h3>
                    <div className="py-8 text-center border border-dashed border-zinc-800 rounded-2xl"><Package size={32} className="mx-auto text-zinc-800 mb-2" /><p className="text-[10px] uppercase font-bold text-zinc-700">Storage Explorer</p><p className="text-[9px] text-zinc-800 mt-1">Coming in V2</p></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "backups" && (
            <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 animate-modal-enter">
              <div className="flex justify-between items-center mb-8">
                <div><h3 className="text-2xl font-serif">Project Backups</h3><p className="text-zinc-500 text-sm mt-1">Manual snapshots of your database and volumes.</p></div>
                <button onClick={handleCreateBackup} className="bg-white text-black px-6 py-2 rounded-full font-medium hover:bg-zinc-200 transition-colors">Create Backup</button>
              </div>
              <div className="space-y-4">
                {project.backups?.length === 0 ? <div className="py-20 text-center text-zinc-600">No backups created yet.</div> : project.backups?.map((b: any) => (
                  <div key={b.id} className="flex justify-between items-center bg-zinc-900/30 border border-zinc-900 p-4 rounded-2xl">
                    <div className="flex items-center gap-4"><Archive className="text-zinc-500" size={20} /><div><p className="text-sm font-medium">{new Date(b.created_at).toLocaleString()}</p><p className="text-xs text-zinc-500">{(b.size / 1024 / 1024).toFixed(2)} MB</p></div></div>
                    <a href={`${API_URL}/api/v1/backups/${b.id}/download`} download className="text-xs text-zinc-400 hover:text-white transition-colors bg-white/5 border border-white/10 px-3 py-1 rounded-lg">Download</a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-12 pb-20 animate-modal-enter">
              <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 max-w-3xl">
                                <div className="flex items-center gap-3 mb-8">
                                  <Github size={20} className="text-zinc-500" />
                                  <div>
                                    <h3 className="text-xl font-serif">Source Configuration</h3>
                                    <p className="text-xs text-zinc-500">
                                      Repository and workspace settings.
                                    </p>
                                  </div>
                                </div>
                
                <form onSubmit={handleUpdateProject} className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Repository URL</label><input type="text" value={project.repo_url || ""} onChange={(e) => setProject({ ...project, repo_url: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" /></div>
                    <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Branch</label><input type="text" value={project.branch || ""} onChange={(e) => setProject({ ...project, branch: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" /></div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center ml-1"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Root Directory</label><span className="text-[9px] text-zinc-600">Optional • Subfolder for monorepos</span></div>
                    <input type="text" value={project.root_directory || ""} onChange={(e) => setProject({ ...project, root_directory: e.target.value })} placeholder="e.g. apps/web" className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" />
                  </div>
                                    <div className="pt-4 border-t border-zinc-900 mt-8">
                                      <div className="flex items-center gap-3 mb-8">
                                        <Terminal size={20} className="text-zinc-500" />
                                        <div>
                                          <h3 className="text-xl font-serif">Build & Runtime</h3>
                                          <p className="text-xs text-zinc-500">
                                            How your application starts and runs.
                                          </p>
                                        </div>
                                      </div>
                  
                    <div className="grid grid-cols-2 gap-6 mb-6">
                      <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Install Cmd</label><input type="text" value={project.install_command || ""} onChange={(e) => setProject({ ...project, install_command: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors" /></div>
                      <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Build Cmd</label><input type="text" value={project.build_command || ""} onChange={(e) => setProject({ ...project, build_command: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-6 mb-6">
                      <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Start Cmd</label><input type="text" value={project.start_command || ""} onChange={(e) => setProject({ ...project, start_command: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors" /></div>
                      <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Output Dir</label><input type="text" value={project.output_directory || ""} onChange={(e) => setProject({ ...project, output_directory: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Public Port</label><input type="number" value={project.custom_port || ""} onChange={(e) => setProject({ ...project, custom_port: parseInt(e.target.value) || 0 })} placeholder="Auto" className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" /></div>
                      <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Internal Port</label><input type="number" value={project.internal_port || ""} onChange={(e) => setProject({ ...project, internal_port: parseInt(e.target.value) || 0 })} placeholder="80" className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" /></div>
                    </div>
                  </div>
                  <div className="pt-6"><button disabled={isSaving} className="bg-white text-black px-8 py-3 rounded-2xl text-sm font-bold hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50">{isSaving ? "Updating Project..." : "Save All Changes"}</button></div>
                </form>
              </div>

                            <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 max-w-3xl">

                              <div className="flex items-center gap-3 mb-8">

                                <RefreshCw size={20} className="text-zinc-500" />

                                <div>

                                  <h3 className="text-xl font-serif">Automated Webhooks</h3>

                                  <p className="text-xs text-zinc-500">

                                    Deploy automatically on git push.

                                  </p>

                                </div>

                              </div>

              
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Provider</label><select value={project.git_provider || ""} onChange={(e) => setProject({ ...project, git_provider: e.target.value })} className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white appearance-none transition-colors"><option value="">None</option><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></div>
                    <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Watch Branch</label><input type="text" value={project.webhook_branch || ""} onChange={(e) => setProject({ ...project, webhook_branch: e.target.value })} placeholder="main" className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" /></div>
                  </div>
                  <div className="space-y-1.5"><label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Webhook Secret</label><input type="password" value={project.webhook_secret || ""} onChange={(e) => setProject({ ...project, webhook_secret: e.target.value })} placeholder="••••••••••••••••" className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors" /></div>
                  <div className="mt-6 bg-black/40 border border-zinc-900 rounded-2xl p-4 transition-colors hover:border-zinc-800">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 ml-1">
                      Target Webhook URL
                    </p>
                    <div className="flex items-center gap-3">
                      <code className="flex-1 text-sm text-zinc-400 break-all font-mono leading-relaxed">
                        {`${API_URL}/api/v1/webhooks/${id}/${project.git_provider || "provider"}`}
                      </code>
                    </div>
                  </div>
                  
                  <button onClick={() => handleUpdateProject()} disabled={isSaving} className="text-xs bg-zinc-900 border border-zinc-800 px-6 py-2.5 rounded-xl font-medium hover:bg-zinc-800 transition-all active:scale-95">Update Webhook</button>
                </div>
              </div>

              <div className="bg-red-500/5 border border-red-500/10 rounded-3xl p-8 max-w-3xl flex justify-between items-center">
                <div><h3 className="text-xl font-serif text-red-500">Danger Zone</h3><p className="text-xs text-zinc-500 mt-1">Delete project, logs, and containers forever.</p></div>
                <button onClick={() => setConfirmModal({ isOpen: true, title: "Delete Project", variant: "danger", message: "This will permanently remove the project and all associated data. This action cannot be undone.", onConfirm: async () => { await fetch(`${API_URL}/api/v1/projects/${id}`, { method: "DELETE" }); router.push("/"); } })} className="bg-red-500/10 text-red-500 border border-red-500/20 px-6 py-2.5 rounded-xl hover:bg-red-500/20 transition-all active:scale-95 text-xs font-bold">Delete Project</button>
              </div>
            </div>
          )}
        </div>
      </main>

      <CustomModal isOpen={isEnvModalOpen} onClose={() => setIsEnvModalOpen(false)} title="Add Environment Variable">
        <form onSubmit={handleAddEnv} className="space-y-4">
          <div><label className="block text-xs text-zinc-500 mb-1">Variable Key</label><input required type="text" value={newEnv.key} onChange={(e) => setNewEnv({ ...newEnv, key: e.target.value })} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-white transition-colors" placeholder="API_KEY" /></div>
          <div><label className="block text-xs text-zinc-500 mb-1">Variable Value</label><input required type="text" value={newEnv.value} onChange={(e) => setNewEnv({ ...newEnv, value: e.target.value })} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-white transition-colors" placeholder="secret_value_123" /></div>
          <button className="w-full bg-white text-black font-medium py-3 rounded-xl hover:bg-zinc-200 transition-colors mt-4">Add Variable</button>
        </form>
      </CustomModal>

      <CustomModal isOpen={isVolumeModalOpen} onClose={() => setIsVolumeModalOpen(false)} title="Add Docker Volume">
        <form onSubmit={handleAddVolume} className="space-y-4">
          <div><label className="block text-xs text-zinc-500 mb-1">Host Path (Machine)</label><input required type="text" value={newVolume.host_path} onChange={(e) => setNewVolume({ ...newVolume, host_path: e.target.value })} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-white transition-colors" placeholder="/home/user/data" /></div>
          <div><label className="block text-xs text-zinc-500 mb-1">Container Path</label><input required type="text" value={newVolume.container_path} onChange={(e) => setNewVolume({ ...newVolume, container_path: e.target.value })} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-white transition-colors" placeholder="/app/data" /></div>
          <p className="text-[10px] text-zinc-600 leading-relaxed italic">Note: Changes will take effect after the next redeployment.</p>
          <button className="w-full bg-white text-black font-medium py-3 rounded-xl hover:bg-zinc-200 transition-colors mt-4">Add Volume</button>
        </form>
      </CustomModal>

      {confirmModal && (
        <CustomModal isOpen={confirmModal.isOpen} onClose={() => setConfirmModal(null)} title={confirmModal.title || "Confirmation"}>
          <div className="space-y-6">
            <p className="text-zinc-400 text-sm leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)} className="flex-1 border border-zinc-800 py-2.5 rounded-xl text-sm font-medium hover:bg-zinc-900 transition-colors">Cancel</button>
              <button onClick={confirmModal.onConfirm} className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95 ${confirmModal.variant === "danger" ? "bg-red-500 text-white hover:bg-red-600" : "bg-white text-black hover:bg-zinc-200"}`}>Confirm</button>
            </div>
          </div>
        </CustomModal>
      )}
    </div>
  );
}
