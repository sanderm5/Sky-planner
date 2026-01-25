import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [
    tailwind({
      applyBaseStyles: false
    })
  ],
  server: {
    port: 3001
  },
  vite: {
    optimizeDeps: {
      include: ['@skyplanner/database', '@skyplanner/auth', 'bcryptjs', 'stripe']
    },
    ssr: {
      noExternal: ['@skyplanner/database', '@skyplanner/auth']
    }
  }
});
