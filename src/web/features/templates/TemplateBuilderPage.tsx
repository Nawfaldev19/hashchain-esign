import { useEffect, useMemo, useReducer, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { FIELD_KINDS, signatureBlocks, validateForPublishing } from '../../../shared/fields';
import { DocumentForm } from '../../components/DocumentForm';
import { useToast } from '../../components/overlays';
import { Badge, Banner, Button, ErrorState, Field, Skeleton } from '../../components/ui';
import {
  PublishTemplateMutation,
  SaveDraftMutation,
  TemplateQuery,
} from '../../graphql/operations';
import { fromApiField, toApiField } from '../../lib/api-mapping';
import { issuesByField, readFailure } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useWorkspace } from '../auth/session';
import { FieldCard } from './FieldCard';
import { KIND_LABELS, builderReducer, emptyBuilderState } from './builder-state';

export function TemplateBuilderPage() {
  const workspace = useWorkspace();
  const { templateId = '' } = useParams();
  const toast = useToast();
  const variables = { workspaceId: workspace.id, templateId };
  const [{ data, fetching, error }, refetch] = useQuery({ query: TemplateQuery, variables });
  const [saving, saveDraft] = useMutation(SaveDraftMutation);
  const [publishing, publish] = useMutation(PublishTemplateMutation);
  const [state, dispatch] = useReducer(builderReducer, emptyBuilderState);
  const [problem, setProblem] = useState<{ message: string; conflict: boolean } | null>(null);

  const template = data?.workspace.template;
  const loadedRevision = template?.draftRevision;

  // Copy the server's draft into the working copy when it first arrives and
  // whenever a newer revision is loaded, but never over unsaved edits.
  useEffect(() => {
    if (!template || state.dirty || state.revision === template.draftRevision) return;
    dispatch({
      type: 'loaded',
      title: template.title,
      description: template.description,
      fields: template.draftFields.map(fromApiField),
      revision: template.draftRevision,
    });
  }, [template, loadedRevision, state.dirty, state.revision]);

  useEffect(() => {
    if (!state.dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [state.dirty]);

  const issues = useMemo(() => validateForPublishing(state.fields), [state.fields]);
  const fieldIssues = useMemo(() => issuesByField(issues), [issues]);
  const blocks = useMemo(() => signatureBlocks(state.fields), [state.fields]);

  if (fetching && !template) return <Skeleton lines={8} label="Loading the template" />;
  if (error && !template) {
    return (
      <ErrorState
        message={readFailure(error)?.message ?? 'Please try again.'}
        onRetry={() => {
          refetch({ requestPolicy: 'network-only' });
        }}
      />
    );
  }
  if (!template) return null;

  const readOnly = !workspace.canEdit;
  const latest = template.versions[0];
  const canPublish =
    !state.dirty && issues.length === 0 && template.hasUnpublishedChanges && !readOnly;

  const save = async (): Promise<void> => {
    setProblem(null);
    const result = await saveDraft({
      ...variables,
      input: {
        title: state.title,
        description: state.description,
        fields: state.fields.map(toApiField),
        expectedRevision: state.revision,
      },
    });
    const failure = readFailure(result.error);
    if (failure) {
      setProblem({ message: failure.message, conflict: failure.code === 'CONFLICT' });
      return;
    }
    if (result.data) {
      dispatch({ type: 'saved', revision: result.data.saveTemplateDraft.draftRevision });
      toast('Draft saved');
      refetch({ requestPolicy: 'network-only' });
    }
  };

  const publishNow = async (): Promise<void> => {
    setProblem(null);
    const result = await publish(variables);
    const failure = readFailure(result.error);
    if (failure) {
      setProblem({ message: failure.message, conflict: false });
      return;
    }
    toast(`Version ${String(result.data?.publishTemplate.number ?? '')} published`);
    refetch({ requestPolicy: 'network-only' });
  };

  const discardAndReload = (): void => {
    setProblem(null);
    dispatch({
      type: 'loaded',
      title: template.title,
      description: template.description,
      fields: template.draftFields.map(fromApiField),
      revision: 0,
    });
    refetch({ requestPolicy: 'network-only' });
  };

  return (
    <div className="stack stack--loose">
      <div className="row row--between">
        <div className="stack stack--tight">
          <p className="small">
            <Link to={`/w/${workspace.id}/templates`}>Templates</Link>
          </p>
          <h1>{state.title || 'Untitled template'}</h1>
          <div className="row">
            {latest ? (
              <Badge tone="success">
                Version {latest.number} published {formatDateTime(latest.publishedAt)}
              </Badge>
            ) : (
              <Badge>Never published</Badge>
            )}
            {state.dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
            {!state.dirty && template.hasUnpublishedChanges && latest ? (
              <Badge tone="accent">Draft is ahead of version {latest.number}</Badge>
            ) : null}
          </div>
        </div>
        {readOnly ? (
          <Badge>Read only</Badge>
        ) : (
          <div className="row">
            <Button
              onClick={() => {
                void save();
              }}
              disabled={!state.dirty}
              busy={saving.fetching}
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void publishNow();
              }}
              disabled={!canPublish}
              busy={publishing.fetching}
            >
              Publish version {(latest?.number ?? 0) + 1}
            </Button>
          </div>
        )}
      </div>

      {problem ? (
        <Banner tone="danger" role="alert">
          <span className="grow">{problem.message}</span>
          {problem.conflict ? (
            <Button onClick={discardAndReload}>Discard my changes and reload</Button>
          ) : null}
        </Banner>
      ) : null}
      {!readOnly && issues.length > 0 ? (
        <Banner tone="warning">
          <div className="stack stack--tight">
            <strong>Before this draft can be published:</strong>
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {[...new Set(issues.map((issue) => issue.message))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </Banner>
      ) : null}

      <div className="builder">
        <section className="stack" aria-labelledby="fields-heading">
          <h2 id="fields-heading">Fields</h2>
          <div className="card stack">
            <Field label="Title">
              {(control) => (
                <input
                  {...control}
                  className="input"
                  disabled={readOnly}
                  value={state.title}
                  onChange={(event) => {
                    dispatch({ type: 'titleChanged', title: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label="Description" hint="Shown to signers under the title.">
              {(control) => (
                <textarea
                  {...control}
                  className="textarea"
                  disabled={readOnly}
                  value={state.description}
                  onChange={(event) => {
                    dispatch({ type: 'descriptionChanged', description: event.target.value });
                  }}
                />
              )}
            </Field>
          </div>

          <ol className="list stack">
            {state.fields.map((field, index) => (
              <FieldCard
                key={field.id}
                field={field}
                position={index}
                total={state.fields.length}
                signatureBlocks={blocks}
                issues={fieldIssues.get(field.id) ?? []}
                disabled={readOnly}
                dispatch={dispatch}
              />
            ))}
          </ol>

          {readOnly ? null : (
            <div className="add-field" role="group" aria-label="Add a field">
              {FIELD_KINDS.map((kind) => (
                <Button
                  key={kind}
                  onClick={() => {
                    dispatch({ type: 'fieldAdded', kind });
                  }}
                >
                  <Plus aria-hidden="true" />
                  {KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className="builder__preview stack" aria-labelledby="preview-heading">
          <h2 id="preview-heading">Preview</h2>
          <div className="card stack">
            <div className="stack stack--tight">
              <h3>{state.title || 'Untitled template'}</h3>
              {state.description ? <p className="muted">{state.description}</p> : null}
            </div>
            {state.fields.length === 0 ? (
              <p className="muted">Add a field to see the document take shape.</p>
            ) : (
              <DocumentForm
                fields={state.fields}
                parties={[]}
                answers={{}}
                editableBlockId={null}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
