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
export function sifrele(token) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', anahtar(), iv);
  const govde = Buffer.concat([c.update(JSON.stringify({ t: token, s: Date.now() + GUN * 86400e3 }), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), govde]).toString('base64url');
}
export function coz(deger) {
  try {
    const b = Buffer.from(deger, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', anahtar(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const j = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return j.s > Date.now() ? j.t : null;
  } catch (_) { return null; }
}
export function cerezOku(req, ad) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + ad + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
export function oturumCerezi(token) {
  return `${OTURUM}=${sifrele(token)}; Path=${CEREZ_YOLU}; HttpOnly; Secure; SameSite=Strict; Max-Age=${GUN * 86400}`;
}
export const oturumSil = `${OTURUM}=; Path=${CEREZ_YOLU}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function json(veri, durum = 200, ek = {}) {
  return new Response(JSON.stringify(veri), { status: durum, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...ek } });
}
