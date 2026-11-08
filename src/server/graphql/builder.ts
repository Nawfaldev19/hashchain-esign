import SchemaBuilder from '@pothos/core';
import { invalid } from '../domain/errors';
import type { GraphQLContext } from './context';

/**
 * The schema is written in TypeScript ("code first"). Resolver arguments and
 * return values are checked against the same types the services use, so the
 * schema and the code cannot drift apart without a compile error.
 */
export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
  Scalars: {
    ID: { Input: string; Output: string };
    DateTime: { Input: Date; Output: Date };
  };
}>({
  defaultFieldNullability: false,
  defaultInputFieldRequiredness: true,
});

builder.scalarType('DateTime', {
  description: 'A moment in time as an ISO 8601 string in UTC.',
  serialize: (value) => value.toISOString(),
  parseValue: (value) => {
    const date = new Date(typeof value === 'string' ? value : Number.NaN);
    if (Number.isNaN(date.getTime())) throw invalid('DateTime must be an ISO 8601 string.');
    return date;
  },
});

builder.queryType({});
builder.mutationType({});
