// Yönetim: info@istanbulprintlab.com Google hesabını bir kez bağlar (Drive'a dosya yükleme + bildirim maili için).
// Yalnızca yönetim uygulamasına giriş yapmış hesap başlatabilir; Google'a yönlendirir, dönüş google-donus fonksiyonundadır.
import crypto from 'node:crypto';
import { OTURUM, cerezOku, coz } from '../lib/ortak.mjs';
import { istemci, KAPSAM, BILDIRIM_ADRESI } from '../lib/google.mjs';

export default async (req) => {
  const cerez = cerezOku(req, OTURUM);
  if (!cerez || !coz(cerez)) return new Response(null, { status: 302, headers: { Location: '/yonetim/', 'Cache-Control': 'no-store' } });
  const i = istemci();
  if (!i) return new Response('Google bağlantı ayarları eksik: Netlify ortam değişkenlerine GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET girilmeli.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const state = crypto.randomBytes(16).toString('hex');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', i.id);
  u.searchParams.set('redirect_uri', new URL(req.url).origin + '/.netlify/functions/google-donus');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email ' + KAPSAM);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('login_hint', BILDIRIM_ADRESI);
  u.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: u.toString(),
      'Set-Cookie': `google_state=${state}; Path=/.netlify/functions/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
};
