// info@istanbulprintlab.com Google hesabına bağlantı: sipariş dosyaları Drive'a yüklenir, bildirim maili Gmail'den gider.
// Yetki dar tutulur: drive.file (yalnızca bu sistemin oluşturduğu klasör ve dosyalar; Drive'ın geri kalanını göremez) + gmail.send (yalnızca gönderme).
// Yenileme anahtarı (refresh token) Netlify Blobs'ta şifreli durur; tarayıcıya hiç verilmez.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const KAPSAM = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send';
export const BILDIRIM_ADRESI = process.env.TALEP_BILDIRIM_ADRESI || 'info@istanbulprintlab.com';
const KLASOR_ADI = 'Site sipariş talepleri';

let bellek = null; // yalnızca yerel testlerde
export const ayarDepo = () => {
  if (process.env.IPL_TEST_BELLEK === '1') {
    bellek = bellek || new Map();
    return { get: async (k) => (bellek.has(k) ? JSON.parse(bellek.get(k)) : null), setJSON: async (k, v) => { bellek.set(k, JSON.stringify(v)); } };
  }
  return getStore({ name: 'ayarlar', consistency: 'strong' });
};

export const istemci = () => {
  const id = process.env.GOOGLE_CLIENT_ID, gizli = process.env.GOOGLE_CLIENT_SECRET;
  return id && gizli ? { id, gizli } : null;
};
function anahtar() {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error('GOOGLE_CLIENT_SECRET eksik');
  return crypto.createHash('sha256').update('ipl-google-yenileme:' + s).digest();
}
export function sifrele(metin) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', anahtar(), iv);
  const g = Buffer.concat([c.update(metin, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), g]).toString('base64url');
}
function coz(deger) {
  const b = Buffer.from(deger, 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', anahtar(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// Bağlantı durumu: yönetim sayfasında "bağlı mı" göstermek için
export async function baglantiDurumu() {
  if (!istemci()) return { bagli: false, neden: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET Netlify ayarlarına girilmemiş.' };
  const k = await ayarDepo().get('google', { type: 'json' });
  return k && k.r ? { bagli: true, hesap: k.hesap || BILDIRIM_ADRESI, zaman: k.zaman } : { bagli: false, neden: 'Google hesabı henüz bağlanmadı.' };
}

let onbellek = null; // { t, bitis } — aynı fonksiyon örneğinde tekrar tekrar anahtar istememek için
export async function erisim() {
  if (onbellek && onbellek.bitis > Date.now() + 60e3) return onbellek.t;
  const i = istemci();
  if (!i) throw new Error('Google bağlantı ayarları eksik');
  const k = await ayarDepo().get('google', { type: 'json' });
  if (!k || !k.r) throw new Error('Google hesabı bağlı değil');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: i.id, client_secret: i.gizli, refresh_token: coz(k.r), grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(SURE),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('Google erişim anahtarı alınamadı: ' + (j.error || r.status));
  onbellek = { t: j.access_token, bitis: Date.now() + (j.expires_in || 3000) * 1000 };
  return j.access_token;
}

const SURE = 8000; // her Google çağrısı en fazla 8 sn (müşteri beklemesin)
async function g(url, secenek = {}) {
  const t = await erisim();
  return fetch(url, { ...secenek, headers: { Authorization: 'Bearer ' + t, ...(secenek.headers || {}) }, signal: AbortSignal.timeout(SURE) });
}

// Talep dosyalarının klasörü: ilk kullanımda oluşturulur, kimliği saklanır. Silinmişse yeniden oluşturulur.
async function klasor() {
  const d = ayarDepo(), k = await d.get('drive-klasor', { type: 'json' });
  if (k && k.id) {
    const r = await g('https://www.googleapis.com/drive/v3/files/' + k.id + '?fields=id,trashed');
    const j = r.ok ? await r.json() : null;
    if (j && j.id && !j.trashed) return k.id;
  }
  const r = await g('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: KLASOR_ADI, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.id) throw new Error('Drive klasörü oluşturulamadı (' + r.status + ')');
  await d.setJSON('drive-klasor', { id: j.id });
  return j.id;
}

// Tarayıcının dosyayı doğrudan Google Drive'a yükleyeceği, kesintiden devam edebilen yükleme oturumu açar.
// Origin başlığı verildiği için Google bu oturum adresine yalnızca sitemizden gelen yüklemelerde izin verir (CORS).
export async function yuklemeOturumu({ ad, boyut, tur, aciklama, origin }) {
  const klasorId = await klasor();
  const r = await g('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': tur || 'application/octet-stream',
      'X-Upload-Content-Length': String(boyut),
      Origin: origin,
    },
    body: JSON.stringify({ name: ad, parents: [klasorId], description: aciklama || '' }),
  });
  const adres = r.headers.get('location');
  if (!r.ok || !adres) throw new Error('Yükleme oturumu açılamadı (' + r.status + ')');
  return { adres, klasorId };
}

// Yükleme oturumunun durumu (tarayıcı Range başlığını okuyamazsa sunucu sorar; sunucuda CORS kısıtı yok).
// Dönüş: { bitti, id } | { sonraki: bayt } | { gecersiz: true } (oturumun süresi dolmuş, 1 hafta)
export async function oturumDurumu(adres, toplam) {
  if (!/^https:\/\/www\.googleapis\.com\/upload\/drive\//.test(String(adres || '')) && process.env.IPL_TEST_BELLEK !== '1') return { gecersiz: true };
  const r = await fetch(adres, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + toplam, 'Content-Length': '0' }, signal: AbortSignal.timeout(SURE) });
  if (r.status === 200 || r.status === 201) { const j = await r.json().catch(() => ({})); return { bitti: true, id: j.id }; }
  if (r.status === 308) { const m = /bytes=0-(\d+)/.exec(r.headers.get('range') || ''); return { sonraki: m ? parseInt(m[1], 10) + 1 : 0 }; }
  if (r.status === 404 || r.status === 410) return { gecersiz: true };
  throw new Error('Yükleme durumu alınamadı (' + r.status + ')');
}

// Yüklenen dosyanın gerçekten bizim klasörümüzde ve bu talebe ait olduğunu doğrular.
export async function dosyaBilgisi(id) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(id || ''))) return null;
  const r = await g('https://www.googleapis.com/drive/v3/files/' + id + '?fields=id,name,size,parents,webViewLink,trashed');
  if (!r.ok) return null;
  return r.json();
}

// Gmail ile düz metin bildirim maili (Türkçe karakterler için UTF-8, konu RFC 2047 ile kodlanır)
export async function mailGonder({ konu, metin, kime = BILDIRIM_ADRESI }) {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const ham = [
    'From: IstanbulPrintLab Site <' + BILDIRIM_ADRESI + '>',
    'To: ' + kime,
    'Subject: =?UTF-8?B?' + b64(konu) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(metin).replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
  const r = await g('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(ham, 'utf8').toString('base64url') }),
  });
  if (!r.ok) throw new Error('Mail gönderilemedi (' + r.status + ')');
  return true;
}
