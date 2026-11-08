import { Client, cacheExchange, fetchExchange } from 'urql';

/**
 * The session lives in an HttpOnly cookie, so the client holds no credentials.
 * "cache-and-network" shows cached data at once and then refreshes it, which
 * suits lists whose status changes when somebody else signs.
 */
export function createClient(): Client {
  return new Client({
    url: '/graphql',
    exchanges: [cacheExchange, fetchExchange],
    requestPolicy: 'cache-and-network',
    fetchOptions: { credentials: 'same-origin' },
  });
}
