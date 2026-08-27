import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ensureSchema, getD1 } from "@/lib/gitnorm";
import { deploymentReadiness } from "@/lib/deployment";
import { BrandMark, ProjectIcon } from "@/app/components/VisualAssets";
import ThemeToggle from "@/app/components/ThemeToggle";
import PublicServiceUnavailable from "@/app/components/PublicServiceUnavailable";

const creator = cache(async (handle: string) => {
  await ensureSchema();
  const profile = await getD1()
    .prepare(
      "SELECT id,display_name AS displayName,handle,bio FROM profiles WHERE handle=?",
    )
    .bind(handle)
    .first<{ id: string; displayName: string; handle: string; bio: string }>();
  if (!profile) return null;
  const projects = await getD1()
    .prepare(
      `SELECT p.id,p.slug,p.title,p.description,p.icon,p.accent,p.updated_at AS updatedAt,v.file_count AS fileCount FROM projects p LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.owner_id=? AND p.visibility='public' AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`,
    )
    .bind(profile.id)
    .all<{
      id: string;
      slug: string;
      title: string;
      description: string;
      icon: string;
      accent: string;
      updatedAt: number;
      fileCount: number;
    }>();
  return { profile, projects: projects.results };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  if (!deploymentReadiness().ready)
    return { title: "Creator profiles — GitNorm" };
  const { handle } = await params;
  const data = await creator(handle);
  if (!data) return { title: "Creator not found — GitNorm" };
  return {
    title: `${data.profile.displayName} (@${data.profile.handle}) — GitNorm`,
    description: `See what ${data.profile.displayName} brought to life—and the ideas they chose to share.`,
    openGraph: {
      title: `${data.profile.displayName} on GitNorm`,
      description: `${data.projects.length} ${data.projects.length === 1 ? "idea brought to life" : "ideas brought to life"} and shared on GitNorm.`,
      images: [],
    },
    twitter: {
      card: "summary",
      title: `${data.profile.displayName} on GitNorm`,
      description: `${data.projects.length} ${data.projects.length === 1 ? "idea brought to life" : "ideas brought to life"} and shared on GitNorm.`,
      images: [],
    },
  };
}

export default async function CreatorPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  if (!deploymentReadiness().ready) {
    return (
      <PublicServiceUnavailable
        eyebrow="CREATOR PROFILES"
        title="A body of work deserves a proper entrance."
        description="Creator shelves are built and waiting. They’ll open as soon as GitNorm’s secure vault finishes connecting."
      />
    );
  }
  const { handle } = await params;
  const data = await creator(handle);
  if (!data) notFound();
  const { profile, projects } = data;
  return (
    <main className="creator-page">
      <header className="share-header">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <span>GitNorm</span>
        </Link>
        <div className="header-actions">
          <ThemeToggle />
          <span className="made-with">A body of work</span>
        </div>
      </header>
      <section className="page-shell">
        <div className="creator-profile">
          <div className="big-avatar">{initials(profile.displayName)}</div>
          <div>
            <div className="eyebrow">THINGS BROUGHT TO LIFE</div>
            <h1>{profile.displayName}</h1>
            <p>
              @{profile.handle} · {projects.length} public{" "}
              {projects.length === 1 ? "project" : "projects"}
            </p>
            {profile.bio && <p className="creator-bio">{profile.bio}</p>}
          </div>
        </div>
        {projects.length ? (
          <div className="discover-grid">
            {projects.map((project) => (
              <Link
                href={`/s/${project.slug}`}
                key={project.id}
                className="discover-card"
              >
                <div className={`discover-art ${project.accent}`}>
                  <ProjectIcon icon={project.icon} />
                </div>
                <div>
                  <span className="creator">
                    Brought to life by @{profile.handle}
                  </span>
                  <h2>{project.title}</h2>
                  <p>{project.description || "An idea worth sharing."}</p>
                  <small>
                    {project.fileCount} files ·{" "}
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </small>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-shelf">
            <h2>The best work is still taking shape.</h2>
            <p>
              {profile.displayName} hasn’t put a project into the world yet.
            </p>
          </div>
        )}
      </section>
      <footer>
        <span>Every body of work starts with one thing worth keeping.</span>
        <Link href="/">Start yours on GitNorm →</Link>
      </footer>
    </main>
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
