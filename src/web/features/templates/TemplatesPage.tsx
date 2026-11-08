import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { Dialog } from '../../components/overlays';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
} from '../../components/ui';
import { CreateTemplateMutation, TemplatesQuery } from '../../graphql/operations';
import { readFailure } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useWorkspace } from '../auth/session';

/**
 * One page of the list. The parent renders one of these per cursor, so "Load
 * more" adds a page below the others instead of replacing what is on screen.
 */
function TemplatePage({
  after,
  isLast,
  onLoadMore,
}: {
  after: string | null;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
}) {
  const workspace = useWorkspace();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: TemplatesQuery,
    variables: { workspaceId: workspace.id, after },
  });
  const page = data?.workspace.templates;

  if (fetching && !page) {
    return (
      <li className="list__item">
        <Skeleton lines={3} label="Loading templates" />
      </li>
    );
  }
  if (error && !page) {
    return (
      <li>
        <ErrorState
          message={readFailure(error)?.message ?? 'Please try again.'}
          onRetry={() => {
            refetch({ requestPolicy: 'network-only' });
          }}
        />
      </li>
    );
  }
  if (!page) return null;
  if (page.items.length === 0 && after === null) {
    return (
      <li>
        <EmptyState title="No templates yet">
          A template is the text and fields of an agreement. Create one, then publish it to send it
          out.
        </EmptyState>
      </li>
    );
  }

  return (
    <>
      {page.items.map((template) => (
        <li key={template.id} className="list__item">
          <div className="grow stack stack--tight">
            <Link className="list__link" to={`/w/${workspace.id}/templates/${template.id}`}>
              {template.title}
            </Link>
            {template.description ? (
              <span className="small muted">{template.description}</span>
            ) : null}
          </div>
          <div className="row">
            {template.latestVersion ? (
              <Badge tone="success">Version {template.latestVersion.number}</Badge>
            ) : (
              <Badge>Not published</Badge>
            )}
            {template.latestVersion && template.hasUnpublishedChanges ? (
              <Badge tone="accent">Unpublished changes</Badge>
            ) : null}
            <span className="small muted">Edited {formatDate(template.updatedAt)}</span>
          </div>
        </li>
      ))}
      {isLast && page.hasNextPage && page.endCursor ? (
        <li className="list__item row--end">
          <Button
            onClick={() => {
              if (page.endCursor) onLoadMore(page.endCursor);
            }}
          >
            Load more
          </Button>
        </li>
      ) : null}
    </>
  );
}

export function TemplatesPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [creating, createTemplate] = useMutation(CreateTemplateMutation);

  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    const result = await createTemplate({ workspaceId: workspace.id, title, description });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem.issues[0]?.message ?? problem.message);
      return;
    }
    if (result.data) {
      await navigate(`/w/${workspace.id}/templates/${result.data.createTemplate.id}`);
    }
  };

  return (
    <div className="stack stack--loose">
      <div className="row row--between">
        <div className="stack stack--tight">
          <h1>Templates</h1>
          <p className="muted">
            Write an agreement once, publish it, and send it as often as needed.
          </p>
        </div>
        {workspace.canEdit ? (
          <Button
            variant="primary"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            New template
          </Button>
        ) : null}
      </div>

      <div className="card card--flush">
        <ul className="list">
          {cursors.map((cursor, index) => (
            <TemplatePage
              key={cursor ?? 'first'}
              after={cursor}
              isLast={index === cursors.length - 1}
              onLoadMore={(next) => {
                setCursors((current) => [...current, next]);
              }}
            />
          ))}
        </ul>
      </div>

      <Dialog
        open={dialogOpen}
        title="New template"
        onClose={() => {
          setDialogOpen(false);
        }}
      >
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
          <Field label="Title">
            {(control) => (
              <input
                {...control}
                className="input"
                required
                maxLength={120}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Description (optional)">
            {(control) => (
              <textarea
                {...control}
                className="textarea"
                maxLength={1000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="row row--end">
            <Button
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={creating.fetching}>
              Create and edit
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
