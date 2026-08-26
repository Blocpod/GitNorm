import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ensureSchema, getD1 } from "@/lib/gitnorm";
import ShareButton from "@/app/components/ShareButton";
import { BrandMark, ProjectIcon } from "@/app/components/VisualAssets";

async function publicProject(slug: string) {
  await ensureSchema();
  const project = await getD1()
    .prepare(
      `SELECT p.id,p.slug,p.title,p.description,p.about,p.icon,p.accent,p.updated_at AS updatedAt,pr.display_name AS creator,pr.handle,v.id AS versionId,v.number,v.file_count AS fileCount,v.total_size AS totalSize FROM projects p JOIN profiles pr ON pr.id=p.owner_id JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.slug=? AND p.visibility='public' AND p.deleted_at IS NULL`,
    )
    .bind(slug)
    .first<{
      id: string;
      slug: string;
      title: string;
      description: string;
      about: string;
      icon: string;
      accent: string;
      updatedAt: number;
      creator: string;
      handle: string;
      versionId: string;
      number: number;
      fileCount: number;
      totalSize: number;
    }>();
  if (!project) return null;
  const files = await getD1()
    .prepare(
      "SELECT id,path,mime_type AS mimeType,size FROM project_files WHERE version_id=? ORDER BY path",
    )
    .bind(project.versionId)
    .all<{ id: string; path: string; mimeType: string; size: number }>();
  return { project, files: files.results };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await publicProject(slug);
  if (!data) return { title: "Project not found — GitNorm" };
  const { project } = data;
  return {
    title: `${project.title} — GitNorm`,
    description: project.description || `A project by ${project.creator}`,
    openGraph: {
      title: project.title,
      description: project.description || `A project by ${project.creator}`,
      images: [],
    },
    twitter: {
      card: "summary",
      title: project.title,
      description: project.description || `A project by ${project.creator}`,
      images: [],
    },
  };
}

export default async function SharedProject({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await publicProject(slug);
  if (!data) notFound();
  const { project, files } = data;
  return (
    <main className="share-page">
      <header className="share-header">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <span>GitNorm</span>
        </Link>
        <span className="made-with">Made with GitNorm</span>
      </header>
      <section className="share-hero">
        <div className={`share-cover ${project.accent}`}>
          <ProjectIcon icon={project.icon} />
        </div>
        <div className="share-intro">
          <div className="share-kicker">
            A PROJECT BY{" "}
            <Link href={`/creator/${project.handle}`}>@{project.handle}</Link>
          </div>
          <h1>{project.title}</h1>
          <p>{project.description}</p>
          <div className="share-actions">
            <a
              className="primary-button"
              href={`/api/projects/${project.id}/download?share=${project.slug}`}
            >
              ↓ Download project
            </a>
            <ShareButton
              title={project.title}
              text={project.description || `See what ${project.creator} made.`}
            />
          </div>
          <div className="share-meta">
            <span>Saved version {project.number}</span>
            <span>{project.fileCount} files</span>
            <span>{formatBytes(project.totalSize)}</span>
          </div>
        </div>
      </section>
      <section className="share-content">
        <article>
          <h2>About this project</h2>
          <p>
            {project.about ||
              `${project.creator} made ${project.title} and shared it with the world.`}
          </p>
        </article>
        <aside>
          <h2>What’s inside</h2>
          <div className="public-files">
            {files.slice(0, 12).map((file) => (
              <a key={file.id} href={`/api/files/${file.id}`}>
                <span>{fileIcon(file.path)}</span>
                <span>{file.path}</span>
                <small>{formatBytes(file.size)}</small>
              </a>
            ))}
          </div>
          {files.length > 12 && (
            <p className="more-files">
              + {files.length - 12} more files in the download
            </p>
          )}
        </aside>
      </section>
      <footer>
        <span>GitNorm keeps software simple.</span>
        <Link href="/">Save something you made →</Link>
      </footer>
    </main>
  );
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
