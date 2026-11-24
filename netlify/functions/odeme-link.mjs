// Yönetim: onaylanmış bir sipariş için müşteriye gönderilecek imzalı ödeme bağlantısı üretir.
// Yalnızca yönetim uygulamasına giriş yapmış hesap kullanabilir (aynı oturum çerezi, aynı Origin ve özel başlık denetimi).
import { OTURUM, cerezOku, coz, json } from '../lib/ortak.mjs';
import { ayarlar, linkImzala, SITE } from '../lib/paytr.mjs';

const GUN = 86400e3;

export default async (req) => {
  const kaynak = req.headers.get('origin');
  const ayniSite = kaynak && kaynak === new URL(req.url).origin;
  if (req.method !== 'POST' || !ayniSite || req.headers.get('x-yonetim') !== '1' || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  const cerez = cerezOku(req, OTURUM);
  if (!cerez || !coz(cerez)) return json({ message: 'Önce yönetim uygulamasına giriş yapın.' }, 401);
  const a = ayarlar();
  if (!a) return json({ message: 'PayTR anahtarları Netlify ayarlarına henüz girilmemiş.' }, 500);

  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const no = String(g.siparisNo || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
  const aciklama = String(g.aciklama || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const tl = Number(String(g.tutar || '').replace(/\./g, '').replace(',', '.'));
  const maxTaksit = Math.max(0, Math.min(12, parseInt(g.maxTaksit, 10) || 0));
  const gun = Math.max(1, Math.min(30, parseInt(g.gun, 10) || 7));
  if (!no) return json({ message: 'Sipariş numarası gerekli.' }, 400);
  if (!aciklama) return json({ message: 'Açıklama gerekli.' }, 400);
  if (!Number.isFinite(tl) || tl < 1 || tl > 1000000) return json({ message: 'Tutar 1 TL ile 1.000.000 TL arasında olmalı.' }, 400);

  const veri = { n: no, a: aciklama, k: Math.round(tl * 100), t: maxTaksit, b: Date.now() + gun * GUN };
  return json({ link: SITE + '/odeme/?l=' + linkImzala(a, veri), gecerlilik: new Date(veri.b).toISOString(), test: a.test === '1' });
};
