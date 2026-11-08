import type { CombinedError } from 'urql';
import type { FieldIssue } from '../../shared/fields';

export interface ApiFailure {
  /** A stable code from the API, or NETWORK when the request never arrived. */
  code: string;
  message: string;
  issues: FieldIssue[];
}

function isIssue(value: unknown): value is FieldIssue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    (candidate.fieldId === null || typeof candidate.fieldId === 'string')
  );
}

/** Turns whatever urql reports into one shape the UI can show. */
export function readFailure(error: CombinedError | undefined): ApiFailure | null {
  if (!error) return null;
  const first = error.graphQLErrors[0];
  if (!first) {
    return {
      code: 'NETWORK',
      message: 'The server could not be reached. Check your connection and try again.',
      issues: [],
    };
  }
  const code = typeof first.extensions.code === 'string' ? first.extensions.code : 'INTERNAL';
  const rawIssues: unknown = first.extensions.issues;
  return {
    code,
    message: first.message,
    issues: Array.isArray(rawIssues) ? rawIssues.filter(isIssue) : [],
  };
}

export function issuesByField(issues: readonly FieldIssue[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.fieldId === null) continue;
    grouped.set(issue.fieldId, [...(grouped.get(issue.fieldId) ?? []), issue.message]);
  }
  return grouped;
}
