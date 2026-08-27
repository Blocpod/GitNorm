import Link from "next/link";
import { ensureSchema, getD1 } from "@/lib/gitnorm";
import { deploymentReadiness } from "@/lib/deployment";
import { BrandMark, ProjectIcon } from "@/app/components/VisualAssets";
import ThemeToggle from "@/app/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const term = q.trim().slice(0, 80);
  const serviceReady = deploymentReadiness().ready;
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const query = `SELECT p.id,p.slug,p.title,p.description,p.icon,p.accent,p.updated_at AS updatedAt,pr.display_name AS creator,pr.handle,v.file_count AS fileCount FROM projects p JOIN profiles pr ON pr.id=p.owner_id LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.visibility='public' AND p.deleted_at IS NULL ${term ? "AND (p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR pr.handle LIKE ? ESCAPE '\\')" : ""} ORDER BY p.updated_at DESC LIMIT 48`;
  let projects: {
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
  }[] = [];
  if (serviceReady) {
    await ensureSchema();
    const prepared = getD1().prepare(query);
    projects = term
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
  }
  return (
    <main className="creator-page">
      <header className="share-header">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <span>GitNorm</span>
        </Link>
        <div className="header-actions">
          <ThemeToggle />
          <Link className="secondary-button" href="/#get-started">
            Start your shelf
          </Link>
        </div>
      </header>
      <section className="page-shell">
        <div className="eyebrow">
          <span className="pulse" /> BUILT OUT OF CURIOSITY
        </div>
        <div className="discover-title">
          <div>
            <h1>Meet the people who made the thing they needed.</h1>
            <p>
              Useful little apps, ambitious experiments, and ideas that refused
              to stay ideas.
            </p>
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
        {!serviceReady ? (
          <div className="empty-shelf public-service-unavailable" role="status">
            <h2>The gallery is waiting backstage.</h2>
            <p>
              Discovery is built and ready. Public work will take the stage as
              soon as GitNorm’s secure vault finishes connecting.
            </p>
            <Link className="secondary-button" href="/">
              Return to GitNorm
            </Link>
          </div>
        ) : projects.length ? (
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
                : "Be the first to put something out there."}
            </h2>
            <p>
              {term
                ? "Try another word or browse everything."
                : "Publish the project you keep showing your friends. It belongs here."}
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
        <span>Every useful thing started as somebody’s little idea.</span>
        <Link href="/#get-started">Give yours a home →</Link>
      </footer>
    </main>
  );
}
