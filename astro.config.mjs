// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';

import tailwindcss from '@tailwindcss/vite';

import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  site: 'https://braxton.is',
  output: 'server',

  adapter: node({
    mode: 'standalone'
  }),

  integrations: [icon()],

  vite: {
    plugins: [tailwindcss()]
  }
});