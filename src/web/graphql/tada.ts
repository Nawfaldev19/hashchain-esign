import { initGraphQLTada } from 'gql.tada';
import type { introspection } from './graphql-env.d.ts';

/**
 * A typed `graphql()` tag. The result and variable types of every operation are
 * inferred from schema.graphql by the TypeScript compiler, so a query that asks
 * for a field the API does not have fails the type check, with no generated
 * operation files to keep in sync.
 */
export const graphql = initGraphQLTada<{
  introspection: introspection;
  scalars: { ID: string; DateTime: string };
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
