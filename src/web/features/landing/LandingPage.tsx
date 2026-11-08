import { useState } from 'react';
import { Building2, FileText, History, Link2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Banner, Button } from '../../components/ui';
import { isFailure, useSession } from '../auth/session';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Brand } from '../shell/AppShell';

/** Demo accounts seeded by the server. They are fictional and documented in the README. */
export const DEMO_PASSWORD = 'makerspace-demo';
export const DEMO_ACCOUNTS = [
  { role: 'Owner', email: 'mira@example.com', can: 'everything, in two workspaces' },
  { role: 'Editor', email: 'jonas@example.com', can: 'edit templates and send requests' },
  { role: 'Viewer', email: 'priya@example.com', can: 'read only' },
] as const;

const FEATURES = [
  {
    icon: FileText,
    title: 'Versioned templates',
    text: 'Edit a draft freely. Publishing freezes a numbered version, and a request always points at the version that was sent.',
  },
  {
    icon: Link2,
    title: 'Private signing links',
    text: 'Each signer gets one link and needs no account. Only a hash of the link is stored, and it can expire or be revoked.',
  },
  {
    icon: History,
    title: 'Tamper-evident history',
    text: 'Every event is chained to the one before by a hash, so a later change to the record can be detected.',
  },
  {
    icon: Building2,
    title: 'Isolated workspaces',
    text: 'Row-level security in the database keeps each workspace apart, even if the application code makes a mistake.',
  },
] as const;

export function LandingPage() {
  const { viewer, signIn } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const open = async (email: string): Promise<void> => {
    setBusy(email);
    setFailure(null);
    const result = await signIn(email, DEMO_PASSWORD);
    setBusy(null);
    if (isFailure(result)) {
      setFailure(result.message);
      return;
    }
    const first = result.memberships[0];
    if (first) await navigate(`/w/${first.workspace.id}/requests`);
  };

  const firstWorkspace = viewer?.memberships[0]?.workspace.id;

  return (
    <>
      <header className="shell__header">
        <div className="shell__bar row--between">
          <Brand />
          <div className="row">
            <ThemeToggle />
            {firstWorkspace ? (
              <Button
                variant="primary"
                onClick={() => {
                  void navigate(`/w/${firstWorkspace}/requests`);
                }}
              >
                Open your workspace
              </Button>
            ) : (
              <Button
                onClick={() => {
                  void navigate('/login');
                }}
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="page rise-in">
        <section className="hero">
          <p className="eyebrow">A portfolio demo</p>
          <h1 className="hero__title">Agreements that stay the way they were signed.</h1>
          <p className="hero__lead">
            Signoff Ledger is a small product for a fictional community makerspace. Staff write
            agreement templates, publish them as fixed versions and send them out for signature. It
            exists to show how versioning, public signing links, an auditable history and
            multi-tenant isolation fit together.
          </p>
        </section>

        <section className="stack stack--loose" aria-labelledby="demo-heading">
          <div className="card stack">
            <h2 id="demo-heading">Open the demo</h2>
            <p className="muted">
              The data is seeded and fictional. Pick a role to sign in. Every account uses the
              password <code>{DEMO_PASSWORD}</code>.
            </p>
            {failure ? (
              <Banner tone="danger" role="alert">
                {failure}
              </Banner>
            ) : null}
            <div className="row">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.email}
                  variant={account.role === 'Owner' ? 'primary' : 'default'}
                  busy={busy === account.email}
                  disabled={busy !== null}
                  onClick={() => {
                    void open(account.email);
                  }}
                >
                  Continue as {account.role.toLowerCase()}
                </Button>
              ))}
            </div>
            <dl className="definition small">
              {DEMO_ACCOUNTS.map((account) => (
                <div key={account.email} style={{ display: 'contents' }}>
                  <dt>{account.role}</dt>
                  <dd>
                    <code>{account.email}</code>, can {account.can}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="card stack stack--tight">
                <feature.icon aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p className="muted small">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
