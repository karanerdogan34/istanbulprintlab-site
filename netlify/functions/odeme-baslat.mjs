// Müşteri ödeme sayfası: imzalı bağlantıyı doğrular, bağlantı bilgisini gösterir (GET) veya PayTR iFrame belirteci alır (POST).
// Tutar her zaman imzalı bağlantıdan gelir; tarayıcının gönderdiği tutara hiç bakılmaz.
import crypto from 'node:crypto';
import { json } from '../lib/ortak.mjs';
import { ayarlar, linkCoz, iframeBelirteci } from '../lib/paytr.mjs';

const temiz = (s, n) => String(s || '').replace(/[<>\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export default async (req) => {
  const a = ayarlar();
  if (!a) return json({ message: 'Online ödeme şu an kullanılamıyor. Lütfen WhatsApp\'tan bize yazın.' }, 503);
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const v = linkCoz(a, url.searchParams.get('l'));
    if (!v) return json({ message: 'Bu ödeme bağlantısı geçersiz veya süresi dolmuş. Lütfen bizden yeni bağlantı isteyin.' }, 404);
    return json({ siparisNo: v.n, aciklama: v.a, kurus: v.k, maxTaksit: v.t, test: a.test === '1' });
  }

  const kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const v = linkCoz(a, g.l);
  if (!v) return json({ message: 'Bu ödeme bağlantısı geçersiz veya süresi dolmuş. Lütfen bizden yeni bağlantı isteyin.' }, 404);

  const ad = temiz(g.ad, 60), eposta = temiz(g.eposta, 100), telefon = temiz(g.telefon, 20).replace(/[^0-9+ ]/g, ''), adres = temiz(g.adres, 400);
  if (ad.length < 3) return json({ message: 'Ad soyad yazın.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return json({ message: 'Geçerli bir e-posta adresi yazın.' }, 400);
  if (telefon.replace(/\D/g, '').length < 10) return json({ message: 'Telefon numaranızı yazın.' }, 400);
  if (adres.length < 10) return json({ message: 'Fatura / teslimat adresinizi yazın.' }, 400);
  if (!g.sozlesme) return json({ message: 'Ön bilgilendirme formunu ve mesafeli satış sözleşmesini onaylayın.' }, 400);

  const ip = (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (!ip) return json({ message: 'Bağlantı bilgisi alınamadı, lütfen tekrar deneyin.' }, 400);
  // PayTR sipariş numarası yalnız harf ve rakam içerir ve her denemede benzersizdir.
  const oid = ('IPL' + v.n.replace(/^IPL-?/, '').replace(/[^A-Z0-9]/g, '') + 'T' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')).toUpperCase().slice(0, 64);
  const sonuc = await iframeBelirteci(a, {
    ip, oid, eposta, kurus: v.k, ad, adres, telefon,
    sepet: [[('Sipariş ' + v.n + ' - ' + v.a).slice(0, 120), (v.k / 100).toFixed(2), 1]],
    taksitYok: v.t === 1, maxTaksit: v.t > 1 ? v.t : 0,
  });
  if (sonuc.hata) {
    console.error('PayTR get-token hatası:', sonuc.hata);
    return json({ message: 'Ödeme sayfası açılamadı. Lütfen biraz sonra tekrar deneyin ya da WhatsApp\'tan bize yazın.' }, 502);
  }
  return json({ token: sonuc.token });
};
