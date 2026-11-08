import { STATUS_LABELS } from '../../shared/status';
import type { RequestStatus } from '../../shared/status';
import { Badge } from './ui';

const TONES = {
  AWAITING: 'primary',
  PARTLY_SIGNED: 'accent',
  COMPLETED: 'success',
  EXPIRED: 'warning',
  REVOKED: 'danger',
} as const satisfies Record<RequestStatus, string>;

/** The status is always written out in words; colour only supports it. */
export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
