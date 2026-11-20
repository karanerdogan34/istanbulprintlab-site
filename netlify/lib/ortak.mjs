// Yönetim uygulamasının ortak ayarları. GitHub anahtarı yalnızca sunucu tarafında, HttpOnly çerezde durur; tarayıcı JavaScript'i göremez.
export const REPO = 'karanerdogan34/istanbulprintlab-site';
export const SAHIP_ID = String(process.env.YONETIM_SAHIBI_ID || '357687771'); // GitHub'ın değişmeyen sayısal kullanıcı numarası
export const OTURUM = 'yonetim_oturum';
export const CEREZ_YOLU = '/.netlify/functions/';

export function cerezOku(req, ad) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + ad + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
export function oturumCerezi(anahtar, gun = 30) {
  return `${OTURUM}=${encodeURIComponent(anahtar)}; Path=${CEREZ_YOLU}; HttpOnly; Secure; SameSite=Strict; Max-Age=${gun * 86400}`;
}
export const oturumSil = `${OTURUM}=; Path=${CEREZ_YOLU}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function json(veri, durum = 200, ek = {}) {
  return new Response(JSON.stringify(veri), { status: durum, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...ek } });
}
