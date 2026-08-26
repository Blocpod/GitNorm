import Link from "next/link";
import { ensureSchema, getD1 } from "@/lib/gitnorm";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await ensureSchema();
  const { q = "" } = await searchParams;
  const term = q.trim().slice(0, 80);
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const query = `SELECT p.id,p.slug,p.title,p.description,p.icon,p.accent,p.updated_at AS updatedAt,pr.display_name AS creator,pr.handle,v.file_count AS fileCount FROM projects p JOIN profiles pr ON pr.id=p.owner_id LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.visibility='public' AND p.deleted_at IS NULL ${term ? "AND (p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR pr.handle LIKE ? ESCAPE '\\')" : ""} ORDER BY p.updated_at DESC LIMIT 48`;
  const prepared = getD1().prepare(query);
  const projects = term
    ? (
        await prepared.bind(like, like, like).all<{
          id: string;
          slug: string;
          title: string;
          description: string;
          icon: string;
          accent: string;
          updatedAt: number;
          creator: string;
          handle: string;
          fileCount: number;
        }>()
      ).results
    : (
        await prepared.all<{
          id: string;
          slug: string;
          title: string;
          description: string;
          icon: string;
          accent: string;
          updatedAt: number;
          creator: string;
          handle: string;
          fileCount: number;
        }>()
      ).results;
  return (
    <main className="creator-page">
      <header className="share-header">
        <Link className="brand" href="/">
          <span className="brand-mark">G</span>
          <span>GitNorm</span>
        </Link>
        <Link className="secondary-button" href="/#get-started">
          Make your shelf
        </Link>
      </header>
      <section className="page-shell">
        <div className="eyebrow">
          <span className="pulse" /> MADE WITH GITNORM
        </div>
        <div className="discover-title">
          <div>
            <h1>See what people made.</h1>
            <p>Small tools, personal apps, and delightful experiments.</p>
          </div>
          <form>
            <label className="search-box">
              <span>⌕</span>
              <input
                name="q"
                defaultValue={term}
                placeholder="Search projects or makers"
              />
              <button>Search</button>
            </label>
          </form>
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
                  <span>{project.icon}</span>
                </div>
                <div>
                  <span className="creator">@{project.handle}</span>
                  <h2>{project.title}</h2>
                  <p>{project.description || "A delightful little project."}</p>
                  <small>
                    {project.fileCount || 0} files ·{" "}
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </small>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-shelf">
            <h2>
              {term
                ? "No projects matched that search."
                : "The gallery is waiting for its first project."}
            </h2>
            <p>
              {term
                ? "Try another word or browse everything."
                : "Publish something you made and it will appear here."}
            </p>
            {term && (
              <Link className="secondary-button" href="/discover">
                Clear search
              </Link>
            )}
          </div>
        )}
      </section>
      <footer>
        <span>GitNorm keeps software simple.</span>
        <Link href="/#get-started">Save something you made →</Link>
      </footer>
    </main>
  );
}
