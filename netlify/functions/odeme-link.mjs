// Yönetim: onaylanmış bir sipariş için müşteriye gönderilecek ödeme bağlantısı üretir (POST) ya da bir bağlantıyı iptal eder (DELETE).
// Yalnızca yönetim uygulamasına giriş yapmış hesap kullanabilir (aynı oturum çerezi, aynı Origin ve özel başlık denetimi).
import crypto from 'node:crypto';
import { OTURUM, cerezOku, coz, json } from '../lib/ortak.mjs';
import { ayarlar, linkImzala, SITE } from '../lib/paytr.mjs';
import { linkOku, linkYaz } from '../lib/kayit.mjs';

const GUN = 86400e3;

export default async (req) => {
  const kaynak = req.headers.get('origin');
  const ayniSite = kaynak && kaynak === new URL(req.url).origin;
  if (!['POST', 'DELETE'].includes(req.method) || !ayniSite || req.headers.get('x-yonetim') !== '1' || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  const cerez = cerezOku(req, OTURUM);
  if (!cerez || !coz(cerez)) return json({ message: 'Önce yönetim uygulamasına giriş yapın.' }, 401);
  const a = ayarlar();
  if (!a) return json({ message: 'PayTR anahtarları Netlify ayarlarına henüz girilmemiş.' }, 500);

  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }

  if (req.method === 'DELETE') {
    const id = String(g.id || '');
    const k = /^[a-f0-9]{24}$/.test(id) && await linkOku(id);
    if (!k) return json({ message: 'Bağlantı bulunamadı.' }, 404);
    if (k.durum === 'odendi') return json({ message: 'Bu bağlantının ödemesi alınmış, iptal edilemez.' }, 409);
    await linkYaz(id, { ...k, durum: 'iptal', iptal: new Date().toISOString() });
    return json({ tamam: true });
  }

  const no = String(g.siparisNo || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  const aciklama = String(g.aciklama || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const tl = Number(String(g.tutar || '').replace(/\./g, '').replace(',', '.'));
  const maxTaksit = [1, 3, 6, 9, 12].includes(parseInt(g.maxTaksit, 10)) ? parseInt(g.maxTaksit, 10) : 12;
  const gun = Math.max(1, Math.min(30, parseInt(g.gun, 10) || 7));
  if (!no) return json({ message: 'Sipariş numarası gerekli.' }, 400);
  if (!aciklama) return json({ message: 'Açıklama gerekli.' }, 400);
  if (!Number.isFinite(tl) || tl < 1 || tl > 1000000) return json({ message: 'Tutar 1 TL ile 1.000.000 TL arasında olmalı.' }, 400);

  const id = crypto.randomBytes(12).toString('hex');
  const veri = { i: id, n: no, a: aciklama, k: Math.round(tl * 100), t: maxTaksit, b: Date.now() + gun * GUN };
  await linkYaz(id, { ...veri, durum: 'bekliyor', olusturma: new Date().toISOString(), test: a.test === '1' });
  return json({ id, link: SITE + '/odeme/?l=' + linkImzala(a, veri), gecerlilik: new Date(veri.b).toISOString(), test: a.test === '1' });
};
