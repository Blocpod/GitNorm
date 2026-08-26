import GitNormApp from "./components/GitNormApp";
import AuthPanel from "./components/AuthPanel";
import Link from "next/link";
import { currentProfile } from "@/lib/gitnorm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentProfile();
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
          <span className="brand-mark">G</span>
          <span>GitNorm</span>
        </Link>
        <div className="landing-nav">
          <Link href="/discover">Discover</Link>
          <a className="secondary-button" href="#get-started">
            Sign in
          </a>
        </div>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <div className="eyebrow">
            <span className="pulse" /> SOFTWARE, MINUS THE SCARY PARTS
          </div>
          <h1>
            Your apps deserve
            <br />a <em>home.</em>
          </h1>
          <p>
            Save, update, and show off the software you make—with no commands,
            no jargon, and nothing to break.
          </p>
          <div className="landing-actions">
            <a className="primary-button" href="#get-started">
              Add your first project <span>→</span>
            </a>
            <span>Free to start · private by default</span>
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
              <b>✦</b>
              <div>
                <strong>Weekend Picker</strong>
                <span>Safely saved · Public</span>
              </div>
            </div>
            <div className="visual-card mint">
              <b>🪴</b>
              <div>
                <strong>Plant Pal</strong>
                <span>Safely saved · Only me</span>
              </div>
            </div>
            <div className="visual-success">✓ Every update is saved</div>
          </div>
        </div>
      </section>
      <section className="how-it-works">
        <div>
          <span>1</span>
          <h2>Drop it in</h2>
          <p>Choose the folder or .zip your AI builder made.</p>
        </div>
        <div>
          <span>2</span>
          <h2>Keep making</h2>
          <p>Add updates anytime. Every older version stays safe.</p>
        </div>
        <div>
          <span>3</span>
          <h2>Show it off</h2>
          <p>Publish a beautiful page and send one simple link.</p>
        </div>
      </section>
      <section className="auth-section">
        <div>
          <div className="eyebrow">
            <span className="pulse" /> YOUR OWN ACCOUNT
          </div>
          <h2>GitNorm is its own place.</h2>
          <p>
            Create an account with a passkey stored on your device. You won’t be
            sent through ChatGPT—or asked to remember another password.
          </p>
        </div>
        <AuthPanel />
      </section>
      <footer>
        <span>GitNorm · GitHub for normies</span>
        <span>Made for people who make things.</span>
      </footer>
    </main>
  );
}
