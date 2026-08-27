import GitNormApp from "./components/GitNormApp";
import AuthPanel from "./components/AuthPanel";
import Link from "next/link";
import { currentProfile } from "@/lib/gitnorm";
import { deploymentReadiness } from "@/lib/deployment";
import { BrandMark, ProjectIcon, WorkflowArt } from "./components/VisualAssets";
import ThemeToggle from "./components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function Home() {
  const readiness = deploymentReadiness();
  const user = readiness.ready ? await currentProfile() : null;
  if (user)
    return (
      <GitNormApp
        user={{
          id: user.id,
          displayName: user.displayName,
          handle: user.handle,
          bio: user.bio,
        }}
      />
    );
  return (
    <main className="landing">
      <header className="landing-header">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <span>GitNorm</span>
        </Link>
        <div className="landing-nav">
          <ThemeToggle />
          <Link href="/discover">Discover</Link>
          <a className="secondary-button" href="#get-started">
            Sign in
          </a>
        </div>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <div className="eyebrow">
            <span className="pulse" /> THE HOME FOR EVERYTHING YOU BUILD
          </div>
          <h1>
            Build freely.
            <br />
            Lose <em>nothing.</em>
          </h1>
          <p>
            GitNorm gives every app you build with AI a permanent home—every
            version organized, every idea easy to find, and every win ready to
            share. No Git required.
          </p>
          <div className="landing-actions">
            <a className="primary-button" href="#get-started">
              Give your first app a home <span>→</span>
            </a>
            <span>Private by default · yours to publish</span>
          </div>
        </div>
        <div
          className="landing-visual"
          aria-label="A simple project shelf preview"
        >
          <div className="visual-window">
            <div className="window-top">
              <span />
              <span />
              <span />
              <small>My projects</small>
            </div>
            <div className="visual-card coral">
              <ProjectIcon icon="orbit" className="visual-project-icon" />
              <div>
                <strong>Weekend Picker</strong>
                <span>Every version kept · Public</span>
              </div>
            </div>
            <div className="visual-card mint">
              <ProjectIcon icon="sprout" className="visual-project-icon" />
              <div>
                <strong>Plant Pal</strong>
                <span>Still taking shape · Only me</span>
              </div>
            </div>
            <div className="visual-success">✓ Nothing gets overwritten</div>
          </div>
        </div>
      </section>
      <section className="how-it-works">
        <div>
          <WorkflowArt step="drop" className="workflow-art" />
          <h2>Bring it over</h2>
          <p>Drop in a folder or ZIP. GitNorm handles the technical stuff.</p>
        </div>
        <div>
          <WorkflowArt step="keep" className="workflow-art" />
          <h2>Keep every good version</h2>
          <p>Update without overwriting. Go back whenever you need.</p>
        </div>
        <div>
          <WorkflowArt step="show" className="workflow-art" />
          <h2>Put it out there</h2>
          <p>Turn any project into a polished page with one simple link.</p>
        </div>
      </section>
      <section className="auth-section">
        <div>
          <div className="eyebrow">
            <span className="pulse" /> YOUR WORK. YOUR ACCOUNT.
          </div>
          <h2>Your corner of the internet.</h2>
          <p>
            GitNorm stands on its own. Create an account with a passkey on your
            device—no ChatGPT account, no password, and no platform between you
            and what you made.
          </p>
        </div>
        <AuthPanel serviceReady={readiness.ready} />
      </section>
      <footer>
        <span>GitNorm · GitHub for normies</span>
        <span>Ideas become software here.</span>
      </footer>
    </main>
  );
}
