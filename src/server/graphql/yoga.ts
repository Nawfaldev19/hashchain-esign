import type { IncomingMessage } from 'node:http';
import { GraphQLError } from 'graphql';
import { createYoga } from 'graphql-yoga';
import type { Plugin } from 'graphql-yoga';
import { AppError } from '../domain/errors';
import type { Logger } from '../logger';
import { describeError } from '../logger';
import type { Deps } from '../services/records';
import { buildContext } from './context';
import type { GraphQLContext } from './context';
import { schema } from './schema';

interface ServerContext {
  req?: IncomingMessage;
}

/**
 * Cookies set by resolvers are collected per request and written when the
 * response is ready. This works the same under Node's HTTP server and under
 * yoga.fetch(), which the integration tests use.
 */
function createCookieStore(secure: boolean) {
  const pending = new WeakMap<Request, string[]>();
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

  return {
    writerFor(request: Request) {
      const list: string[] = [];
      pending.set(request, list);
      return {
        set(name: string, value: string, expires: Date) {
          list.push(
            `${name}=${encodeURIComponent(value)}; Expires=${expires.toUTCString()}; ${attributes}`,
          );
        },
        clear(name: string) {
          list.push(`${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attributes}`);
        },
      };
    },
    plugin: {
      onResponse({ request, response }) {
        for (const cookie of pending.get(request) ?? []) {
          response.headers.append('set-cookie', cookie);
        }
      },
    } satisfies Plugin,
  };
}

export function createGraphQLServer(options: {
  deps: Deps;
  logger: Logger;
  secureCookies: boolean;
  graphiql: boolean;
}) {
  const cookieStore = createCookieStore(options.secureCookies);

  return createYoga<ServerContext, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    landingPage: false,
    graphiql: options.graphiql,
    logging: false,
    plugins: [cookieStore.plugin],
    context: ({ request, req }) =>
      buildContext(
        options.deps,
        request,
        req?.socket.remoteAddress ?? 'local',
        cookieStore.writerFor(request),
      ),
    maskedErrors: {
      /**
       * Expected failures (AppError) reach the caller with a stable code.
       * Anything else is a bug: it is logged in full and the caller only
       * learns that something went wrong.
       */
      maskError(error) {
        // Read by shape, not with instanceof: a bundler or test runner can load
        // two copies of the graphql package, and instanceof fails across them.
        const wrapper = error as { originalError?: unknown; nodes?: unknown; path?: unknown };
        const original = wrapper.originalError ?? error;
        if (error instanceof Error && error.name === 'GraphQLError' && !wrapper.originalError) {
          // Raised by GraphQL itself (an invalid query, a mutation sent by GET).
          // It describes the caller's mistake and is safe to return as it is.
          return error;
        }
        if (original instanceof AppError) {
          return new GraphQLError(original.message, {
            path: Array.isArray(wrapper.path) ? (wrapper.path as (string | number)[]) : undefined,
            extensions: { code: original.code, issues: [...original.issues] },
          });
        }
        options.logger.error('Unhandled error in a resolver', describeError(original));
        return new GraphQLError('Something went wrong on our side.', {
          extensions: { code: 'INTERNAL' },
        });
      },
    },
  });
}
