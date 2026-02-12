"use client";

import { useEffect, useState } from "react";
import { Plus, Github, ExternalLink, Activity, Package, X, Settings, RefreshCw } from "lucide-react";
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
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 w-full max-w-md animate-modal-enter shadow-2xl shadow-white/5">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-serif">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
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
  deployments?: any[];
  live_state?: string;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

  const [newProject, setNewProject] = useState({ 
    name: "", 
    repo_url: "", 
    install_command: "bun install", 
    build_command: "bun run build", 
    output_directory: "dist",
    root_directory: "",
    start_command: "bun run start",
    custom_port: 0,
    internal_port: 0
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fetchProjects = () => {
    fetch(`${API_URL}/api/v1/projects`)
      .then((res) => res.json())
      .then((data) => {
        setProjects(data || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch projects:", err);
        setLoading(false);
      });

    fetch(`${API_URL}/api/v1/stats`)
      .then((res) => res.json())
      .then((data) => setStats(data || {}))
      .catch((err) => console.error("Failed to fetch stats:", err));
  };

  useEffect(() => {
    fetchProjects();

    // WebSocket for real-time updates
    const ws = new WebSocket(`${API_URL.replace("http", "ws")}/ws`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "status") fetchProjects();
    };

    return () => ws.close();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/v1/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject),
      });
      if (res.ok) {
        setIsModalOpen(false);
        setNewProject({ 
          name: "", 
          repo_url: "", 
          install_command: "bun install", 
          build_command: "bun run build", 
          output_directory: "dist",
          root_directory: "",
          start_command: "bun run start",
          custom_port: 0,
          internal_port: 0
        });
        fetchProjects();
      } else {
        const data = await res.json();
        alert(`Error: ${data.error || "Failed to create project"}`);
      }
    } catch (err) {
      console.error("Failed to create project:", err);
      alert("Failed to connect to the server.");
    }
  };

  const handleDeleteProject = async (id: number) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Project",
      message: "This will permanently remove the project and all associated data. This action cannot be undone.",
      onConfirm: async () => {
        await fetch(`${API_URL}/api/v1/projects/${id}`, {
          method: "DELETE",
        });
        setConfirmModal(null);
        fetchProjects();
      }
    });
  };

  const handleDeploy = async (projectId: number) => {
    try {
      await fetch(`${API_URL}/api/v1/projects/${projectId}/deploy`, {
        method: "POST",
      });
      fetchProjects();
    } catch (err) {
      console.error("Failed to start deployment:", err);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8 font-sans animate-backdrop-fade">
      <header className="max-w-5xl mx-auto flex justify-between items-end mb-16">
        <div>
          <h1 className="text-6xl font-serif tracking-tight">Orchestro</h1>
          <p className="text-zinc-500 mt-2 text-lg">Deployments, simplified.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-white text-black px-6 py-2 rounded-full font-medium hover:bg-zinc-200 transition-colors flex items-center gap-2"
        >
          <Plus size={18} />
          New Project
        </button>
      </header>

      <main className="max-w-5xl mx-auto">
        {loading ? (
          <div className="space-y-12">
            <div className="grid grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-zinc-900/50 rounded-3xl border border-zinc-900 animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 bg-zinc-900/50 rounded-3xl border border-zinc-900 animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {stats && (
              <div className="grid grid-cols-3 gap-6 mb-12 animate-backdrop-fade">
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Total Projects</p>
                  <p className="text-3xl font-serif">{stats.total_projects}</p>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Active Containers</p>
                  <div className="flex items-center gap-2">
                    <p className="text-3xl font-serif">{stats.active_containers}</p>
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse mt-1" />
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Total Deployments</p>
                  <p className="text-3xl font-serif">{stats.total_deployments}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {projects.length === 0 ? (
                <div className="col-span-2 border border-dashed border-zinc-800 rounded-3xl p-20 text-center">
                  <Package className="mx-auto mb-4 text-zinc-700" size={48} />
                  <h2 className="text-2xl font-serif mb-2">No projects yet</h2>
                  <p className="text-zinc-500 mb-6">Connect a repository to get started.</p>
                  <button 
                    onClick={() => setIsModalOpen(true)}
                    className="text-white border border-zinc-700 px-6 py-2 rounded-full hover:bg-zinc-900 transition-colors"
                  >
                    Import Repository
                  </button>
                </div>
              ) : (
                projects.map((project, idx) => (
                  <div
                    key={project.id}
                    style={{ animationDelay: `${idx * 0.05}s` }}
                    className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 hover:border-zinc-700 transition-all group animate-float-up opacity-0"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-2xl font-serif">{project.name}</h3>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleDeploy(project.id)}
                          disabled={project.deployments?.[0]?.status === 'building'}
                          className={`text-xs px-3 py-1 rounded-full border transition-all flex items-center gap-2 ${
                            project.deployments?.[0]?.status === 'building' 
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-600 animate-pulse' 
                            : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-white'
                          }`}
                        >
                          {project.deployments?.[0]?.status === 'building' && <RefreshCw size={12} className="animate-spin" />}
                          {project.deployments?.[0]?.status === 'building' ? 'Building...' : project.deployments?.[0] ? 'Redeploy' : 'Deploy'}
                        </button>
                        {project.deployments?.[0]?.port !== undefined && project.deployments?.[0]?.status === 'ready' && (
                          <a 
                            href={`http://${window.location.hostname}:${project.deployments[0].port}`}
                            className="p-2 hover:bg-zinc-900 rounded-full"
                          >
                            <ExternalLink size={18} className="text-zinc-400" />
                          </a>
                        )}
                        <Link 
                          href={`/project/${project.id}`}
                          className="p-2 hover:bg-zinc-900 rounded-full group/edit"
                        >
                          <Settings size={18} className="text-zinc-400 group-hover/edit:text-white transition-colors" />
                        </Link>
                        <button 
                          onClick={() => handleDeleteProject(project.id)}
                          className="p-2 hover:bg-zinc-900 rounded-full group/del"
                        >
                          <X size={18} className="text-zinc-400 group-hover/del:text-red-500 transition-colors" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-zinc-500">
                      <div className="flex items-center gap-1">
                                            <Activity
                                              size={14}
                                              className={
                                                project.live_state === "running" || project.deployments?.[0]?.status === "ready"
                                                  ? "text-green-500"
                                                  : project.deployments?.[0]?.status === "failed"
                                                    ? "text-red-500"
                                                    : "text-zinc-500"
                                              }
                                            />
                        
                        <span className="capitalize">
                          {project.live_state === "running"
                            ? "Online"
                            : (project.deployments?.[0]?.status || "No deployments")}
                        </span>
                      </div>
                      <span>{project.branch}</span>
                      {project.deployments?.[0]?.port ? (
                        <span className="text-zinc-400 font-mono">
                          {typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:{project.deployments[0].port}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </main>

      {/* Confirmation Modal */}
      {confirmModal && (
        <CustomModal 
          isOpen={confirmModal.isOpen} 
          onClose={() => setConfirmModal(null)} 
          title={confirmModal.title}
        >
          <div className="space-y-6">
            <p className="text-zinc-400 text-sm leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmModal(null)}
                className="flex-1 border border-zinc-800 py-2.5 rounded-xl text-sm font-medium hover:bg-zinc-900 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmModal.onConfirm}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </CustomModal>
      )}

      {/* New Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-backdrop-fade">
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-10 w-full max-w-xl animate-modal-enter shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-serif">Connect Repository</h2>
                <p className="text-sm text-zinc-500 mt-1">Setup your project source and build pipeline.</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-white p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Project Name</label>
                  <input
                    required
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors"
                    placeholder="my-cool-app"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Git URL</label>
                  <input
                    required
                    type="url"
                    value={newProject.repo_url}
                    onChange={(e) => setNewProject({ ...newProject, repo_url: e.target.value })}
                    className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors"
                    placeholder="https://github.com/..."
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Root Directory</label>
                  <span className="text-[9px] text-zinc-600">Optional • Use for monorepos</span>
                </div>
                <input
                  type="text"
                  value={newProject.root_directory}
                  onChange={(e) => setNewProject({ ...newProject, root_directory: e.target.value })}
                  className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors"
                  placeholder="e.g. apps/api"
                />
              </div>

              <div className="pt-4 border-t border-zinc-900">
                <button 
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold hover:text-white flex items-center gap-2 mb-4"
                >
                  {showAdvanced ? "Hide Advanced Settings" : "Configure Build & Network"}
                  <div className={`w-1 h-1 rounded-full bg-zinc-700 transition-colors ${showAdvanced ? "bg-white" : ""}`} />
                </button>

                {showAdvanced && (
                  <div className="space-y-6 pt-2 animate-modal-enter">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Public Port</label>
                        <input
                          type="number"
                          value={newProject.custom_port || ""}
                          onChange={(e) => setNewProject({ ...newProject, custom_port: parseInt(e.target.value) || 0 })}
                          placeholder="Auto (3000+)"
                          className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Internal Port</label>
                        <input
                          type="number"
                          value={newProject.internal_port || ""}
                          onChange={(e) => setNewProject({ ...newProject, internal_port: parseInt(e.target.value) || 0 })}
                          placeholder="App port (e.g. 3000)"
                          className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-white transition-colors"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Install Command</label>
                        <input
                          type="text"
                          value={newProject.install_command}
                          onChange={(e) => setNewProject({ ...newProject, install_command: e.target.value })}
                          className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors"
                          placeholder="e.g. bun install"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Build Command</label>
                        <input
                          type="text"
                          value={newProject.build_command}
                          onChange={(e) => setNewProject({ ...newProject, build_command: e.target.value })}
                          className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors"
                          placeholder="e.g. bun run build"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold ml-1">Start Command</label>
                      <input
                        type="text"
                        value={newProject.start_command}
                        onChange={(e) => setNewProject({ ...newProject, start_command: e.target.value })}
                        className="w-full bg-black border border-zinc-900 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-white transition-colors"
                        placeholder="e.g. bun run start"
                      />
                      <p className="text-[9px] text-zinc-600 ml-1">The command that launches your server (final step).</p>
                    </div>
                  </div>
                )}
              </div>

              <button className="w-full bg-white text-black font-bold py-4 rounded-2xl hover:bg-zinc-200 transition-all active:scale-[0.98] mt-4 flex items-center justify-center gap-2">
                <Plus size={20} strokeWidth={3} />
                Create Project
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
