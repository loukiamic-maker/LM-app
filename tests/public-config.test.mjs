import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicKey, validatePublicConfiguration } from '../scripts/validate-public-config.mjs';
const jwt = role => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({role})).toString('base64url')}.fixture`;
test('publishable and legacy anonymous keys may be used by the public website', () => {
  assert.doesNotThrow(() => assertPublicKey('sb_publishable_fixture'));
  assert.doesNotThrow(() => assertPublicKey(jwt('anon')));
});
test('build rejects privileged keys in public runtime config and build variables', () => {
  assert.throws(() => validatePublicConfiguration('window.MERAKI_CONFIG={key:"sb_secret_fixture"}'));
  assert.throws(() => validatePublicConfiguration(`window.MERAKI_CONFIG={key:"${jwt('service_role')}"}`));
  assert.throws(() => validatePublicConfiguration('', { VITE_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }));
});
test('database connection strings and URLs containing passwords cannot be published', () => {
  assert.throws(() => validatePublicConfiguration('window.MERAKI_CONFIG={supabaseUrl:"postgresql://user:fixture@localhost/db"}'));
  assert.throws(() => validatePublicConfiguration('', {VITE_SUPABASE_URL:'https://user:fixture@example.supabase.co'}));
  assert.doesNotThrow(() => validatePublicConfiguration('', {VITE_SUPABASE_URL:'https://example.supabase.co'}));
});
