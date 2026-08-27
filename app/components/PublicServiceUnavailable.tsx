import Link from "next/link";
import { BrandMark } from "./VisualAssets";

export default function PublicServiceUnavailable({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <main className="creator-page">
      <header className="share-header">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <span>GitNorm</span>
        </Link>
        <Link className="secondary-button" href="/">
          Back home
        </Link>
      </header>
      <section className="page-shell">
        <div className="eyebrow">
          <span className="pulse" /> {eyebrow}
        </div>
        <div className="empty-shelf public-service-unavailable" role="status">
          <h2>{title}</h2>
          <p>{description}</p>
          <Link className="secondary-button" href="/">
            Return to GitNorm
          </Link>
        </div>
      </section>
      <footer>
        <span>GitNorm keeps software simple.</span>
        <span>Made for people who make things.</span>
      </footer>
    </main>
  );
}
