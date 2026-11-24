// Yönetim: ödeme denemelerinin listesi (durum, tutar, taksit, müşteri ve fatura bilgileri) — faturayı buradan kesmek için.
// Yalnızca yönetim uygulamasına giriş yapmış hesap görebilir.
import { OTURUM, cerezOku, coz, json } from '../lib/ortak.mjs';
import { sonDenemeler } from '../lib/kayit.mjs';

export default async (req) => {
  const kaynak = req.headers.get('origin');
  const ayniSite = kaynak && kaynak === new URL(req.url).origin;
  if (req.method !== 'POST' || !ayniSite || req.headers.get('x-yonetim') !== '1') return json({ message: 'İzin yok' }, 403);
  const cerez = cerezOku(req, OTURUM);
  if (!cerez || !coz(cerez)) return json({ message: 'Önce yönetim uygulamasına giriş yapın.' }, 401);
  try {
    const L = await sonDenemeler();
    return json({ odemeler: L.map((d) => ({
      oid: d.oid, siparisNo: d.siparisNo, aciklama: d.aciklama, kurus: d.kurus, durum: d.durum, zaman: d.zaman, test: !!d.test,
      musteri: d.musteri, fatura: d.fatura, sonuc: d.sonuc || null, sozlesmeZaman: d.sozlesme && d.sozlesme.zaman,
    })) });
  } catch (e) {
    console.error('Ödeme listesi okunamadı:', e && e.message);
    return json({ message: 'Ödeme kayıtları okunamadı, biraz sonra tekrar deneyin.' }, 503);
  }
};
