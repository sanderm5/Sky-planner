import * as auth from '@skyplanner/auth';

const isProduction = process.env.NODE_ENV === 'production';

export async function GET() {
  const clearCookieHeader = auth.buildClearCookieHeader(isProduction);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/auth/login',
      'Set-Cookie': clearCookieHeader,
    },
  });
}

export async function POST() {
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
}
