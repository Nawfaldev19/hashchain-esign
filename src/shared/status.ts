/**
 * The status of a signing request is derived from dated facts instead of being
 * stored, so it can never disagree with them (an "open" request whose expiry
 * date has passed cannot exist).
 */

export const REQUEST_STATUSES = [
  'AWAITING',
  'PARTLY_SIGNED',
  'COMPLETED',
  'EXPIRED',
  'REVOKED',
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface RequestFacts {
  expiresAt: Date;
  completedAt: Date | null;
  revokedAt: Date | null;
  signerCount: number;
  signedCount: number;
}

export function deriveRequestStatus(facts: RequestFacts, now: Date): RequestStatus {
  if (facts.revokedAt !== null) return 'REVOKED';
  if (facts.completedAt !== null) return 'COMPLETED';
  if (facts.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return facts.signedCount > 0 ? 'PARTLY_SIGNED' : 'AWAITING';
}

/** A request still accepts signatures only in these two states. */
export function isOpen(status: RequestStatus): boolean {
  return status === 'AWAITING' || status === 'PARTLY_SIGNED';
}

export const STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  AWAITING: 'Awaiting signatures',
  PARTLY_SIGNED: 'Partly signed',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};
