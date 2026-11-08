import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../../src/server/http/server';
import { createLogger } from '../../src/server/logger';
import { submitSignature } from '../../src/server/services/signing-service';
import { memberAnswers, twoPartyRequest } from '../helpers/builders';
import type { OpenRequest } from '../helpers/builders';
import { drawn } from '../helpers/fixtures';
import { PASSWORD, createHarness, seedWorld } from '../helpers/harness';
import type { Harness, World } from '../helpers/harness';

describe('HTTP server', () => {
  let harness: Harness;
  let world: World;
  let server: Server;
  let base: string;
  let webRoot: string;
  let request: OpenRequest;
  const logLines: string[] = [];

  const signIn = async (email: string): Promise<string> => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation ($e: String!, $p: String!) { login(email: $e, password: $p) { id } }',
        variables: { e: email, p: PASSWORD },
      }),
    });
    return response.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  };

  beforeAll(async () => {
    harness = await createHarness();
    world = await seedWorld(harness.deps);
    request = await twoPartyRequest(harness.deps, world.alpha.owner, 'Bench sign-off: Zoë & 山田');
    await submitSignature(
      harness.deps,
      request.memberToken,
      { answers: memberAnswers, signature: drawn },
      'test',
    );

    await mkdir('test-results', { recursive: true });
    webRoot = await mkdtemp(path.join('test-results', 'web-'));
    await mkdir(path.join(webRoot, 'assets'));
    await writeFile(
      path.join(webRoot, 'index.html'),
      '<!doctype html><title>Signoff Ledger</title>',
    );
    await writeFile(path.join(webRoot, 'assets', 'app.js'), 'export {};');

    server = createHttpServer({
      deps: harness.deps,
      logger: createLogger('debug', (line) => logLines.push(line)),
      webRoot,
      secureCookies: false,
      graphiql: false,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(webRoot, { recursive: true, force: true });
    await harness.close();
  });

  it('answers the health check and sends security headers on every response', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('serves the app shell for page routes and hashed assets with long caching', async () => {
    const page = await fetch(`${base}/sign/some-token`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');

    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');

    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('does not serve files outside the web root', async () => {
    const response = await fetch(`${base}/..%2f..%2fpackage.json`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('signoff_ledger');
  });

  it('rejects methods other than GET outside the API', async () => {
    expect((await fetch(`${base}/healthz/x`, { method: 'POST' })).status).toBe(405);
  });

  it('sets the session cookie over real HTTP', async () => {
    expect(await signIn('owner@alpha.example')).toMatch(/^signoff_ledger_session=/);
  });

  describe('PDF download', () => {
    const pdfUrl = () => `${base}/files/${world.alpha.id}/requests/${request.request.id}.pdf`;

    it('requires a sign-in', async () => {
      const response = await fetch(pdfUrl());
      expect(response.status).toBe(401);
    });

    it('returns a real, parseable PDF to a member, even with non-Latin text', async () => {
      const cookie = await signIn('viewer@alpha.example');
      const response = await fetch(pdfUrl(), { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="bench-sign-off-zo.pdf"',
      );
      expect(response.headers.get('cache-control')).toBe('private, no-store');

      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const document = await PDFDocument.load(bytes);
      expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
      expect(document.getTitle()).toBe('Bench sign-off: Zoë & 山田');
    });

    it("answers 404 for a member of another workspace, and for another workspace's request", async () => {
      const outsider = await signIn('owner@beta.example');
      expect((await fetch(pdfUrl(), { headers: { cookie: outsider } })).status).toBe(404);

      const insider = await signIn('owner@alpha.example');
      const crossed = `${base}/files/${world.alpha.id}/requests/00000000-0000-4000-8000-000000000000.pdf`;
      expect((await fetch(crossed, { headers: { cookie: insider } })).status).toBe(404);
    });
  });

  it('never logs at error level for expected failures', () => {
    expect(logLines.filter((line) => line.includes('"level":"error"'))).toEqual([]);
  });
});
