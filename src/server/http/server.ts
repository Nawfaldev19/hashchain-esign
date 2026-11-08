import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import path from 'node:path';
import { AppError } from '../domain/errors';
import { SESSION_COOKIE, readCookie } from '../graphql/context';
import { createGraphQLServer } from '../graphql/yoga';
import type { Logger } from '../logger';
import { describeError } from '../logger';
import { requireScope, resolveSession } from '../services/auth-service';
import { exportRequestPdf } from '../services/export-service';
import type { Deps } from '../services/records';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
};

/**
 * Headers sent with every response. The referrer policy matters most: signing
 * links carry their token in the URL, and "no-referrer" keeps that URL from
 * being sent to any other site.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const PDF_ROUTE = /^\/files\/([0-9a-f-]{36})\/requests\/([0-9a-f-]{36})\.pdf$/i;

function sendText(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function servePdf(
  deps: Deps,
  req: IncomingMessage,
  res: ServerResponse,
  workspaceId: string,
  requestId: string,
): Promise<void> {
  const token = readCookie(req.headers.cookie ?? null, SESSION_COOKIE);
  const user = token === null ? null : await resolveSession(deps, token);
  if (user === null) throw new AppError('UNAUTHENTICATED', 'Sign in to download this file.');
  const scope = await requireScope(deps, user.id, workspaceId, 'viewer');
  const file = await exportRequestPdf(deps, scope, requestId);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': file.bytes.byteLength,
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Cache-Control': 'private, no-store',
  });
  res.end(Buffer.from(file.bytes));
}

async function serveStatic(
  webRoot: string,
  pathname: string,
  res: ServerResponse,
): Promise<boolean> {
  const requested = path.normalize(path.join(webRoot, pathname));
  if (!requested.startsWith(webRoot)) return false;

  const hasExtension = path.extname(requested) !== '';
  const candidates = hasExtension ? [requested] : [path.join(webRoot, 'index.html')];
  for (const file of candidates) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

export function createHttpServer(options: {
  deps: Deps;
  logger: Logger;
  webRoot: string;
  secureCookies: boolean;
  graphiql: boolean;
}): Server {
  const { deps, logger } = options;
  const webRoot = path.resolve(options.webRoot);
  const yoga = createGraphQLServer(options);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    if (url.pathname === '/graphql') {
      await yoga(req, res);
      return;
    }
    if (url.pathname === '/healthz') {
      sendText(res, 200, 'ok');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }
    const pdf = PDF_ROUTE.exec(url.pathname);
    if (pdf?.[1] && pdf[2]) {
      await servePdf(deps, req, res, pdf[1], pdf[2]);
      return;
    }
    if (!(await serveStatic(webRoot, decodeURIComponent(url.pathname), res))) {
      sendText(res, 404, 'Not found');
    }
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof AppError) {
        sendText(res, STATUS_BY_CODE[error.code] ?? 400, error.message);
        return;
      }
      logger.error('Unhandled error in the HTTP server', {
        path: req.url,
        ...describeError(error),
      });
      if (!res.headersSent) sendText(res, 500, 'Something went wrong on our side.');
      else res.end();
    });
  });
}
