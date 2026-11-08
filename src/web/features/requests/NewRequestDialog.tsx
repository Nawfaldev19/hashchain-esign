import { useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { CopyButton, Dialog } from '../../components/overlays';
import { Banner, Button, Field, Skeleton } from '../../components/ui';
import { CreateRequestMutation, PublishedTemplatesQuery } from '../../graphql/operations';
import type { ResultOf } from '../../graphql/tada';
import { readFailure } from '../../lib/errors';
import { useWorkspace } from '../auth/session';

type Link = ResultOf<typeof CreateRequestMutation>['createSigningRequest']['links'][number];

/** Shows freshly made signing links. They cannot be shown again later. */
export function LinkList({ links }: { links: readonly Link[] }) {
  return (
    <div className="stack">
      <Banner tone="warning">
        Copy these links now. Only a fingerprint of each link is stored, so they cannot be shown
        again. A new link can be made later, which cancels the old one.
      </Banner>
      {links.map((link) => (
        <div key={link.signerId} className="stack stack--tight">
          <span className="field__label">
            {link.name} ({link.label})
          </span>
          <div className="row">
            <input
              className="input grow mono"
              readOnly
              value={link.url}
              aria-label={`Signing link for ${link.name}`}
              onFocus={(event) => {
                event.target.select();
              }}
            />
            <CopyButton text={link.url} label={`Copy the signing link for ${link.name}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface SignerDraft {
  name: string;
  email: string;
}

export function NewRequestDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (requestId: string) => void;
}) {
  return (
    <Dialog open={open} title="New signing request" onClose={onClose}>
      <NewRequestForm onClose={onClose} onCreated={onCreated} />
    </Dialog>
  );
}

function NewRequestForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (requestId: string) => void;
}) {
  const workspace = useWorkspace();
  const [{ data, fetching }] = useQuery({
    query: PublishedTemplatesQuery,
    variables: { workspaceId: workspace.id },
  });
  const [creating, createRequest] = useMutation(CreateRequestMutation);
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [signers, setSigners] = useState<Record<string, SignerDraft>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<{ requestId: string; links: Link[] } | null>(null);

  if (created) {
    return (
      <>
        <LinkList links={created.links} />
        <div className="row row--end">
          <Button
            variant="primary"
            onClick={() => {
              onCreated(created.requestId);
            }}
          >
            Open the request
          </Button>
        </div>
      </>
    );
  }
  if (fetching && !data) return <Skeleton lines={4} label="Loading templates" />;

  const published = (data?.workspace.templates.items ?? []).flatMap((template) =>
    template.latestVersion ? [{ title: template.title, version: template.latestVersion }] : [],
  );
  if (published.length === 0) {
    return (
      <>
        <p className="muted">
          Publish a template first. Requests are always made from a published version.
        </p>
        <div className="row row--end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </>
    );
  }

  const selected = published.find((item) => item.version.id === versionId) ?? published[0];
  if (!selected) return null;
  const blocks = selected.version.signatureBlocks;

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    const result = await createRequest({
      workspaceId: workspace.id,
      input: {
        templateVersionId: selected.version.id,
        title: title.trim() === '' ? selected.title : title,
        message,
        expiresInDays,
        signers: blocks.map((block) => ({
          blockId: block.id,
          name: signers[block.id]?.name ?? '',
          email: signers[block.id]?.email ?? '',
        })),
      },
    });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem.issues[0]?.message ?? problem.message);
      return;
    }
    if (result.data) {
      setCreated({
        requestId: result.data.createSigningRequest.request.id,
        links: result.data.createSigningRequest.links,
      });
    }
  };

  const setSigner = (blockId: string, patch: Partial<SignerDraft>): void => {
    setSigners((current) => ({
      ...current,
      [blockId]: { name: '', email: '', ...current[blockId], ...patch },
    }));
  };

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {failure ? (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      ) : null}
      <Field label="Template">
        {(control) => (
          <select
            {...control}
            className="select"
            value={selected.version.id}
            onChange={(event) => {
              setVersionId(event.target.value);
            }}
          >
            {published.map((item) => (
              <option key={item.version.id} value={item.version.id}>
                {item.title} (version {item.version.number})
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Request title" hint="Leave empty to use the template title.">
        {(control) => (
          <input
            {...control}
            className="input"
            maxLength={120}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Message to the signers (optional)">
        {(control) => (
          <textarea
            {...control}
            className="textarea"
            maxLength={1000}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Links expire after (days)">
        {(control) => (
          <input
            {...control}
            className="input"
            type="number"
            min={1}
            max={90}
            required
            value={expiresInDays}
            onChange={(event) => {
              setExpiresInDays(Number(event.target.value));
            }}
          />
        )}
      </Field>
      {blocks.map((block) => (
        <fieldset key={block.id} className="document__party stack stack--tight">
          <legend className="eyebrow">{block.label}</legend>
          <Field label={`Name of the ${block.label.toLowerCase()}`}>
            {(control) => (
              <input
                {...control}
                className="input"
                required
                maxLength={80}
                value={signers[block.id]?.name ?? ''}
                onChange={(event) => {
                  setSigner(block.id, { name: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={`Email of the ${block.label.toLowerCase()}`}>
            {(control) => (
              <input
                {...control}
                className="input"
                type="email"
                required
                value={signers[block.id]?.email ?? ''}
                onChange={(event) => {
                  setSigner(block.id, { email: event.target.value });
                }}
              />
            )}
          </Field>
        </fieldset>
      ))}
      <div className="row row--end">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={creating.fetching}>
          Create request
        </Button>
      </div>
    </form>
  );
}
