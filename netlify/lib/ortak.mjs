// Yönetim uygulamasının ortak ayarları. GitHub anahtarı tarayıcıya hiç verilmez: çerezde yalnızca sunucunun
// şifrelediği hali (AES-256-GCM) durur; çalınsa bile GitHub'da doğrudan kullanılamaz, yalnızca bu dar aracıdan geçer.
import crypto from 'node:crypto';

export const REPO = 'karanerdogan34/istanbulprintlab-site';
export const SAHIP_ID = String(process.env.YONETIM_SAHIBI_ID || '357687771'); // GitHub'ın değişmeyen sayısal kullanıcı numarası
export const OTURUM = 'yonetim_oturum';
export const CEREZ_YOLU = '/.netlify/functions/';
const GUN = 30;

function anahtar() {
  const s = process.env.GITHUB_CLIENT_SECRET;
  if (!s) throw new Error('Sunucu ayarı eksik');
  return crypto.createHash('sha256').update('ipl-yonetim-oturum:' + s).digest();
}
// oturum: { t: erişim anahtarı, r: yenileme anahtarı, te: anahtarın bitişi (ms), s: oturumun bitişi (ms) }
export function sifrele(oturum) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', anahtar(), iv);
  const govde = Buffer.concat([c.update(JSON.stringify(oturum), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), govde]).toString('base64url');
}
export function coz(deger) {
  try {
    const b = Buffer.from(deger, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', anahtar(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const j = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return j && j.t && j.s > Date.now() ? j : null;
  } catch (_) { return null; }
}
export function cerezOku(req, ad) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + ad + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
// GitHub'ın anahtar yanıtından oturum kurar. Erişim anahtarı ~8 saatte biter; yenileme anahtarıyla sessizce tazelenir.
export function oturumKur(j, eski) {
  const simdi = Date.now();
  const s = eski ? eski.s : simdi + GUN * 86400e3;
  const rBitis = j.refresh_token_expires_in ? simdi + j.refresh_token_expires_in * 1000 : s;
  return { t: j.access_token, r: j.refresh_token || null, te: j.expires_in ? simdi + j.expires_in * 1000 : null, s: Math.min(s, rBitis) };
}
export function oturumCerezi(oturum) {
  const kalan = Math.max(60, Math.floor((oturum.s - Date.now()) / 1000));
  return `${OTURUM}=${sifrele(oturum)}; Path=${CEREZ_YOLU}; HttpOnly; Secure; SameSite=Strict; Max-Age=${kalan}`;
}
export async function yenile(oturum) {
  if (!oturum.r) return null;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: oturum.r }),
    });
    const j = await r.json();
    return j.access_token ? oturumKur(j, oturum) : null;
  } catch (_) { return null; }
}
export const oturumSil = `${OTURUM}=; Path=${CEREZ_YOLU}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function json(veri, durum = 200, ek = {}) {
  return new Response(JSON.stringify(veri), { status: durum, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...ek } });
}
