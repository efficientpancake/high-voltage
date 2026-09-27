"use client";

// Cloud workspace: signed-in user, sidebar of saved projects, and autosave to
// Supabase. The Studio (the brief wizard + agents) renders inside it and reports
// changes through onChange; this component decides when to write them.
import { useState, useEffect, useRef, useCallback } from "react";
import { getBrowserSupabase } from "../lib/supabase";

const SAVE_DEBOUNCE_MS = 1500;  // save 1.5s after the last change...
const SAVE_MAX_WAIT_MS = 8000;  // ...but at least every 8s while agents stream
const LEGACY_KEYS = ["vm_view", "vm_brief", "vm_outputs", "vm_activeTab", "vm_chats"];

function titleFor(brief) {
  return brief?.name?.trim() || brief?.industry?.trim() || "Untitled project";
}

// Work saved in this browser before cloud saving existed. Imported once.
function readLegacyProject() {
  try {
    const get = (k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; };
    const brief = get("vm_brief");
    if (!brief) return null;
    return {
      view: get("vm_view") || "wizard",
      brief,
      outputs: get("vm_outputs") || {},
      active_tab: get("vm_activeTab") || 0,
      chats: get("vm_chats") || {},
      title: titleFor(brief),
    };
  } catch { return null; }
}

export default function Workspace({ children }) {
  const [user, setUser]           = useState(null);
  const [projects, setProjects]   = useState([]);   // [{ id, title, updated_at }]
  const [current, setCurrent]     = useState(null); // full row of the open project
  const [saveState, setSaveState] = useState("saved"); // saved | saving | error
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadError, setLoadError] = useState("");

  const pending    = useRef(null); // { id, patch } not yet written
  const debounceT  = useRef(null);
  const maxWaitT   = useRef(null);

  // ─── Saving ────────────────────────────────────────────────────────────────

  const flush = useCallback(async () => {
    clearTimeout(debounceT.current); debounceT.current = null;
    clearTimeout(maxWaitT.current);  maxWaitT.current = null;
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    setSaveState("saving");
    const updated_at = new Date().toISOString();
    const { error } = await getBrowserSupabase().from("projects").update({ ...job.patch, updated_at }).eq("id", job.id);
    if (error) {
      // Put the patch back so the next change retries it.
      pending.current = { id: job.id, patch: { ...job.patch, ...(pending.current?.patch || {}) } };
      setSaveState("error");
      return;
    }
    setSaveState(pending.current ? "saving" : "saved");
    setProjects(ps => ps
      .map(p => p.id === job.id ? { ...p, updated_at, ...(job.patch.title ? { title: job.patch.title } : {}) } : p)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }, []);

  const onChange = useCallback((patch) => {
    if (!current) return;
    if (patch.brief) patch = { ...patch, title: titleFor(patch.brief) };
    const samePending = pending.current?.id === current.id;
    pending.current = { id: current.id, patch: { ...(samePending ? pending.current.patch : {}), ...patch } };
    setSaveState("saving");
    clearTimeout(debounceT.current);
    debounceT.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    if (!maxWaitT.current) maxWaitT.current = setTimeout(flush, SAVE_MAX_WAIT_MS);
  }, [current, flush]);

  // Best-effort save if the tab is closed mid-debounce.
  useEffect(() => {
    const handler = () => { if (pending.current) flush(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flush]);

  // ─── Loading & switching projects ─────────────────────────────────────────

  const openProject = useCallback(async (id) => {
    await flush();
    const { data, error } = await getBrowserSupabase().from("projects").select("*").eq("id", id).single();
    if (error) { setLoadError(error.message); return; }
    setCurrent(data);
    try { localStorage.setItem("hv_last_project", id); } catch {}
    if (window.innerWidth < 900) setSidebarOpen(false);
  }, [flush]);

  const createProject = useCallback(async (fields = {}) => {
    await flush();
    const { data, error } = await getBrowserSupabase().from("projects").insert(fields).select("*").single();
    if (error) { setLoadError(error.message); return null; }
    setProjects(ps => [{ id: data.id, title: data.title, updated_at: data.updated_at }, ...ps]);
    setCurrent(data);
    try { localStorage.setItem("hv_last_project", data.id); } catch {}
    return data;
  }, [flush]);

  async function deleteProject(id) {
    if (!confirm("Delete this project? This can't be undone.")) return;
    if (pending.current?.id === id) pending.current = null;
    const { error } = await getBrowserSupabase().from("projects").delete().eq("id", id);
    if (error) { setLoadError(error.message); return; }
    const rest = projects.filter(p => p.id !== id);
    setProjects(rest);
    if (current?.id === id) {
      if (rest.length) openProject(rest[0].id);
      else createProject();
    }
  }

  async function signOut() {
    await flush();
    await getBrowserSupabase().auth.signOut();
    window.location.href = "/login";
  }

  // First load: who's signed in, their projects, and a one-time import of any
  // work saved in this browser before cloud saving existed.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // React dev mode runs effects twice; import/create only once
    started.current = true;
    (async () => {
      const { data: { user } } = await getBrowserSupabase().auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      setUser(user);

      const { data: list, error } = await getBrowserSupabase()
        .from("projects").select("id, title, updated_at").order("updated_at", { ascending: false });
      if (error) { setLoadError(error.message); return; }

      let rows = list;
      const legacy = readLegacyProject();
      if (legacy) {
        const { data: imported, error: importError } = await getBrowserSupabase().from("projects").insert(legacy).select("id, title, updated_at").single();
        if (!importError) {
          LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
          rows = [imported, ...rows];
          try { localStorage.setItem("hv_last_project", imported.id); } catch {}
        }
      }
      setProjects(rows);

      let last = null;
      try { last = localStorage.getItem("hv_last_project"); } catch {}
      const target = rows.find(p => p.id === last) || rows[0];
      if (target) openProject(target.id);
      else createProject();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  const saveLabel = { saved: "All changes saved", saving: "Saving...", error: "Couldn't save. Retrying on next change." }[saveState];

  return (
    <div className="workspace">
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle projects">
        ☰
      </button>

      {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="sidebar-title">Projects</div>
            <button className="sidebar-new" onClick={() => createProject()}>+ New project</button>
          </div>

          <nav className="sidebar-list">
            {projects.map(p => (
              <div key={p.id} className={`sidebar-item ${current?.id === p.id ? "active" : ""}`}>
                <button className="sidebar-item-open" onClick={() => current?.id !== p.id && openProject(p.id)}>
                  <span className="sidebar-item-title">{p.title}</span>
                  <span className="sidebar-item-date">{new Date(p.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                </button>
                <button className="sidebar-item-delete" onClick={() => deleteProject(p.id)} aria-label={`Delete ${p.title}`}>×</button>
              </div>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <div className={`sidebar-save ${saveState}`}>{saveLabel}</div>
            {user && <div className="sidebar-user">{user.email}</div>}
            <button className="sidebar-signout" onClick={signOut}>Sign out</button>
          </div>
        </aside>
      )}

      <main className="workspace-main">
        {loadError && <div className="login-error workspace-error">Couldn&apos;t reach the cloud: {loadError}</div>}
        {current
          ? children(current, onChange, () => createProject())
          : !loadError && <div className="workspace-loading">Loading your projects...</div>}
      </main>
    </div>
  );
}
