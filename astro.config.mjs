// @ts-check
import { defineConfig } from 'astro/config';

import { execFileSync } from 'node:child_process';

import node from '@astrojs/node';

import tailwindcss from '@tailwindcss/vite';

import icon from 'astro-icon';

// Last commit, baked in at build time since the deployed bundle has no .git.
function lastCommit() {
  try {
    const [hash, subject = ''] = execFileSync('git', ['log', '-1', '--format=%h%n%s'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n');
    return hash ? { hash, subject } : null;
  } catch {
    return null;
  }
}

// https://astro.build/config
export default defineConfig({
  site: 'https://braxton.is',
  output: 'server',

  adapter: node({
    mode: 'standalone'
  }),

  integrations: [icon()],

  vite: {
    define: { __LAST_COMMIT__: JSON.stringify(lastCommit()) },
    plugins: [tailwindcss()]
  }
});