"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { unzip, zipSync } from "fflate";
import { BrandMark, ProjectIcon, WorkflowArt } from "./VisualAssets";
import ThemeToggle from "./ThemeToggle";

type Project = {
  id: string;
  slug: string;
  title: string;
  description: string;
  about?: string;
  icon: string;
  accent: string;
  visibility: "private" | "public";
  createdAt: number;
  updatedAt: number;
  version: number;
  fileCount: number;
  totalSize: number;
  creator?: string;
  handle?: string;
};
type Version = {
  id: string;
  number: number;
  note: string;
  summary: string;
  fileCount: number;
  totalSize: number;
  createdAt: number;
};
type ProjectFile = { id: string; path: string; mimeType: string; size: number };
type Detail = { project: Project; versions: Version[]; files: ProjectFile[] };
type PickedFile = { file: File; path: string };
type UploadSubmission = {
  files: PickedFile[];
  title?: string;
  description?: string;
  visibility?: "private" | "public";
  note: string;
};
type ApiData = {
  error?: string;
  message?: string;
  visibility?: string;
  id?: string;
  summary?: string;
  projects?: Project[];
  project?: Project;
  versions?: Version[];
  files?: ProjectFile[];
};
type UploadIntentData = ApiData & {
  intentId?: string;
  storageKey?: string;
  mode?: "local" | "blob";
};

const CLIENT_MAX_FILES = 250;
const CLIENT_MAX_FILE_SIZE = 8 * 1024 * 1024;
const CLIENT_MAX_PROJECT_SIZE = 30 * 1024 * 1024;
const CLIENT_MAX_ARCHIVE_SIZE = 34 * 1024 * 1024;

function normalizedUploadPath(raw: string) {
  const path = raw.normalize("NFC").replaceAll("\\", "/");
  const parts = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    path.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("One of those files has an unsafe path.");
  }
  return path;
}

function blockedUploadPath(raw: string) {
  const path = normalizedUploadPath(raw);
  const parts = path.toLowerCase().split("/");
  return (
    parts.some((part) =>
      [".git", "node_modules", ".next", ".turbo", "__macosx"].includes(part),
    ) ||
    parts.some((part) => /^\.env(?:\.|$)/.test(part)) ||
    /(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i.test(path) ||
    /\.(pem|key|p12|pfx)$/i.test(path)
  );
}

function inferredMime(path: string) {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.(txt|md|css|html?|jsx?|tsx?|ya?ml|toml)$/i.test(path))
    return "text/plain";
  return "application/octet-stream";
}

async function boundedUnzip(file: File) {
  if (file.size > CLIENT_MAX_PROJECT_SIZE)
    throw new Error("That .zip is over 30 MB before it is opened.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let total = 0;
  let count = 0;
  let skipped = 0;
  let violation = "";
  const seen = new Set<string>();
  const archive = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      unzip(
        bytes,
        {
          filter(entry) {
            if (violation || entry.name.endsWith("/")) return false;
            let normalizedPath = "";
            try {
              normalizedPath = normalizedUploadPath(entry.name);
            } catch (error) {
              violation = message(error);
              return false;
            }
            if (seen.has(normalizedPath)) {
              violation = `That .zip contains “${normalizedPath}” more than once.`;
              return false;
            }
            seen.add(normalizedPath);
            if (blockedUploadPath(normalizedPath)) {
              skipped++;
              return false;
            }
            count++;
            total += entry.originalSize;
            if (count > CLIENT_MAX_FILES)
              violation = `That .zip has more than ${CLIENT_MAX_FILES} files.`;
            else if (entry.originalSize > CLIENT_MAX_FILE_SIZE)
              violation = `“${entry.name}” is over 8 MB.`;
            else if (total > CLIENT_MAX_PROJECT_SIZE)
              violation = "That .zip expands to more than 30 MB.";
            else if (entry.originalSize / Math.max(entry.size, 1) > 200)
              violation = "That .zip expands too aggressively to open safely.";
            return !violation;
          },
        },
        (error, result) => {
          if (error) reject(error);
          else if (violation) reject(new Error(violation));
          else resolve(result);
        },
      );
    },
  );
  const entries = Object.entries(archive).map(([rawPath, data]) => {
    const path = normalizedUploadPath(rawPath);
    return {
      path,
      file: new File([data as BlobPart], path.split("/").pop() || "file", {
        type: inferredMime(path),
      }),
    };
  });
  return { entries, skipped };
}

async function createArchive(files: PickedFile[]) {
  const entries: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  for (const { file, path: rawPath } of files) {
    const path = normalizedUploadPath(rawPath);
    if (entries[path])
      throw new Error(`Your project contains “${path}” more than once.`);
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  const bytes = zipSync(entries, { level: 6 });
  if (bytes.byteLength > CLIENT_MAX_ARCHIVE_SIZE)
    throw new Error("That project is too large to save as a ZIP archive.");
  return bytes;
}

function archiveFilename(value: string) {
  const base = value
    .normalize("NFKC")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return `${base || "gitnorm-project"}.zip`;
}

async function uploadArchive(
  submission: UploadSubmission,
  operation: "create_project" | "create_version",
  projectId?: string,
  projectName = "gitnorm-project",
) {
  const bytes = await createArchive(submission.files);
  const filename = archiveFilename(submission.title || projectName);
  const intentResponse = await fetch("/api/uploads/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation,
      projectId,
      expectedSize: bytes.byteLength,
      filename,
    }),
  });
  const intent = (await intentResponse.json()) as UploadIntentData;
  if (!intentResponse.ok) throw new Error(intent.error);
  if (!intent.intentId || !intent.storageKey || !intent.mode)
    throw new Error("GitNorm could not prepare this upload. Please try again.");

  const archive = new Blob([bytes as BlobPart], { type: "application/zip" });
  if (intent.mode === "local") {
    const response = await fetch(`/api/uploads/local/${intent.intentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      body: archive,
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as ApiData;
      throw new Error(data.error || "GitNorm could not upload that project.");
    }
  } else {
    await upload(intent.storageKey, archive, {
      access: "private",
      contentType: "application/zip",
      handleUploadUrl: "/api/uploads/blob",
      clientPayload: JSON.stringify({ intentId: intent.intentId }),
      multipart: archive.size > 5 * 1024 * 1024,
    });
  }
  return intent.intentId;
}

export default function GitNormApp({
  user,
}: {
  user: { id: string; displayName: string; handle: string; bio: string };
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [discover, setDiscover] = useState<Project[]>([]);
  const [view, setView] = useState<"mine" | "discover" | "profile">("mine");
  const [selected, setSelected] = useState<Detail | null>(null);
  const [modal, setModal] = useState<"create" | "update" | "settings" | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/projects");
      const data = (await response.json()) as ApiData;
      if (!response.ok) throw new Error(data.error);
      setProjects(data.projects || []);
      const query = new URLSearchParams(location.search).get("project");
      if (query) await openProject(query, false);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void loadProjects(), 0);
    return () => clearTimeout(timer);
  }, [loadProjects]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, []);
  async function openProject(id: string, push = true) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${id}`);
      const data = (await response.json()) as ApiData;
      if (!response.ok) throw new Error(data.error);
      setSelected(data as Detail);
      if (push) history.pushState(null, "", `/?project=${id}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }
  function goHome() {
    setSelected(null);
    setView("mine");
    history.pushState(null, "", "/");
  }
  async function loadDiscover() {
    setView("discover");
    setSelected(null);
    setLoading(true);
    try {
      const response = await fetch("/api/projects?discover=1");
      const data = (await response.json()) as ApiData;
      setDiscover(data.projects || []);
    } finally {
      setLoading(false);
    }
  }
  async function refreshDetail() {
    if (selected) await openProject(selected.project.id, false);
    await loadProjects();
  }
  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  }
  async function updateSettings(input: {
    title?: string;
    description?: string;
    about?: string;
    visibility?: string;
  }) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${selected.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as ApiData;
      if (!response.ok) throw new Error(data.error);
      flash(data.message || "Changes saved.");
      setModal(null);
      await refreshDetail();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function restore(version: Version) {
    if (
      !selected ||
      !confirm(
        `Make a copy of saved version ${version.number} your newest version? Nothing will be deleted.`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${selected.project.id}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restoreVersionId: version.id }),
        },
      );
      const data = (await response.json()) as ApiData;
      if (!response.ok) throw new Error(data.error);
      flash(data.message || "Changes saved.");
      await refreshDetail();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function removeProject() {
    if (
      !selected ||
      !confirm(
        `Remove “${selected.project.title}”? Its public link will stop working. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${selected.project.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as ApiData;
      if (!response.ok) throw new Error(data.error);
      flash("Project removed.");
      goHome();
      await loadProjects();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const firstName = user.displayName.split(/\s/)[0];
  return (
    <main className="app-shell">
      <header className="site-header">
        <button className="brand brand-button" onClick={goHome}>
          <BrandMark className="brand-mark" />
          <span>GitNorm</span>
        </button>
        <nav className="top-nav" aria-label="Main navigation">
          <button
            className={`nav-link ${view === "mine" && !selected ? "active" : ""}`}
            onClick={goHome}
          >
            My projects
          </button>
          <button
            className={`nav-link ${view === "discover" ? "active" : ""}`}
            onClick={() => void loadDiscover()}
          >
            Discover
          </button>
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <button
            className="avatar"
            onClick={() => {
              setView("profile");
              setSelected(null);
            }}
            aria-label="Open profile"
          >
            {initials(user.displayName)}
          </button>
        </div>
      </header>
      {notice && (
        <div className="toast success" role="status">
          ✓ {notice}
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
      {loading && <div className="top-progress" aria-label="Loading" />}
      {selected ? (
        <ProjectView
          detail={selected}
          onBack={goHome}
          onUpdate={() => setModal("update")}
          onSettings={() => setModal("settings")}
          onPublish={() =>
            void updateSettings({
              visibility:
                selected.project.visibility === "public" ? "private" : "public",
            })
          }
          onRestore={restore}
          busy={busy}
        />
      ) : view === "discover" ? (
        <DiscoverView projects={discover} />
      ) : view === "profile" ? (
        <ProfileView user={user} count={projects.length} />
      ) : (
        <Dashboard
          firstName={firstName}
          projects={projects}
          onCreate={() => setModal("create")}
          onOpen={(id) => void openProject(id)}
        />
      )}
      {modal === "create" && (
        <UploadDialog
          title="Bring in something you made"
          subtitle="Drop in the folder or ZIP. GitNorm will give it a permanent home, private until you say otherwise."
          action="Save project"
          onClose={() => setModal(null)}
          onSubmit={async (submission) => {
            setBusy(true);
            try {
              const intentId = await uploadArchive(
                submission,
                "create_project",
                undefined,
                submission.title,
              );
              const response = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  intentId,
                  title: submission.title,
                  description: submission.description,
                  visibility: submission.visibility,
                  note: submission.note,
                }),
              });
              const data = (await response.json()) as ApiData;
              if (!response.ok) throw new Error(data.error);
              setModal(null);
              flash(data.message || "Changes saved.");
              await loadProjects();
              if (!data.id)
                throw new Error(
                  "The project was saved, but could not be reopened.",
                );
              await openProject(data.id);
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
          create
        />
      )}
      {modal === "update" && selected && (
        <UploadDialog
          title="Save what changed"
          subtitle="Choose the complete updated folder. GitNorm will find the differences and preserve everything that came before."
          action="Save new version"
          onClose={() => setModal(null)}
          onSubmit={async (submission) => {
            setBusy(true);
            try {
              const intentId = await uploadArchive(
                submission,
                "create_version",
                selected.project.id,
                selected.project.title,
              );
              const response = await fetch(
                `/api/projects/${selected.project.id}/versions`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ intentId, note: submission.note }),
                },
              );
              const data = (await response.json()) as ApiData;
              if (!response.ok) throw new Error(data.error);
              setModal(null);
              flash(data.message || "Changes saved.");
              await refreshDetail();
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}
      {modal === "settings" && selected && (
        <SettingsDialog
          project={selected.project}
          onClose={() => setModal(null)}
          onSave={updateSettings}
          onDelete={removeProject}
          busy={busy}
        />
      )}
    </main>
  );
}

function Dashboard({
  firstName,
  projects,
  onCreate,
  onOpen,
}: {
  firstName: string;
  projects: Project[];
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="hero-shell">
      <div className="eyebrow">
        <span className="pulse" /> EVERYTHING YOU’VE BROUGHT TO LIFE
      </div>
      <div className="hero-copy">
        <div>
          <h1>Look what you’ve brought to life, {firstName}.</h1>
          <p>Every app. Every version. One calm place to keep building.</p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <span>＋</span> Add a project
        </button>
      </div>
      <div className="reassurance">
        <span className="reassurance-icon">✓</span>
        <div>
          <strong>Create without fear.</strong>
          <span> New updates never erase the work that got you here.</span>
        </div>
      </div>
      <div className="section-heading">
        <h2>
          Your body of work <span>{projects.length}</span>
        </h2>
      </div>
      {projects.length ? (
        <div className="project-grid">
          <button className="project-card add-card" onClick={onCreate}>
            <span className="add-icon">＋</span>
            <strong>Bring in something you made</strong>
            <span>Folder or ZIP. No setup.</span>
          </button>
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => onOpen(project.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-shelf">
          <div className="empty-art">
            <WorkflowArt step="drop" />
          </div>
          <h2>This is where your ideas start adding up.</h2>
          <p>
            Bring in the folder or ZIP your AI builder made. From then on, every
            version has a place and every project has a future.
          </p>
          <button className="primary-button" onClick={onCreate}>
            Give your first app a home →
          </button>
        </div>
      )}
    </section>
  );
}
function ProjectCard({
  project,
  onClick,
}: {
  project: Project;
  onClick?: () => void;
}) {
  return (
    <button className="project-card project-card-button" onClick={onClick}>
      <div className={`project-cover ${project.accent}`}>
        <ProjectIcon icon={project.icon} />
      </div>
      <div className="project-body">
        <div className="project-title-row">
          <h3>{project.title}</h3>
          <span className={`status ${project.visibility}`}>
            ● {project.visibility === "public" ? "Public" : "Only me"}
          </span>
        </div>
        <p>{project.description || "An idea worth keeping."}</p>
        <div className="project-footer">
          <span>{relative(project.updatedAt)}</span>
          <span>→</span>
        </div>
      </div>
    </button>
  );
}
function DiscoverView({ projects }: { projects: Project[] }) {
  return (
    <section className="page-shell">
      <div className="eyebrow">
        <span className="pulse" /> BUILT OUT OF CURIOSITY
      </div>
      <div className="page-title">
        <div>
          <h1>Meet the people who made the thing they needed.</h1>
          <p>
            Useful little apps, ambitious experiments, and ideas that refused to
            stay ideas.
          </p>
        </div>
      </div>
      {projects.length ? (
        <div className="discover-grid">
          {projects.map((project) => (
            <a
              href={`/s/${project.slug}`}
              key={project.id}
              className="discover-card"
            >
              <div className={`discover-art ${project.accent}`}>
                <ProjectIcon icon={project.icon} />
              </div>
              <div>
                <span className="creator">@{project.handle}</span>
                <h2>{project.title}</h2>
                <p>{project.description}</p>
                <small>
                  {project.fileCount} files · {relative(project.updatedAt)}
                </small>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty-shelf">
          <h2>Be the first to put something out there.</h2>
          <p>
            Publish the project you keep showing your friends. It belongs here.
          </p>
        </div>
      )}
    </section>
  );
}
function ProfileView({
  user,
  count,
}: {
  user: { displayName: string; handle: string; bio: string };
  count: number;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setProfileError("");
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, handle, bio }),
    });
    const data = (await response.json()) as ApiData;
    if (!response.ok) {
      setProfileError(data.error || "Profile could not be saved.");
      setSaving(false);
      return;
    }
    location.reload();
  }
  async function deleteAccount() {
    if (
      !confirm(
        "Permanently delete your GitNorm account, every project, every saved version, and every stored file? This cannot be undone.",
      )
    )
      return;
    setSaving(true);
    const response = await fetch("/api/profile", { method: "DELETE" });
    if (response.ok) location.assign("/");
    else {
      const data = (await response.json()) as ApiData;
      setProfileError(data.error || "Account could not be deleted.");
      setSaving(false);
    }
  }
  return (
    <section className="page-shell profile-page">
      <div className="big-avatar">{initials(displayName)}</div>
      <h1>{displayName}</h1>
      <p>@{handle}</p>
      <div className="profile-stat">
        <strong>{count}</strong>
        <span>{count === 1 ? "project" : "projects"} safely saved</span>
      </div>
      <form className="profile-form" onSubmit={saveProfile}>
        <label>
          Display name
          <input
            required
            minLength={2}
            maxLength={60}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          Public handle
          <div className="handle-input">
            <span>@</span>
            <input
              required
              minLength={3}
              maxLength={30}
              value={handle}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
            />
          </div>
        </label>
        <label>
          Short bio
          <textarea
            maxLength={300}
            rows={3}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="What do you like making?"
          />
        </label>
        {profileError && (
          <div className="auth-error" role="alert">
            {profileError}
          </div>
        )}
        <button className="primary-button" disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
      <a className="secondary-button" href={`/creator/${handle}`}>
        View public profile
      </a>
      <form action="/api/auth/logout" method="post">
        <button className="text-button" type="submit">
          Sign out
        </button>
      </form>
      <button
        className="danger-button"
        disabled={saving}
        onClick={() => void deleteAccount()}
      >
        Delete account and all stored work
      </button>
    </section>
  );
}
function ProjectView({
  detail,
  onBack,
  onUpdate,
  onSettings,
  onPublish,
  onRestore,
  busy,
}: {
  detail: Detail;
  onBack: () => void;
  onUpdate: () => void;
  onSettings: () => void;
  onPublish: () => void;
  onRestore: (v: Version) => void;
  busy: boolean;
}) {
  const { project, versions, files } = detail;
  const [tab, setTab] = useState<"summary" | "files" | "versions">("summary");
  return (
    <section className="project-page">
      <button className="back-link" onClick={onBack}>
        ← My projects
      </button>
      <div className="project-hero">
        <div className={`project-emblem ${project.accent}`}>
          <ProjectIcon icon={project.icon} />
        </div>
        <div className="project-heading">
          <div className="project-badges">
            <span className={`status-pill ${project.visibility}`}>
              ● {project.visibility === "public" ? "Public" : "Only me"}
            </span>
            <span>Saved version {versions[0]?.number || 1}</span>
          </div>
          <h1>{project.title}</h1>
          <p>
            {project.description ||
              "Give this project the one-line story it deserves."}
          </p>
        </div>
        <div className="project-actions">
          <button className="primary-button" onClick={onUpdate}>
            ＋ Add an update
          </button>
          <button className="secondary-button" onClick={onSettings}>
            Settings
          </button>
        </div>
      </div>
      <nav className="subnav">
        <button
          className={tab === "summary" ? "active" : ""}
          onClick={() => setTab("summary")}
        >
          Summary
        </button>
        <button
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
        >
          Files <span>{files.length}</span>
        </button>
        <button
          className={tab === "versions" ? "active" : ""}
          onClick={() => setTab("versions")}
        >
          Saved versions <span>{versions.length}</span>
        </button>
      </nav>
      {tab === "summary" && (
        <div className="summary-grid">
          <article className="summary-main">
            <div className="summary-card">
              <div className="card-head">
                <h2>Where you left off</h2>
                <span>
                  {relative(versions[0]?.createdAt || project.updatedAt)}
                </span>
              </div>
              <h3>{versions[0]?.note || "Project saved"}</h3>
              <p>{versions[0]?.summary}</p>
              <div className="change-chips">
                <span>✓ {versions[0]?.fileCount || 0} files protected</span>
                <span>{formatBytes(versions[0]?.totalSize || 0)}</span>
              </div>
            </div>
            <div className="about-card">
              <div className="card-head">
                <h2>About this project</h2>
                <button onClick={onSettings}>Edit</button>
              </div>
              <p>
                {project.about ||
                  "Every project has a reason it exists. Tell people what sparked this one and why it matters."}
              </p>
            </div>
          </article>
          <aside className="share-card">
            <div className={`share-mini-art ${project.accent}`}>
              <ProjectIcon icon={project.icon} />
            </div>
            <h2>
              {project.visibility === "public"
                ? "It’s out in the world."
                : "This deserves to be seen."}
            </h2>
            <p>
              {project.visibility === "public"
                ? "Anyone with the link can experience the newest version."
                : "Publish a polished page anyone can open—no account, no explanation needed."}
            </p>
            {project.visibility === "public" && (
              <a
                className="secondary-button full"
                href={`/s/${project.slug}`}
                target="_blank"
              >
                Open public page ↗
              </a>
            )}
            <button
              className="primary-button full"
              disabled={busy}
              onClick={onPublish}
            >
              {project.visibility === "public"
                ? "Make private"
                : "Share it with the world"}
            </button>
            <a
              className="text-button"
              href={`/api/projects/${project.id}/download`}
            >
              ↓ Download newest version
            </a>
          </aside>
        </div>
      )}
      {tab === "files" && (
        <div className="file-panel">
          <div className="file-panel-head">
            <div>
              <h2>Everything that makes it work</h2>
              <p>The newest version, organized and completely visible.</p>
            </div>
            <a
              className="secondary-button"
              href={`/api/projects/${project.id}/download`}
            >
              ↓ Download all
            </a>
          </div>
          <div className="file-list">
            {files.map((file) => (
              <a key={file.id} href={`/api/files/${file.id}`} target="_blank">
                <span className="file-icon">{fileIcon(file.path)}</span>
                <span className="file-name">{file.path}</span>
                <span>{formatBytes(file.size)}</span>
                <span>↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
      {tab === "versions" && (
        <div className="versions-panel">
          <div className="versions-intro">
            <h2>Go forward without fear.</h2>
            <p>
              Every version stays within reach. Bring an older one forward
              anytime—nothing newer gets erased.
            </p>
          </div>
          <div className="timeline">
            {versions.map((version, index) => (
              <article key={version.id}>
                <div className="timeline-dot">
                  {index === 0 ? "✓" : version.number}
                </div>
                <div>
                  <div className="version-title">
                    <h3>{version.note || `Saved version ${version.number}`}</h3>
                    {index === 0 && <span>Newest</span>}
                  </div>
                  <p>{version.summary}</p>
                  <small>
                    {new Date(version.createdAt).toLocaleString()} ·{" "}
                    {version.fileCount} files · {formatBytes(version.totalSize)}
                  </small>
                </div>
                {index > 0 && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => onRestore(version)}
                  >
                    Use this version
                  </button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function UploadDialog({
  title,
  subtitle,
  action,
  onClose,
  onSubmit,
  busy,
  create = false,
}: {
  title: string;
  subtitle: string;
  action: string;
  onClose: () => void;
  onSubmit: (submission: UploadSubmission) => Promise<void>;
  busy: boolean;
  create?: boolean;
}) {
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [note, setNote] = useState("");
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [skipped, setSkipped] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  async function choose(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    setUploadError("");
    setSkipped(0);
    try {
      const fileList = [...list];
      if (
        fileList.length === 1 &&
        fileList[0].name.toLowerCase().endsWith(".zip")
      ) {
        const { entries, skipped: blocked } = await boundedUnzip(fileList[0]);
        setPicked(entries);
        setSkipped(blocked);
        if (create && !name) setName(fileList[0].name.replace(/\.zip$/i, ""));
      } else {
        let blocked = 0;
        const entries = fileList
          .map((file) => ({
            file,
            path: normalizedUploadPath(
              (file as File & { webkitRelativePath?: string })
                .webkitRelativePath || file.name,
            ),
          }))
          .filter((entry) => {
            if (blockedUploadPath(entry.path)) {
              blocked++;
              return false;
            }
            return true;
          });
        const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
        if (entries.length > CLIENT_MAX_FILES)
          throw new Error(
            `That folder has more than ${CLIENT_MAX_FILES} files.`,
          );
        if (entries.some((entry) => entry.file.size > CLIENT_MAX_FILE_SIZE))
          throw new Error("One of those files is over 8 MB.");
        if (total > CLIENT_MAX_PROJECT_SIZE)
          throw new Error("That folder is over 30 MB.");
        if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
          throw new Error("That folder contains the same file path twice.");
        setPicked(entries);
        setSkipped(blocked);
        if (create && !name) {
          const first = entries[0]?.path.split("/")[0];
          if (first && first !== entries[0]?.file.name) setName(first);
        }
      }
    } catch (reason) {
      setPicked([]);
      setUploadError(message(reason));
    } finally {
      setReading(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!picked.length) return;
    await onSubmit({
      files: picked,
      ...(create
        ? {
            title: name.trim(),
            description: description.trim(),
            visibility: visibility as "private" | "public",
          }
        : {}),
      note: note.trim() || (create ? "First saved version" : "Added an update"),
    });
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <button className="dialog-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dialog-step">
          {create ? "NEW PROJECT" : "NEW SAVED VERSION"}
        </div>
        <h2 id="dialog-title">{title}</h2>
        <p className="dialog-subtitle">{subtitle}</p>
        <form onSubmit={submit}>
          {create && (
            <>
              <label>
                Project name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My brilliant little app"
                />
              </label>
              <label>
                Describe it in one sentence <span>Optional</span>
                <input
                  maxLength={220}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does it do?"
                />
              </label>
            </>
          )}
          <div
            className={`dropzone ${picked.length ? "has-files" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void choose(e.dataTransfer.files);
            }}
          >
            <div className="drop-icon">{picked.length ? "✓" : "⇧"}</div>
            {reading ? (
              <strong>Opening your files…</strong>
            ) : picked.length ? (
              <>
                <strong>
                  {picked.length} {picked.length === 1 ? "file" : "files"} ready
                </strong>
                <span>
                  {formatBytes(
                    picked.reduce((sum, item) => sum + item.file.size, 0),
                  )}{" "}
                  total · Your folder structure will stay intact.
                </span>
              </>
            ) : (
              <>
                <strong>Drop your project here</strong>
                <span>or choose a folder or .zip file</span>
              </>
            )}
            <div className="picker-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => folderInput.current?.click()}
              >
                Choose folder
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => fileInput.current?.click()}
              >
                Choose .zip
              </button>
            </div>
            <input
              ref={folderInput}
              hidden
              type="file"
              multiple
              {...({
                webkitdirectory: "",
                directory: "",
              } as React.InputHTMLAttributes<HTMLInputElement>)}
              onChange={(e) => void choose(e.target.files)}
            />
            <input
              ref={fileInput}
              hidden
              type="file"
              accept=".zip"
              onChange={(e) => void choose(e.target.files)}
            />
          </div>
          {uploadError && (
            <div className="upload-warning" role="alert">
              {uploadError}
            </div>
          )}
          {!!skipped && (
            <div className="upload-safety">
              ✓ GitNorm left out {skipped} sensitive or generated{" "}
              {skipped === 1 ? "file" : "files"}.
            </div>
          )}
          {!!picked.length && (
            <div className="upload-preview" aria-label="Files ready to upload">
              <strong>Ready to save</strong>
              {picked.slice(0, 6).map((entry) => (
                <span key={entry.path}>{entry.path}</span>
              ))}
              {picked.length > 6 && <small>+ {picked.length - 6} more</small>}
            </div>
          )}
          <label>
            What changed? <span>Optional</span>
            <input
              maxLength={160}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                create
                  ? "My first saved version"
                  : "Added a new feature and tidied things up"
              }
            />
          </label>
          {create && (
            <fieldset>
              <legend>Who can see it?</legend>
              <label
                className={`choice ${visibility === "private" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === "private"}
                  onChange={() => setVisibility("private")}
                />
                <span>◉</span>
                <div>
                  <strong>Only me</strong>
                  <small>Private by default. You can publish later.</small>
                </div>
              </label>
              <label
                className={`choice ${visibility === "public" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === "public"}
                  onChange={() => setVisibility("public")}
                />
                <span>◎</span>
                <div>
                  <strong>Anyone</strong>
                  <small>
                    People can see and download it with a public link.
                  </small>
                </div>
              </label>
            </fieldset>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={
                busy || reading || !picked.length || (create && !name.trim())
              }
            >
              {busy ? "Saving safely…" : action}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function SettingsDialog({
  project,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  project: Project;
  onClose: () => void;
  onSave: (input: Record<string, string>) => Promise<void>;
  onDelete: () => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [about, setAbout] = useState(project.about || "");
  return (
    <div className="modal-backdrop">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button className="dialog-close" onClick={onClose}>
          ×
        </button>
        <div className="dialog-step">PROJECT SETTINGS</div>
        <h2 id="settings-title">Tell the story well.</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ title, description, about });
          }}
        >
          <label>
            Project name
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            One-line description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            About this project <span>Optional</span>
            <textarea
              rows={5}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What inspired it? How does it help?"
            />
          </label>
          <div className="danger-zone">
            <div>
              <strong>Remove project</strong>
              <span>Its public link will immediately stop working.</span>
            </div>
            <button type="button" onClick={onDelete}>
              Remove…
            </button>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "GN"
  );
}
function relative(value: number) {
  const delta = Date.now() - value;
  const hours = Math.floor(delta / 3600000);
  if (hours < 1) return "Updated just now";
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days}d ago`;
  return `Updated ${new Date(value).toLocaleDateString()}`;
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}
function fileIcon(path: string) {
  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(path)) return "▧";
  if (/\.(md|txt)$/i.test(path)) return "≡";
  if (/\.(html|css|js|ts|tsx|jsx|json)$/i.test(path)) return "⌘";
  return "·";
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Your saved work is still safe.";
}
