import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { useToast } from '../../components/overlays';
import { Badge, Banner, Button, ErrorState, Field, Skeleton } from '../../components/ui';
import { SettingsQuery, UpdateBrandingMutation } from '../../graphql/operations';
import { readFailure } from '../../lib/errors';
import { useWorkspace } from '../auth/session';

const ROLE_LABELS = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' } as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function SettingsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: SettingsQuery,
    variables: { workspaceId: workspace.id },
  });
  const [saving, updateBranding] = useMutation(UpdateBrandingMutation);
  const [name, setName] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const settings = data?.workspace;
  const loadedName = settings?.name;
  const loadedColor = settings?.accentColor;
  useEffect(() => {
    if (loadedName === undefined || loadedColor === undefined) return;
    setName(loadedName);
    setAccentColor(loadedColor);
  }, [loadedName, loadedColor]);

  if (fetching && !settings) return <Skeleton lines={6} label="Loading settings" />;
  if (error && !settings) {
    return (
      <ErrorState
        message={readFailure(error)?.message ?? 'Please try again.'}
        onRetry={() => {
          refetch({ requestPolicy: 'network-only' });
        }}
      />
    );
  }
  if (!settings) return null;

  const colorIsValid = HEX_COLOR.test(accentColor);
  const changed = name !== settings.name || accentColor !== settings.accentColor;

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    const result = await updateBranding({ workspaceId: workspace.id, name, accentColor });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem.issues[0]?.message ?? problem.message);
      return;
    }
    toast('Branding saved');
  };

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <h1>Settings</h1>
        <p className="muted">How {settings.name} appears to the people who sign.</p>
      </div>

      <form
        className="card stack"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <h2>Branding</h2>
        {workspace.isOwner ? null : (
          <Banner tone="warning">Only an owner can change these settings.</Banner>
        )}
        {failure ? (
          <Banner tone="danger" role="alert">
            {failure}
          </Banner>
        ) : null}
        <Field label="Workspace name">
          {(control) => (
            <input
              {...control}
              className="input"
              required
              maxLength={80}
              disabled={!workspace.isOwner}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Accent colour"
          hint="A six-digit hex colour, used as a band on the signing page and in the PDF."
          errors={colorIsValid ? [] : ['Use a colour like #0F5C5C.']}
        >
          {(control) => (
            <div className="row">
              <input
                type="color"
                aria-label="Pick the accent colour"
                disabled={!workspace.isOwner}
                value={colorIsValid ? accentColor : '#000000'}
                onChange={(event) => {
                  setAccentColor(event.target.value.toUpperCase());
                }}
              />
              <input
                {...control}
                className="input mono grow"
                disabled={!workspace.isOwner}
                value={accentColor}
                onChange={(event) => {
                  setAccentColor(event.target.value);
                }}
              />
            </div>
          )}
        </Field>
        {workspace.isOwner ? (
          <div className="row row--end">
            <Button
              type="submit"
              variant="primary"
              disabled={!changed || !colorIsValid}
              busy={saving.fetching}
            >
              Save branding
            </Button>
          </div>
        ) : null}
      </form>

      <section className="stack" aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <div className="card card--flush">
          <ul className="list">
            {settings.members.map((member) => (
              <li key={member.id} className="list__item">
                <div className="grow stack stack--tight">
                  <strong>{member.name}</strong>
                  <span className="small muted">{member.email}</span>
                </div>
                <Badge tone={member.role === 'OWNER' ? 'primary' : 'neutral'}>
                  {ROLE_LABELS[member.role]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
