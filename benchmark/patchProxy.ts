// Local caching proxy for upstream patch downloads. The diff route of every
// built version is rewritten (see versions.ts) to fetch its patch through
// this proxy, so a given patch is downloaded from the real upstream exactly
// once and every subsequent run — any version, any pass — streams it from
// local disk. This removes network time and variance from the runs.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const PATCH_PROXY_PORT = Number(process.env.PATCH_PROXY_PORT ?? 4601);

export function startPatchProxy(log: (line: string) => void): void {
  const cacheDir = join(
    process.env.DATA_DIR ?? join(import.meta.dir, 'data'),
    'patches'
  );
  mkdirSync(cacheDir, { recursive: true });
  // Concurrent requests for the same uncached patch share one download
  const downloads = new Map<string, Promise<string>>();

  async function ensureCached(url: string): Promise<string> {
    const cachePath = join(
      cacheDir,
      createHash('sha256').update(url).digest('hex')
    );
    if (existsSync(cachePath)) {
      return cachePath;
    }
    let pending = downloads.get(cachePath);
    if (pending == null) {
      pending = download(url, cachePath).finally(() => {
        downloads.delete(cachePath);
      });
      downloads.set(cachePath, pending);
    }
    return pending;
  }

  async function download(url: string, cachePath: string): Promise<string> {
    log(`patch cache miss — downloading ${url} once`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || response.body == null) {
      throw new Error(`upstream returned ${response.status} for ${url}`);
    }
    const temporaryPath = `${cachePath}.partial`;
    const writer = Bun.file(temporaryPath).writer();
    let received = 0;
    let lastLogged = 0;
    for await (const chunk of response.body) {
      void writer.write(chunk);
      received += chunk.byteLength;
      if (received - lastLogged >= 128 * 1024 * 1024) {
        lastLogged = received;
        log(`  patch download: ${Math.round(received / 1024 / 1024)}MB…`);
      }
    }
    await writer.end();
    renameSync(temporaryPath, cachePath);
    log(`patch cached (${Math.round(received / 1024 / 1024)}MB)`);
    return cachePath;
  }

  Bun.serve({
    port: PATCH_PROXY_PORT,
    hostname: '127.0.0.1',
    idleTimeout: 0,
    async fetch(request) {
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname !== '/proxy') {
        return new Response('not found', { status: 404 });
      }
      const upstream = requestUrl.searchParams.get('url');
      if (upstream == null || !upstream.startsWith('https://')) {
        return new Response('bad url', { status: 400 });
      }
      try {
        const cachePath = await ensureCached(upstream);
        return new Response(Bun.file(cachePath), {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      } catch (error) {
        return new Response(
          error instanceof Error ? error.message : String(error),
          { status: 502 }
        );
      }
    },
  });
  console.log(`patch cache proxy on 127.0.0.1:${PATCH_PROXY_PORT}`);
}
