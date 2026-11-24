// PayTR iFrame API ortak yardımcıları.
// Gizli anahtarlar yalnızca Netlify ortam değişkenlerinde durur (PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT); koda ve tarayıcıya hiç girmez.
import crypto from 'node:crypto';

export const MAGAZA_NO = String(process.env.PAYTR_MERCHANT_ID || '780487');
export const SITE = 'https://www.istanbulprintlab.com';

export function ayarlar() {
  const key = process.env.PAYTR_MERCHANT_KEY;
  const salt = process.env.PAYTR_MERCHANT_SALT;
  if (!key || !salt) return null;
  // Canlıya geçene kadar test modunda kalır; yalnızca PAYTR_TEST_MODE=0 yazılınca gerçek tahsilat yapılır.
  const test = process.env.PAYTR_TEST_MODE === '0' ? '0' : '1';
  return { id: MAGAZA_NO, key, salt, test };
}

const b64hmac = (anahtar, metin) => crypto.createHmac('sha256', anahtar).update(metin, 'utf8').digest('base64');

// ---- Ödeme bağlantısı (yönetimden üretilir, müşteriye WhatsApp'tan gönderilir) ----
// Bağlantıda yalnızca sipariş no, tutar, açıklama, taksit sınırı ve son geçerlilik tarihi bulunur; imzalı olduğu için değiştirilemez.
function linkAnahtari(a) {
  return crypto.createHash('sha256').update('ipl-odeme-linki:' + a.key + ':' + a.salt).digest();
}
export function linkImzala(a, veri) {
  const govde = Buffer.from(JSON.stringify(veri), 'utf8').toString('base64url');
  const imza = crypto.createHmac('sha256', linkAnahtari(a)).update(govde).digest('base64url');
  return govde + '.' + imza;
}
export function linkCoz(a, belirtec) {
  const [govde, imza] = String(belirtec || '').split('.');
  if (!govde || !imza) return null;
  const beklenen = crypto.createHmac('sha256', linkAnahtari(a)).update(govde).digest('base64url');
  const x = Buffer.from(imza), y = Buffer.from(beklenen);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  try {
    const v = JSON.parse(Buffer.from(govde, 'base64url').toString('utf8'));
    return v && Number.isInteger(v.k) && v.k > 0 && v.b > Date.now() ? v : null;
  } catch (_) { return null; }
}

// ---- iFrame belirteci (get-token) ----
export async function iframeBelirteci(a, s) {
  const sepet = Buffer.from(JSON.stringify(s.sepet), 'utf8').toString('base64');
  const noTaksit = s.taksitYok ? '1' : '0';
  const maxTaksit = String(s.maxTaksit || 0);
  const para = 'TL';
  const hashStr = a.id + s.ip + s.oid + s.eposta + s.kurus + sepet + noTaksit + maxTaksit + para + a.test;
  const form = new URLSearchParams({
    merchant_id: a.id, user_ip: s.ip, merchant_oid: s.oid, email: s.eposta, payment_amount: String(s.kurus),
    paytr_token: b64hmac(a.key, hashStr + a.salt), user_basket: sepet, debug_on: '0',
    no_installment: noTaksit, max_installment: maxTaksit,
    user_name: s.ad, user_address: s.adres, user_phone: s.telefon,
    merchant_ok_url: SITE + '/odeme/basarili/', merchant_fail_url: SITE + '/odeme/hata/',
    timeout_limit: '30', currency: para, test_mode: a.test, lang: 'tr',
  });
  const r = await fetch('https://www.paytr.com/odeme/api/get-token', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  if (j.status === 'success' && j.token) return { token: j.token };
  return { hata: String(j.reason || 'PayTR yanıt vermedi') };
}

// ---- Bildirim (callback) doğrulaması ----
export function bildirimGecerli(a, p) {
  const beklenen = b64hmac(a.key, String(p.merchant_oid) + a.salt + String(p.status) + String(p.total_amount));
  const x = Buffer.from(String(p.hash || '')), y = Buffer.from(beklenen);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
