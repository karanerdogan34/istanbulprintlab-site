// Müşteri ödeme sayfası: imzalı bağlantıyı doğrular, bağlantı bilgisini gösterir (GET) veya PayTR iFrame belirteci alır (POST).
// Tutar her zaman imzalı bağlantıdan gelir; tarayıcının gönderdiği tutara hiç bakılmaz. Ödenmiş/iptal edilmiş bağlantı tekrar kullanılamaz.
import crypto from 'node:crypto';
import { json } from '../lib/ortak.mjs';
import { ayarlar, linkCoz, iframeBelirteci } from '../lib/paytr.mjs';
import { linkOku, linkAtomik, denemeYaz } from '../lib/kayit.mjs';

const temiz = (s, n) => String(s || '').replace(/[<>\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const SOZLESME_SURUMU = '2026-11-26'; // doğrudan ödeme ve teknik kontrol/iade maddesi eklendi
const KILIT_MS = 2 * 60e3; // aynı link için iki ödeme penceresinin aynı anda açılmasını önler
const GECERSIZ = 'Bu ödeme bağlantısı geçersiz veya süresi dolmuş. Lütfen WhatsApp\'tan bizden yeni bağlantı isteyin.';

async function linkDurumu(a, belirtec) {
  const v = linkCoz(a, belirtec);
  if (!v || !v.i) return { hata: json({ message: GECERSIZ, wa: true }, 404) };
  const k = await linkOku(v.i);
  if (!k || k.durum === 'iptal') return { hata: json({ message: GECERSIZ, wa: true }, 404) };
  if (k.durum === 'odendi') return { hata: json({ message: 'Bu siparişin ödemesi alınmıştır, teşekkür ederiz. Sorunuz varsa WhatsApp\'tan bize yazın.', odendi: true }, 409) };
  return { v, k };
}

export default async (req) => {
  const a = ayarlar();
  if (!a) return json({ message: 'Online ödeme şu an kullanılamıyor. Lütfen WhatsApp\'tan bize yazın.', wa: true }, 503);
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const d = await linkDurumu(a, url.searchParams.get('l'));
    if (d.hata) return d.hata;
    return json({ siparisNo: d.v.n, aciklama: d.v.a, kurus: d.v.k, kargoKurus: d.v.kg || 0, nakliye: d.v.ny === 1, maxTaksit: d.v.t, test: a.test === '1' });
  }

  const kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const d = await linkDurumu(a, g.l);
  if (d.hata) return d.hata;
  const { v, k } = d;

  const ad = temiz(g.ad, 60), eposta = temiz(g.eposta, 100), telefon = temiz(g.telefon, 20).replace(/[^0-9+ ]/g, ''), adres = temiz(g.adres, 400);
  if (ad.length < 3) return json({ message: 'Ad soyad yazın.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) return json({ message: 'Geçerli bir e-posta adresi yazın.' }, 400);
  if (telefon.replace(/\D/g, '').length < 10) return json({ message: 'Telefon numaranızı yazın.' }, 400);
  if (adres.length < 10) return json({ message: 'Fatura / teslimat adresinizi yazın.' }, 400);
  let fatura;
  if (g.faturaTuru === 'kurumsal') {
    fatura = { tur: 'kurumsal', unvan: temiz(g.unvan, 150), vergiDairesi: temiz(g.vergiDairesi, 60), vkn: temiz(g.vkn, 11).replace(/\D/g, '') };
    if (fatura.unvan.length < 2 || fatura.vergiDairesi.length < 2 || !/^\d{10,11}$/.test(fatura.vkn)) return json({ message: 'Kurumsal fatura için firma unvanı, vergi dairesi ve vergi numarasını yazın.' }, 400);
  } else {
    fatura = { tur: 'bireysel', tckn: temiz(g.tckn, 11).replace(/\D/g, '') };
    if (fatura.tckn && !/^\d{11}$/.test(fatura.tckn)) return json({ message: 'T.C. kimlik numarası 11 haneli olmalı (boş da bırakabilirsiniz).' }, 400);
  }
  if (!g.sozlesme) return json({ message: 'Devam etmek için ön bilgilendirme formunu ve mesafeli satış sözleşmesini onaylayın.' }, 400);

  const ip = (req.headers.get('x-nf-client-connection-ip') || '').trim();
  if (!ip) return json({ message: 'Bağlantı bilgisi alınamadı, lütfen tekrar deneyin.' }, 400);
  // PayTR sipariş numarası yalnız harf ve rakam içerir ve her denemede benzersizdir.
  const oid = ('IPL' + v.n.replace(/^IPL-?/, '').replace(/[^A-Z0-9]/g, '') + 'T' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')).toUpperCase().slice(0, 64);
  const simdi = new Date().toISOString();

  // 1) Bağlantıyı atomik olarak bu denemeye ayır: başka bir pencere az önce ödeme başlattıysa ikinci ödeme penceresi açılmaz.
  let kilit;
  try {
    kilit = await linkAtomik(v.i, (eski) => {
      if (eski.durum !== 'bekliyor') return null;
      if (eski.sonDenemeZaman && Date.now() - Date.parse(eski.sonDenemeZaman) < KILIT_MS) return null;
      return { ...eski, sonDeneme: oid, sonDenemeZaman: simdi };
    });
  } catch (e) {
    console.error('Ödeme kaydı okunamadı:', oid, e && e.message);
    return json({ message: 'Ödeme sayfası şu an açılamadı. Lütfen biraz sonra tekrar deneyin.' }, 503);
  }
  if (!kilit.tamam) {
    if (kilit.kayit && kilit.kayit.durum === 'odendi') return json({ message: 'Bu siparişin ödemesi alınmıştır, teşekkür ederiz.', odendi: true }, 409);
    return json({ message: 'Bu sipariş için az önce bir ödeme sayfası açıldı. Lütfen o pencereden devam edin ya da 2 dakika sonra tekrar deneyin.' }, 409);
  }
  // 2) Deneme kaydı (sözleşme onayının kanıtı dahil) yazılır; kayıt yazılamazsa ödeme başlatılmaz.
  try {
    await denemeYaz(oid, {
      oid, linkId: v.i, siparisNo: v.n, aciklama: v.a, kurus: v.k, durum: 'baslatildi', zaman: simdi, test: a.test === '1',
      musteri: { ad, eposta, telefon, adres }, fatura,
      sozlesme: { onay: true, zaman: simdi, ip, surum: SOZLESME_SURUMU, belgeler: ['/on-bilgilendirme-formu/', '/mesafeli-satis-sozlesmesi/', '/kvkk/'] },
    });
  } catch (e) {
    console.error('Ödeme kaydı yazılamadı:', oid, e && e.message);
    return json({ message: 'Ödeme sayfası şu an açılamadı. Lütfen biraz sonra tekrar deneyin.' }, 503);
  }

  const sonuc = await iframeBelirteci(a, {
    ip, oid, eposta, kurus: v.k, ad, adres, telefon,
    sepet: v.kg > 0
      ? [[('Sipariş ' + v.n + ' - ' + v.a).slice(0, 120), ((v.k - v.kg) / 100).toFixed(2), 1], ['Kargo / nakliye', (v.kg / 100).toFixed(2), 1]]
      : [[('Sipariş ' + v.n + ' - ' + v.a).slice(0, 120), (v.k / 100).toFixed(2), 1]],
    taksitYok: v.t === 1, maxTaksit: v.t > 1 ? v.t : 0,
  });
  if (sonuc.hata) {
    console.error('PayTR get-token hatası:', oid, sonuc.hata);
    return json({ message: 'Ödeme sayfası açılamadı. Lütfen biraz sonra tekrar deneyin ya da WhatsApp\'tan bize yazın.', wa: true }, 502);
  }
  return json({ token: sonuc.token, oid });
};
