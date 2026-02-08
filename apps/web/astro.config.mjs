import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import sentry from '@sentry/astro';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://skyplanner.no',
  output: 'server',
  adapter: vercel(),
  integrations: [
    tailwind({
      applyBaseStyles: false
    }),
    sitemap({
      filter: (page) =>
        !page.includes('/auth/') &&
        !page.includes('/dashboard/') &&
        !page.includes('/api/')
    }),
    ...(process.env.PUBLIC_SENTRY_DSN ? [sentry({
      dsn: process.env.PUBLIC_SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || 'development',
      tracesSampleRate: 0.1,
    })] : []),
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
    },
    server: {
      proxy: {
        '/api/app': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/app/, '/api')
        }
      }
    }
  }
});
