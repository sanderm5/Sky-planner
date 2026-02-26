import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@skyplanner/database', '@skyplanner/auth', '@skyplanner/theme'],
  serverExternalPackages: ['bcryptjs'],

  // Avoid EMFILE errors on macOS by limiting watched directories
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
      };
    }
    return config;
  },

  async rewrites() {
    // Dev proxy: /api/app/* → backend on localhost:3000
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/api/app/:path*',
          destination: 'http://localhost:3000/api/:path*',
        },
      ];
    }
    return [];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/**',
      },
    ],
  },
};

export default nextConfig;
