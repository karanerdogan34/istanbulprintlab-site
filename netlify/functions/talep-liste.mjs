// Yönetim: hesaplayıcıdan gelen sipariş talepleri (mail gelmese bile hepsi burada görünür) ve Google bağlantı durumu.
import { OTURUM, cerezOku, coz, json } from '../lib/ortak.mjs';
import { sonTalepler, telefonDuzelt } from '../lib/talep.mjs';
import { baglantiDurumu } from '../lib/google.mjs';

export default async (req) => {
  const kaynak = req.headers.get('origin');
  const ayniSite = kaynak && kaynak === new URL(req.url).origin;
  if (req.method !== 'POST' || !ayniSite || req.headers.get('x-yonetim') !== '1') return json({ message: 'İzin yok' }, 403);
  const cerez = cerezOku(req, OTURUM);
  if (!cerez || !coz(cerez)) return json({ message: 'Önce yönetim uygulamasına giriş yapın.' }, 401);
  try {
    const [L, google] = await Promise.all([sonTalepler(), baglantiDurumu()]);
    return json({ google, talepler: L.map((k) => ({
      no: k.no, zaman: k.zaman, urunAd: k.urunAd, sayfa: k.sayfa, telefon: k.telefon, tel: telefonDuzelt(k.telefon), ad: k.ad, not: k.not,
      ozet: k.ozet, toplam: k.toplam, dosya: k.dosya ? { ad: k.dosya.ad, boyut: k.dosya.boyut, durum: k.dosya.durum, link: k.dosya.link } : null, mail: k.mail,
    })) });
  } catch (e) {
    console.error('Talep listesi okunamadı:', e && e.message);
    return json({ message: 'Talepler okunamadı, biraz sonra tekrar deneyin.' }, 503);
  }
};
