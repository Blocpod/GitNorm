import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ensureSchema, getD1 } from "@/lib/gitnorm";
import { deploymentReadiness } from "@/lib/deployment";
import { BrandMark, ProjectIcon } from "@/app/components/VisualAssets";
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
    description: `See the software ${data.profile.displayName} made with GitNorm.`,
    openGraph: {
      title: `${data.profile.displayName} on GitNorm`,
      description: `See ${data.projects.length} public ${data.projects.length === 1 ? "project" : "projects"}.`,
      images: [],
    },
    twitter: {
      card: "summary",
      title: `${data.profile.displayName} on GitNorm`,
      description: `See ${data.projects.length} public ${data.projects.length === 1 ? "project" : "projects"}.`,
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
        title="Creator shelves are getting ready."
        description="Public creator profiles will be available as soon as GitNorm’s secure production storage finishes connecting."
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
        <span className="made-with">Creator profile</span>
      </header>
      <section className="page-shell">
        <div className="creator-profile">
          <div className="big-avatar">{initials(profile.displayName)}</div>
          <div>
            <div className="eyebrow">SOFTWARE SHELF</div>
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
                  <span className="creator">Made by @{profile.handle}</span>
                  <h2>{project.title}</h2>
                  <p>{project.description || "A delightful little project."}</p>
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
            <h2>Nothing public here yet.</h2>
            <p>{profile.displayName} hasn’t published a project.</p>
          </div>
        )}
      </section>
      <footer>
        <span>GitNorm keeps software simple.</span>
        <Link href="/">Make your own software shelf →</Link>
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
