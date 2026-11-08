import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery } from 'urql';
import { isInputKind, validateAnswers, validateSignature } from '../../../shared/fields';
import type { FieldIssue, Point, Signature } from '../../../shared/fields';
import { DocumentForm } from '../../components/DocumentForm';
import { SignaturePad } from '../../components/signature';
import { Banner, Button, ErrorState, Field, Segmented, Skeleton } from '../../components/ui';
import {
  RecordViewMutation,
  SigningSessionQuery,
  SubmitSignatureMutation,
} from '../../graphql/operations';
import {
  answersToRecord,
  fromApiField,
  fromApiSignature,
  toApiSignature,
} from '../../lib/api-mapping';
import { issuesByField, readFailure } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { ThemeToggle } from '../../components/ThemeToggle';

const CLOSED_STATES = {
  EXPIRED: {
    title: 'This link has expired',
    text: 'Ask the person who sent it to you for a new link.',
  },
  REVOKED: {
    title: 'This request was withdrawn',
    text: 'Nothing more is needed from you. Contact the sender if you expected to sign.',
  },
} as const;

type SignMode = 'draw' | 'type';

/**
 * The public page behind a signing link. There is no account here: the token in
 * the URL is the only credential, so this page never links to another site and
 * the server sends "Referrer-Policy: no-referrer" with it.
 */
export function SigningPage() {
  const { token = '' } = useParams();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: SigningSessionQuery,
    variables: { token },
  });
  const [, recordView] = useMutation(RecordViewMutation);
  const [submitting, submit] = useMutation(SubmitSignatureMutation);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<SignMode>('draw');
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [typed, setTyped] = useState('');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const padHintId = useId();

  const session = data?.signingSession;
  const state = session?.state;

  // Tell the sender the link was opened. The server ignores repeats.
  useEffect(() => {
    if (state === 'OPEN') void recordView({ token });
  }, [state, token, recordView]);

  if (fetching && !session) {
    return (
      <main className="page page--narrow">
        <Skeleton lines={8} label="Opening the document" />
      </main>
    );
  }
  if (!session) {
    const problem = readFailure(error);
    return (
      <main className="page page--narrow">
        <ErrorState
          title={problem?.code === 'NOT_FOUND' ? 'This link is not valid' : 'Something went wrong'}
          message={
            problem?.code === 'NOT_FOUND'
              ? 'Check that you copied the whole link, or ask the sender for a new one.'
              : (problem?.message ?? 'Please try again.')
          }
          onRetry={
            problem?.code === 'NOT_FOUND'
              ? undefined
              : () => {
                  refetch({ requestPolicy: 'network-only' });
                }
          }
        />
      </main>
    );
  }

  const fields = session.fields.map(fromApiField);
  const you = session.parties.find((party) => party.isYou);
  const signature: Signature =
    mode === 'type' ? { kind: 'typed', text: typed } : { kind: 'drawn', strokes };

  const send = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault();
    setFailure(null);

    // The same checks run on the server. Running them here first only saves a
    // round trip and lets every problem be shown at once.
    const found = validateAnswers(fields, session.yourBlockId, draft);
    const signatureProblem = validateSignature(signature);
    if (signatureProblem) found.push({ fieldId: session.yourBlockId, message: signatureProblem });
    setIssues(found);
    if (found.length > 0) {
      summaryRef.current?.focus();
      return;
    }

    const result = await submit({
      token,
      input: {
        answers: fields
          .filter((field) => isInputKind(field.kind) && field.assignedTo === session.yourBlockId)
          .map((field) => ({ fieldId: field.id, value: draft[field.id] ?? '' })),
        signature: toApiSignature(signature),
      },
    });
    const problem = readFailure(result.error);
    if (problem) {
      setIssues(problem.issues);
      setFailure(problem.issues.length > 0 ? null : problem.message);
      summaryRef.current?.focus();
      if (problem.code === 'CONFLICT') refetch({ requestPolicy: 'network-only' });
      return;
    }
    refetch({ requestPolicy: 'network-only' });
  };

  const closed = session.state === 'EXPIRED' || session.state === 'REVOKED';

  return (
    <>
      <div
        className="signing__band"
        style={{ background: session.accentColor }}
        aria-hidden="true"
      />
      <main id="main" className="page page--narrow rise-in">
        <div className="stack stack--loose">
          <div className="row row--between">
            <p className="eyebrow">{session.workspaceName}</p>
            <ThemeToggle />
          </div>

          {closed ? (
            <div className="card">
              <ErrorState
                title={CLOSED_STATES[session.state as keyof typeof CLOSED_STATES].title}
                message={CLOSED_STATES[session.state as keyof typeof CLOSED_STATES].text}
              />
            </div>
          ) : (
            <>
              <div className="stack stack--tight">
                <h1>{session.documentTitle}</h1>
                <p className="muted small">
                  {session.requestTitle} · version {session.versionNumber}
                  {session.state === 'OPEN'
                    ? ` · sign before ${formatDateTime(session.expiresAt)}`
                    : ''}
                </p>
                {session.documentDescription ? <p>{session.documentDescription}</p> : null}
              </div>

              {session.message ? (
                <div className="card stack stack--tight">
                  <p className="eyebrow">Message from the sender</p>
                  <p>{session.message}</p>
                </div>
              ) : null}

              {session.state === 'SIGNED' ? (
                <Banner tone="success">
                  Thank you, {you?.name}. Your signature is recorded. The document is complete once
                  everyone has signed.
                </Banner>
              ) : null}
              {session.state === 'COMPLETED' ? (
                <Banner tone="success">Everyone has signed. This document is complete.</Banner>
              ) : null}

              <form
                className="card stack stack--loose"
                noValidate
                onSubmit={(event) => {
                  void send(event);
                }}
              >
                <div ref={summaryRef} tabIndex={-1}>
                  {failure ? (
                    <Banner tone="danger" role="alert">
                      {failure}
                    </Banner>
                  ) : null}
                  {issues.length > 0 ? (
                    <Banner tone="danger" role="alert">
                      {issues.length === 1
                        ? 'One thing needs another look before you can sign.'
                        : `${String(issues.length)} things need another look before you can sign.`}
                    </Banner>
                  ) : null}
                </div>

                <DocumentForm
                  fields={fields}
                  answers={{ ...answersToRecord(session.answers), ...draft }}
                  editableBlockId={session.state === 'OPEN' ? session.yourBlockId : null}
                  issues={issuesByField(issues)}
                  onAnswer={(fieldId, value) => {
                    setDraft((current) => ({ ...current, [fieldId]: value }));
                  }}
                  parties={session.parties.map((party) => ({
                    blockId: party.blockId,
                    label: party.label,
                    name: party.name,
                    signedAt: party.signedAt,
                    signature: fromApiSignature(party.signature),
                  }))}
                  signatureSlot={
                    <div className="stack">
                      <Segmented
                        label="How to sign"
                        value={mode}
                        options={[
                          { value: 'draw', label: 'Draw' },
                          { value: 'type', label: 'Type your name' },
                        ]}
                        onChange={setMode}
                      />
                      {mode === 'draw' ? (
                        <>
                          <SignaturePad
                            strokes={strokes}
                            onChange={setStrokes}
                            describedBy={padHintId}
                          />
                          <div className="row">
                            <span className="small muted grow" id={padHintId}>
                              Draw with a mouse, pen or finger. Using a keyboard? Choose “Type your
                              name”.
                            </span>
                            <Button
                              disabled={strokes.length === 0}
                              onClick={() => {
                                setStrokes([]);
                              }}
                            >
                              Clear
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Field label="Your full name">
                          {(control) => (
                            <input
                              {...control}
                              className="input signature-typed"
                              autoComplete="name"
                              maxLength={80}
                              value={typed}
                              onChange={(event) => {
                                setTyped(event.target.value);
                              }}
                            />
                          )}
                        </Field>
                      )}
                    </div>
                  }
                />

                {session.state === 'OPEN' ? (
                  <div className="row row--between">
                    <p className="small muted grow">
                      By signing you confirm that the answers above are yours and correct.
                    </p>
                    <Button type="submit" variant="primary" busy={submitting.fetching}>
                      Sign document
                    </Button>
                  </div>
                ) : null}
              </form>
            </>
          )}
        </div>
      </main>
    </>
  );
}
