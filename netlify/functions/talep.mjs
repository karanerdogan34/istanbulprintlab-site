// Hesaplayıcı: sipariş talebini kaydeder, info@ adresine bildirim maili atar, dosya varsa Drive'a doğrudan yükleme adresi verir.
// Talep, dosya yüklenmeden ÖNCE kaydedilir: müşteri sayfayı kapatsa ya da WhatsApp'ı açmasa bile telefon ve seçimler bize ulaşır.
// Mail ya da Drive hatası talebi düşürmez; talep her durumda kayıtlı kalır ve yönetim > Talepler sayfasında görünür.
import { json } from '../lib/ortak.mjs';
import { talepYaz, istemciOku, istemciYaz, talepOku, yeniNo, talepAnahtari, sinirAsildi, mailMetni, telefonDuzelt } from '../lib/talep.mjs';
import { yuklemeOturumu, mailGonder } from '../lib/google.mjs';

const temiz = (s, n) => String(s || '').replace(/[<>\u0000-\u0008\u000B-\u001F]/g, ' ').trim().slice(0, n);
const tekSatir = (s, n) => temiz(s, n).replace(/\s+/g, ' ');
const AZAMI = 300 * 1048576; // 300 MB
const UZANTILAR = ['pdf', 'ai', 'eps', 'svg', 'dxf', 'cdr', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'psd', 'zip'];

export default async (req) => {
  const url = new URL(req.url), kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  if (g.web) return json({ message: 'İzin yok' }, 403); // gizli tuzak alanı: insanlar görmez, botlar doldurur

  const istemci = String(g.istemci || '');
  if (!/^[a-z0-9-]{16,64}$/.test(istemci)) return json({ message: 'Geçersiz istek' }, 400);
  const telefon = tekSatir(g.telefon, 25), rakam = telefonDuzelt(telefon);
  if (rakam.length < 10 || rakam.length > 15) return json({ message: 'Size ulaşabilmemiz için telefon numaranızı yazın.', alan: 'telefon' }, 400);

  // Aynı tıklama ikinci kez gelirse (çift dokunma, bağlantı kopması) yeni talep açılmaz; dosya henüz yüklenmediyse yeni yükleme adresi verilir.
  const onceki = await istemciOku(istemci);
  let k = onceki && onceki.no ? await talepOku(onceki.no) : null;

  if (!k) {
    const ip = (req.headers.get('x-nf-client-connection-ip') || '').trim() || 'bilinmiyor';
    if (await sinirAsildi(ip)) return json({ message: 'Çok sayıda talep gönderildi. Lütfen biraz sonra tekrar deneyin ya da +90 532 523 73 64 numarasından bize ulaşın.' }, 429);
    let dosya = { durum: 'yok' };
    if (g.dosya && g.dosya.ad) {
      const ad = tekSatir(g.dosya.ad, 150).replace(/[\\/:*?"|]/g, '_'), uz = (ad.split('.').pop() || '').toLowerCase(), boyut = Math.floor(Number(g.dosya.boyut));
      if (!UZANTILAR.includes(uz)) return json({ message: 'Bu dosya türü kabul edilmiyor.' }, 400);
      if (!(boyut > 0)) return json({ message: 'Dosya okunamadı, tekrar seçin.' }, 400);
      if (boyut > AZAMI) return json({ message: 'Dosya 300 MB\'tan büyük. Lütfen dosyayı WhatsApp\'tan ya da WeTransfer ile gönderin.', buyuk: true }, 413);
      dosya = { ad, boyut, tur: tekSatir(g.dosya.tur, 100) || 'application/octet-stream', durum: 'yukleniyor' };
    }
    const sayfa = (() => { try { const s = new URL(String(g.sayfa || '')); return s.origin === url.origin ? s.origin + s.pathname : url.origin; } catch (_) { return url.origin; } })();
    k = {
      no: yeniNo(), zaman: new Date().toISOString(),
      urunAd: tekSatir(g.urunAd, 120) || 'Ürün', sayfa,
      telefon, ad: tekSatir(g.ad, 80), not: tekSatir(g.not, 500),
      ozet: temiz(g.ozet, 5000), toplam: tekSatir(g.toplam, 40),
      dosya, mail: { ilk: false, dosya: false },
    };
    if (await talepOku(k.no)) k.no = yeniNo(); // çok düşük ihtimalli çakışma
    await talepYaz(k.no, k);
    await istemciYaz(istemci, k.no);
  }

  // Dosya için Drive'a doğrudan yükleme oturumu (dosya Netlify'dan geçmez; kredi harcamaz, boyut sınırına takılmaz)
  let yukleme = null;
  if (k.dosya && (k.dosya.durum === 'yukleniyor' || k.dosya.durum === 'baglanti')) {
    try {
      const o = await yuklemeOturumu({ ad: k.no + ' - ' + k.dosya.ad, boyut: k.dosya.boyut, tur: k.dosya.tur, aciklama: k.urunAd + ' · ' + k.telefon, origin: url.origin });
      yukleme = o.adres;
      if (k.dosya.durum !== 'yukleniyor' || k.dosya.klasor !== o.klasorId) { k.dosya = { ...k.dosya, durum: 'yukleniyor', klasor: o.klasorId }; await talepYaz(k.no, k); }
    } catch (e) {
      console.error('Drive yükleme oturumu açılamadı:', k.no, e && e.message);
      if (k.dosya.durum !== 'baglanti') { k.dosya = { ...k.dosya, durum: 'baglanti' }; await talepYaz(k.no, k); }
    }
  }

  // İlk bildirim maili: talep düşer düşmez (dosya beklenmeden). Hata talebi etkilemez; dosya sonucu geldiğinde tekrar denenir.
  if (!k.mail.ilk) {
    try {
      await mailGonder({ konu: 'Yeni sipariş talebi ' + k.no + ' — ' + k.urunAd + ' — ' + k.telefon, metin: mailMetni(k) });
      k.mail.ilk = true; await talepYaz(k.no, k);
    } catch (e) { console.error('Talep maili gönderilemedi:', k.no, e && e.message); }
  }

  return json({ no: k.no, anahtar: talepAnahtari(k.no), yukleme, dosyaAlinamaz: !!(k.dosya && k.dosya.durum === 'baglanti') });
};
