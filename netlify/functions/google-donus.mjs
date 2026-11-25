// Google bağlantısının dönüşü: kodu yenileme anahtarına çevirir, yalnızca info@ (istanbulprintlab.com) hesabıysa şifreli saklar.
import { cerezOku } from '../lib/ortak.mjs';
import { istemci, sifrele, ayarDepo, BILDIRIM_ADRESI } from '../lib/google.mjs';

const git = (yer) => new Response(null, { status: 302, headers: { Location: yer, 'Cache-Control': 'no-store', 'Set-Cookie': 'google_state=; Path=/.netlify/functions/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });

export default async (req) => {
  const url = new URL(req.url), i = istemci();
  const state = url.searchParams.get('state'), kod = url.searchParams.get('code');
  if (!i || !state || !kod || state !== cerezOku(req, 'google_state')) return git('/yonetim/talepler/?google=hata');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: kod, client_id: i.id, client_secret: i.gizli, redirect_uri: url.origin + '/.netlify/functions/google-donus', grant_type: 'authorization_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.refresh_token || !j.id_token) return git('/yonetim/talepler/?google=hata');
  // Kimlik belirteci doğrudan Google'ın anahtar sunucusundan (TLS) geldiği için içeriği okunabilir.
  let e;
  try { e = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString('utf8')); } catch (_) { return git('/yonetim/talepler/?google=hata'); }
  if (!e.email_verified || String(e.email).toLowerCase() !== BILDIRIM_ADRESI.toLowerCase()) return git('/yonetim/talepler/?google=yanlis-hesap');
  await ayarDepo().setJSON('google', { r: sifrele(j.refresh_token), hesap: e.email, zaman: new Date().toISOString() });
  return git('/yonetim/talepler/?google=tamam');
};
