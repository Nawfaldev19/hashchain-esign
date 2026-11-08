import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Banner, Button, Field } from '../../components/ui';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../landing/LandingPage';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Brand } from '../shell/AppShell';
import { isFailure, useSession } from './session';

export function LoginPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await signIn(email, password);
    setBusy(false);
    if (isFailure(result)) {
      setFailure(result.message);
      return;
    }
    const state = location.state as { from?: unknown } | null;
    const from = typeof state?.from === 'string' ? state.from : null;
    const first = result.memberships[0];
    await navigate(from ?? (first ? `/w/${first.workspace.id}/requests` : '/'), { replace: true });
  };

  return (
    <>
      <header className="shell__header">
        <div className="shell__bar row--between">
          <Brand />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="page page--narrow rise-in">
        <form
          className="card stack"
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <h1>Sign in</h1>
          {failure ? (
            <Banner tone="danger" role="alert">
              {failure}
            </Banner>
          ) : null}
          <Field label="Email">
            {(control) => (
              <input
                {...control}
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Password">
            {(control) => (
              <input
                {...control}
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="row row--between">
            <Button
              onClick={() => {
                setEmail(DEMO_ACCOUNTS[0].email);
                setPassword(DEMO_PASSWORD);
              }}
            >
              Fill in the demo owner
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              Sign in
            </Button>
          </div>
          <p className="small muted">
            All demo accounts are listed on the <Link to="/">start page</Link>.
          </p>
        </form>
      </main>
    </>
  );
}
