#!/usr/bin/env node
// Restores the previously published Pierce assessor extract from the live site so that a
// failed weekly rebuild does not remove last week's data from the deployment.
// Usage: node scripts/fetch-published-extract.mjs --out site/data/assessor/pierce [--base URL]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_BASE } from '../js/config.js';

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function main(argv = process.argv.slice(2)) {
  let out = 'data/assessor/pierce';
  let base = SITE_BASE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--base') base = argv[++i];
  }
  const rel = 'data/assessor/pierce/';
  const manifestText = await get(new URL(`${rel}manifest.json`, base));
  const manifest = JSON.parse(manifestText);
  await mkdir(path.join(out, 'shards'), { recursive: true });
  await writeFile(path.join(out, 'manifest.json'), manifestText);
  const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
  let done = 0;
  let failed = 0;
  const queue = [...shards];
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (queue.length) {
      const prefix = queue.shift();
      try {
        await writeFile(path.join(out, 'shards', `${prefix}.json`), await get(new URL(`${rel}shards/${prefix}.json`, base)));
        done += 1;
      } catch (err) {
        failed += 1;
        console.warn(`  shard ${prefix}: ${err.message}`);
      }
    }
  }));
  try {
    await writeFile(path.join(out, 'multicare.json'), await get(new URL(`${rel}multicare.json`, base)));
  } catch { /* optional */ }
  console.log(`Restored the published extract (generated ${manifest.generated || 'unknown'}, ${done} of ${shards.length} shards${failed ? `, ${failed} failed` : ''}) into ${out}`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
