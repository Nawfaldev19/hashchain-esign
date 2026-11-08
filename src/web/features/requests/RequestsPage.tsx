import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from 'urql';
import { REQUEST_STATUSES, STATUS_LABELS } from '../../../shared/status';
import type { RequestStatus } from '../../../shared/status';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, EmptyState, ErrorState, Segmented, Skeleton } from '../../components/ui';
import { RequestsQuery } from '../../graphql/operations';
import { readFailure } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useWorkspace } from '../auth/session';
import { NewRequestDialog } from './NewRequestDialog';

type Filter = RequestStatus | 'ALL';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  ...REQUEST_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
];

function RequestPage({
  after,
  status,
  isLast,
  onLoadMore,
}: {
  after: string | null;
  status: RequestStatus | null;
  isLast: boolean;
  onLoadMore: (cursor: string) => void;
}) {
  const workspace = useWorkspace();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: RequestsQuery,
    variables: { workspaceId: workspace.id, after, status },
  });
  const page = data?.workspace.requests;

  if (fetching && !page) {
    return (
      <li className="list__item">
        <Skeleton lines={3} label="Loading requests" />
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
        <EmptyState title={status ? 'Nothing with this status' : 'No requests yet'}>
          {status
            ? 'Pick another filter to see more.'
            : 'A request sends a published template to the people who need to sign it.'}
        </EmptyState>
      </li>
    );
  }

  return (
    <>
      {page.items.map((request) => (
        <li key={request.id} className="list__item">
          <div className="grow stack stack--tight">
            <Link className="list__link" to={`/w/${workspace.id}/requests/${request.id}`}>
              {request.title}
            </Link>
            <span className="small muted">
              {request.version.title}, version {request.version.number} ·{' '}
              {request.signers.map((signer) => signer.name).join(', ')}
            </span>
          </div>
          <div className="row">
            <span className="small muted">
              {request.signedCount} of {request.signerCount} signed
            </span>
            <StatusBadge status={request.status} />
            <span className="small muted">{formatDate(request.createdAt)}</span>
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

export function RequestsPage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = filter === 'ALL' ? null : filter;

  return (
    <div className="stack stack--loose">
      <div className="row row--between">
        <div className="stack stack--tight">
          <h1>Requests</h1>
          <p className="muted">Everything that was sent out for signature in {workspace.name}.</p>
        </div>
        {workspace.canEdit ? (
          <Button
            variant="primary"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            New request
          </Button>
        ) : null}
      </div>

      <Segmented
        label="Filter by status"
        value={filter}
        options={FILTERS}
        onChange={(next) => {
          setFilter(next);
          setCursors([null]);
        }}
      />

      <div className="card card--flush">
        <ul className="list" aria-label="Signing requests">
          {cursors.map((cursor, index) => (
            <RequestPage
              key={`${filter}-${cursor ?? 'first'}`}
              after={cursor}
              status={status}
              isLast={index === cursors.length - 1}
              onLoadMore={(next) => {
                setCursors((current) => [...current, next]);
              }}
            />
          ))}
        </ul>
      </div>

      <NewRequestDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        onCreated={(requestId) => {
          setDialogOpen(false);
          void navigate(`/w/${workspace.id}/requests/${requestId}`);
        }}
      />
    </div>
  );
}
