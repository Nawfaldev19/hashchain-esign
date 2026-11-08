import { useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useClient, useMutation, useQuery } from 'urql';
import { isOpen } from '../../../shared/status';
import { DocumentForm } from '../../components/DocumentForm';
import { StatusBadge } from '../../components/StatusBadge';
import { Dialog, useToast } from '../../components/overlays';
import { Badge, Banner, Button, ErrorState, Skeleton } from '../../components/ui';
import {
  HistoryCheckQuery,
  ReissueLinkMutation,
  RequestQuery,
  RevokeRequestMutation,
} from '../../graphql/operations';
import type { ResultOf } from '../../graphql/tada';
import { answersToRecord, fromApiField, fromApiSignature } from '../../lib/api-mapping';
import { readFailure } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useWorkspace } from '../auth/session';
import { LinkList } from './NewRequestDialog';

type HistoryCheck = ResultOf<typeof HistoryCheckQuery>['workspace']['request']['historyCheck'];
type NewLink = ResultOf<typeof ReissueLinkMutation>['reissueSignerLink'];

const EVENT_PHRASES: Readonly<Record<string, string>> = {
  created: 'created the request',
  viewed: 'opened the link',
  signed: 'signed',
  completed: 'collected every signature',
  revoked: 'revoked the request',
  link_reissued: 'issued a new link',
};

export function RequestDetailPage() {
  const workspace = useWorkspace();
  const { requestId = '' } = useParams();
  const client = useClient();
  const toast = useToast();
  const variables = { workspaceId: workspace.id, requestId };
  const [{ data, fetching, error }, refetch] = useQuery({ query: RequestQuery, variables });
  const [revoking, revoke] = useMutation(RevokeRequestMutation);
  const [, reissue] = useMutation(ReissueLinkMutation);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [check, setCheck] = useState<HistoryCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [newLink, setNewLink] = useState<NewLink | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const request = data?.workspace.request;
  if (fetching && !request) return <Skeleton lines={8} label="Loading the request" />;
  if (error && !request) {
    return (
      <ErrorState
        message={readFailure(error)?.message ?? 'Please try again.'}
        onRetry={() => {
          refetch({ requestPolicy: 'network-only' });
        }}
      />
    );
  }
  if (!request) return null;

  const open = isOpen(request.status);
  const fields = request.version.fields.map(fromApiField);
  const answers = Object.assign(
    {},
    ...request.signers.map((s) => answersToRecord(s.answers)),
  ) as Record<string, string>;

  const verify = async (): Promise<void> => {
    setChecking(true);
    const result = await client
      .query(HistoryCheckQuery, variables, { requestPolicy: 'network-only' })
      .toPromise();
    setChecking(false);
    const problem = readFailure(result.error);
    if (problem) setFailure(problem.message);
    else setCheck(result.data?.workspace.request.historyCheck ?? null);
  };

  const revokeNow = async (): Promise<void> => {
    const result = await revoke(variables);
    setConfirmingRevoke(false);
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem.message);
      return;
    }
    toast('Request revoked');
    refetch({ requestPolicy: 'network-only' });
  };

  const makeLink = async (signerId: string): Promise<void> => {
    setFailure(null);
    const result = await reissue({ workspaceId: workspace.id, signerId });
    const problem = readFailure(result.error);
    if (problem) {
      setFailure(problem.message);
      return;
    }
    setNewLink(result.data?.reissueSignerLink ?? null);
    refetch({ requestPolicy: 'network-only' });
  };

  return (
    <div className="stack stack--loose">
      <div className="row row--between">
        <div className="stack stack--tight">
          <p className="small">
            <Link to={`/w/${workspace.id}/requests`}>Requests</Link>
          </p>
          <h1>{request.title}</h1>
          <div className="row">
            <StatusBadge status={request.status} />
            <Badge>
              {request.version.title}, version {request.version.number}
            </Badge>
          </div>
        </div>
        <div className="row">
          <a className="button" href={request.pdfUrl} download>
            <Download aria-hidden="true" />
            Download PDF
          </a>
          {workspace.canEdit && open ? (
            <Button
              variant="danger"
              onClick={() => {
                setConfirmingRevoke(true);
              }}
            >
              Revoke
            </Button>
          ) : null}
        </div>
      </div>

      {failure ? (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      ) : null}

      <section className="card stack" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <dl className="definition">
          <dt>Sent</dt>
          <dd>{formatDateTime(request.createdAt)}</dd>
          <dt>{request.completedAt ? 'Completed' : request.revokedAt ? 'Revoked' : 'Expires'}</dt>
          <dd>{formatDateTime(request.completedAt ?? request.revokedAt ?? request.expiresAt)}</dd>
          {request.message ? (
            <>
              <dt>Message</dt>
              <dd>{request.message}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="stack" aria-labelledby="signers-heading">
        <h2 id="signers-heading">Signers</h2>
        <div className="card card--flush">
          <ul className="list">
            {request.signers.map((signer) => (
              <li key={signer.id} className="list__item">
                <div className="grow stack stack--tight">
                  <span>
                    <strong>{signer.name}</strong> <span className="muted">({signer.label})</span>
                  </span>
                  <span className="small muted">{signer.email}</span>
                </div>
                <div className="row">
                  {signer.signedAt ? (
                    <Badge tone="success">Signed {formatDateTime(signer.signedAt)}</Badge>
                  ) : signer.viewedAt ? (
                    <Badge tone="accent">Opened {formatDateTime(signer.viewedAt)}</Badge>
                  ) : (
                    <Badge>Not opened yet</Badge>
                  )}
                  {workspace.canEdit && open && !signer.signedAt ? (
                    <Button
                      onClick={() => {
                        void makeLink(signer.id);
                      }}
                    >
                      New link
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="stack" aria-labelledby="document-heading">
        <h2 id="document-heading">Document</h2>
        <div className="card stack">
          {request.version.description ? (
            <p className="muted">{request.version.description}</p>
          ) : null}
          <DocumentForm
            fields={fields}
            answers={answers}
            editableBlockId={null}
            parties={request.signers.map((signer) => ({
              blockId: signer.blockId,
              label: signer.label,
              name: signer.name,
              signedAt: signer.signedAt,
              signature: fromApiSignature(signer.signature),
            }))}
          />
        </div>
      </section>

      <section className="stack" aria-labelledby="history-heading">
        <div className="row row--between">
          <h2 id="history-heading">History</h2>
          <Button
            onClick={() => {
              void verify();
            }}
            busy={checking}
          >
            <ShieldCheck aria-hidden="true" />
            Verify history
          </Button>
        </div>
        {check ? (
          <Banner
            tone={check.intact ? 'success' : 'danger'}
            role={check.intact ? 'status' : 'alert'}
          >
            {check.intact
              ? `The history is intact. All ${String(check.checkedEvents)} events fit the hash chain, and every signed answer matches its recorded fingerprint.`
              : (check.problem ?? 'The history check failed.')}
          </Banner>
        ) : null}
        <div className="card">
          <ol className="timeline">
            {request.events.map((event) => (
              <li key={event.seq} className="timeline__item stack stack--tight">
                <span>
                  <strong>{event.actorName}</strong> {EVENT_PHRASES[event.kind] ?? event.kind}
                </span>
                <span className="small muted">
                  {formatDateTime(event.occurredAt)} ·{' '}
                  <span className="mono" title={event.hash}>
                    {event.hash.slice(0, 16)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Dialog
        open={confirmingRevoke}
        title="Revoke this request?"
        onClose={() => {
          setConfirmingRevoke(false);
        }}
      >
        <p>
          Every signing link stops working at once. Signatures already given stay in the record.
          This cannot be undone.
        </p>
        <div className="row row--end">
          <Button
            onClick={() => {
              setConfirmingRevoke(false);
            }}
          >
            Keep it
          </Button>
          <Button
            variant="danger"
            busy={revoking.fetching}
            onClick={() => {
              void revokeNow();
            }}
          >
            Revoke request
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={newLink !== null}
        title="New signing link"
        onClose={() => {
          setNewLink(null);
        }}
      >
        {newLink ? <LinkList links={[newLink]} /> : null}
        <div className="row row--end">
          <Button
            variant="primary"
            onClick={() => {
              setNewLink(null);
            }}
          >
            Done
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
