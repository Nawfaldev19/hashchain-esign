import { createContext, use } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import { useClient, useQuery } from 'urql';
import type { Client } from 'urql';
import { ErrorState, Skeleton } from '../../components/ui';
import { LoginMutation, LogoutMutation, ViewerQuery } from '../../graphql/operations';
import type { ResultOf } from '../../graphql/tada';
import { readFailure } from '../../lib/errors';
import type { ApiFailure } from '../../lib/errors';

type Viewer = NonNullable<ResultOf<typeof ViewerQuery>['viewer']>;
type Membership = Viewer['memberships'][number];

/** Asks the server who is signed in, bypassing the cache, and updates every subscriber. */
async function refreshViewer(client: Client): Promise<Viewer | null> {
  const result = await client.query(ViewerQuery, {}, { requestPolicy: 'network-only' }).toPromise();
  return result.data?.viewer ?? null;
}

export function useSession() {
  const client = useClient();
  const [{ data, fetching, error }] = useQuery({ query: ViewerQuery });

  const signIn = async (email: string, password: string): Promise<Viewer | ApiFailure> => {
    const result = await client.mutation(LoginMutation, { email, password }).toPromise();
    const failure = readFailure(result.error);
    if (failure) return failure;
    const viewer = await refreshViewer(client);
    return viewer ?? { code: 'INTERNAL', message: 'Sign-in did not complete.', issues: [] };
  };

  const signOut = async (): Promise<void> => {
    await client.mutation(LogoutMutation, {}).toPromise();
    await refreshViewer(client);
  };

  return { viewer: data?.viewer ?? null, loading: fetching && !data, error, signIn, signOut };
}

export function isFailure(value: Viewer | ApiFailure): value is ApiFailure {
  return 'code' in value;
}

export interface WorkspaceContextValue {
  id: string;
  name: string;
  role: Membership['role'];
  canEdit: boolean;
  isOwner: boolean;
  viewer: Viewer;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** The workspace named in the URL, for pages rendered inside WorkspaceRoute. */
export function useWorkspace(): WorkspaceContextValue {
  const workspace = use(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used inside a workspace route.');
  return workspace;
}

/**
 * Guards every /w/:workspaceId page: sends signed-out visitors to the sign-in
 * page and shows "not found" for a workspace the viewer is not a member of.
 * This is a convenience for honest users. The API enforces the same rule.
 */
export function WorkspaceRoute({ shell }: { shell: (content: ReactNode) => ReactNode }) {
  const { viewer, loading, error } = useSession();
  const { workspaceId } = useParams();
  const location = useLocation();

  if (loading) {
    return (
      <main className="page">
        <Skeleton lines={5} label="Checking your session" />
      </main>
    );
  }
  if (error && !viewer) {
    return (
      <main className="page">
        <ErrorState message={readFailure(error)?.message ?? 'Please try again.'} />
      </main>
    );
  }
  if (!viewer) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const membership = viewer.memberships.find((item) => item.workspace.id === workspaceId);
  if (!membership) {
    return (
      <main className="page">
        <ErrorState
          title="Workspace not found"
          message="It does not exist, or you are not a member of it."
        />
      </main>
    );
  }

  const value: WorkspaceContextValue = {
    id: membership.workspace.id,
    name: membership.workspace.name,
    role: membership.role,
    canEdit: membership.role !== 'VIEWER',
    isOwner: membership.role === 'OWNER',
    viewer,
  };
  return <WorkspaceContext value={value}>{shell(<Outlet />)}</WorkspaceContext>;
}
