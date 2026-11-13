// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://trumpstoadies.com',
  base: process.env.BASE_URL ?? '/toadies',
});
