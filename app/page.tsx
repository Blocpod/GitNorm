import { chatGPTSignInPath, getChatGPTUser } from './chatgpt-auth';
import GitNormApp from './components/GitNormApp';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) return <GitNormApp user={{ id:user.userId, displayName:user.displayName, email:user.email }} />;
  return <main className="landing">
    <header className="landing-header"><Link className="brand" href="/"><span className="brand-mark">G</span><span>GitNorm</span></Link><a className="secondary-button" href={chatGPTSignInPath('/')}>Sign in</a></header>
    <section className="landing-hero">
      <div className="landing-copy"><div className="eyebrow"><span className="pulse"/> SOFTWARE, MINUS THE SCARY PARTS</div><h1>Your apps deserve<br/>a <em>home.</em></h1><p>Save, update, and show off the software you make—with no commands, no jargon, and nothing to break.</p><div className="landing-actions"><a className="primary-button" href={chatGPTSignInPath('/')}>Add your first project <span>→</span></a><span>Free to start · private by default</span></div></div>
      <div className="landing-visual" aria-label="A simple project shelf preview"><div className="visual-window"><div className="window-top"><span/><span/><span/><small>My projects</small></div><div className="visual-card coral"><b>✦</b><div><strong>Weekend Picker</strong><span>Safely saved · Public</span></div></div><div className="visual-card mint"><b>🪴</b><div><strong>Plant Pal</strong><span>Safely saved · Only me</span></div></div><div className="visual-success">✓ Every update is saved</div></div></div>
    </section>
    <section className="how-it-works"><div><span>1</span><h2>Drop it in</h2><p>Choose the folder or .zip your AI builder made.</p></div><div><span>2</span><h2>Keep making</h2><p>Add updates anytime. Every older version stays safe.</p></div><div><span>3</span><h2>Show it off</h2><p>Publish a beautiful page and send one simple link.</p></div></section>
    <footer><span>GitNorm · GitHub for normies</span><span>Made for people who make things.</span></footer>
  </main>;
}
