// Yönetim uygulaması girişi: GitHub'a yönlendirir (iPhone ana ekran uygulamasında da çalışan, açılır pencere kullanmayan akış).
import crypto from 'node:crypto';

export default async () => {
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id) return new Response('Giriş ayarı eksik (GITHUB_CLIENT_ID).', { status: 500 });
  const state = crypto.randomBytes(16).toString('hex');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', id);
  url.searchParams.set('scope', process.env.GITHUB_SCOPE || 'public_repo');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `yonetim_state=${state}; Path=/.netlify/functions/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
};

