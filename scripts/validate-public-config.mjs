import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export function assertPublicKey(value) {
  if (!value) return;
  if (value.startsWith('sb_secret_')) throw new Error('A privileged Supabase key cannot be published. Use only a publishable/anon key.');
  if (value.split('.').length === 3) {
    let role;
    try { role = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role; } catch { throw new Error('Invalid Supabase public key.'); }
    if (role !== 'anon') throw new Error('Only an anon-role JWT may be included in public configuration.');
  } else if (!value.startsWith('sb_publishable_')) throw new Error('Use the Supabase publishable key in public configuration.');
}

export function validatePublicConfiguration(source, environment = {}) {
  for (const match of source.matchAll(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) assertPublicKey(match[0]);
  assertPublicKey(environment.VITE_SUPABASE_PUBLISHABLE_KEY || '');
  const runtimeUrl = source.match(/supabaseUrl\s*:\s*['"]([^'"]*)['"]/);
  for (const value of [runtimeUrl?.[1], environment.VITE_SUPABASE_URL].filter(Boolean)) {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(url.hostname) && url.protocol === 'http:'))) throw new Error('Use only the public HTTPS Supabase project URL, without credentials.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const build = loadEnv('production', process.cwd(), 'VITE_');
    validatePublicConfiguration(readFileSync('public/platform-config.js', 'utf8'), {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || build.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || build.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
    console.log('Public configuration check passed.');
  } catch (error) {
    console.error(error.message); // Never print key values or configuration contents.
    process.exitCode = 1;
  }
}
