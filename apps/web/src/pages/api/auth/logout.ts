import type { APIRoute } from 'astro';
import * as auth from '@skyplanner/auth';

const isProduction = import.meta.env.PROD;

export const GET: APIRoute = async () => {
  const clearCookieHeader = auth.buildClearCookieHeader(isProduction);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/auth/login',
      'Set-Cookie': clearCookieHeader,
    },
  });
};

export const POST: APIRoute = async () => {
  const clearCookieHeader = auth.buildClearCookieHeader(isProduction);

  return new Response(
    JSON.stringify({ success: true, message: 'Logget ut' }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearCookieHeader,
      },
    }
  );
};
