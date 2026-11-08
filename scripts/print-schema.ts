import { writeFile } from 'node:fs/promises';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { schema } from '../src/server/graphql/schema';

/**
 * Writes the GraphQL schema to schema.graphql. The web app's typed operations
 * are checked against this file, so run "npm run codegen" after a schema change.
 */
await writeFile('schema.graphql', `${printSchema(lexicographicSortSchema(schema))}\n`);
