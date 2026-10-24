import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function versionPublicConfiguration() {
  let source;
  let filename;
  return {
    name: 'version-public-configuration',
    apply: 'build',
    configResolved(config) {
      source = readFileSync(resolve(config.publicDir, 'platform-config.js'), 'utf8');
      filename = `platform-config.${createHash('sha256').update(source).digest('hex').slice(0, 16)}.js`;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // A new public connection gets a new URL rather than reusing a cached
        // empty config. The synchronous script still runs before the app module.
        return html.replace('platform-config.js', filename);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: filename, source });
    },
  };
}

export default defineConfig({ plugins: [react(), versionPublicConfiguration()], server: { host: '0.0.0.0', port: 5173 } });
