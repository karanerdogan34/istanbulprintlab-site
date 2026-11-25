// Hesaplayıcı: sipariş talebini kaydeder, info@ adresine bildirim maili atar, dosya varsa Drive'a doğrudan yükleme adresi verir.
// Talep, dosya yüklenmeden ÖNCE kaydedilir: müşteri sayfayı kapatsa ya da WhatsApp'ı açmasa bile telefon ve seçimler bize ulaşır.
// Mail ya da Drive hatası talebi düşürmez; gönderilemeyen mailleri talep-kontrol (zamanlanmış) tekrar dener.
import { json } from '../lib/ortak.mjs';
import { talepYaz, talepOku, talepGuncelle, istemciSahiplen, yeniNo, talepAnahtari, sinirAsildi, kotaAyir, telefonDuzelt } from '../lib/talep.mjs';
import { yuklemeOturumu } from '../lib/google.mjs';
import { ilkMail } from '../lib/talep-islem.mjs';

const temiz = (s, n) => String(s || '').replace(/[<>\u0000-\u0008\u000B-\u001F]/g, ' ').trim().slice(0, n);
const tekSatir = (s, n) => temiz(s, n).replace(/\s+/g, ' ');
const AZAMI = 300 * 1048576; // 300 MB
const UZANTILAR = ['pdf', 'ai', 'eps', 'svg', 'dxf', 'cdr', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'psd', 'zip'];

export default async (req, context) => {
  const url = new URL(req.url), kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  if (g.web) return json({ message: 'İzin yok' }, 403); // gizli tuzak alanı: insanlar görmez, botlar doldurur

  const istemci = String(g.istemci || '');
  if (!/^[a-z0-9-]{16,64}$/.test(istemci)) return json({ message: 'Geçersiz istek' }, 400);
  const telefon = tekSatir(g.telefon, 25), rakam = telefonDuzelt(telefon);
  if (rakam.length < 10 || rakam.length > 15) return json({ message: 'Size ulaşabilmemiz için telefon numaranızı yazın.', alan: 'telefon' }, 400);

  // Dosya bilgisi kayıttan önce doğrulanır (yanlış dosya talebi düşürmesin diye yalnız tür ve boyut reddedilir)
  let dosya = { durum: 'yok' };
  if (g.dosya && g.dosya.ad) {
    const ad = tekSatir(g.dosya.ad, 150).replace(/[\\/:*?"|]/g, '_'), uz = (ad.split('.').pop() || '').toLowerCase(), boyut = Math.floor(Number(g.dosya.boyut));
    if (!UZANTILAR.includes(uz)) return json({ message: 'Bu dosya türü kabul edilmiyor.' }, 400);
    if (!(boyut > 0)) return json({ message: 'Dosya okunamadı, tekrar seçin.' }, 400);
    if (boyut > AZAMI) return json({ message: 'Dosya 300 MB\'tan büyük. Lütfen dosyayı WhatsApp\'tan ya da WeTransfer ile gönderin.', buyuk: true }, 413);
    dosya = { ad, boyut, tur: tekSatir(g.dosya.tur, 100) || 'application/octet-stream', durum: 'yukleniyor' };
  }

  // Aynı tıklama ikinci kez gelirse (çift dokunma, bağlantı kopması) yeni talep açılmaz: istemci kimliğini ilk alan kazanır.
  const aday = yeniNo();
  const sahip = await istemciSahiplen(istemci, aday);
  let k;
  if (sahip.yeni) {
    const ip = (req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim();
    if (ip && await sinirAsildi(ip)) return json({ message: 'Çok sayıda talep gönderildi. Lütfen biraz sonra tekrar deneyin ya da +90 532 523 73 64 numarasından bize ulaşın.' }, 429);
    if (dosya.durum === 'yukleniyor' && !(await kotaAyir(dosya.boyut))) dosya = { ...dosya, durum: 'kota' };
    const sayfa = (() => { try { const s = new URL(String(g.sayfa || '')); return s.origin === url.origin ? s.origin + s.pathname : url.origin; } catch (_) { return url.origin; } })();
    k = {
      no: aday, zaman: new Date().toISOString(),
      urunAd: tekSatir(g.urunAd, 120) || 'Ürün', sayfa,
      telefon, ad: tekSatir(g.ad, 80), not: tekSatir(g.not, 500),
      ozet: temiz(g.ozet, 5000), toplam: tekSatir(g.toplam, 40),
      dosya, mail: { ilk: false, dosya: false },
    };
    await talepYaz(k.no, k);
  } else {
    k = sahip.no && await talepOku(sahip.no);
    if (!k) return json({ message: 'Talep işlenirken bir sorun oluştu, lütfen tekrar deneyin.' }, 503);
  }

  // Dosya için Drive'a doğrudan yükleme oturumu (dosya Netlify'dan geçmez). Aynı talep için var olan oturum yeniden kullanılır.
  let yukleme = null;
  if (k.dosya && ['yukleniyor', 'baglanti'].includes(k.dosya.durum)) {
    if (k.dosya.oturum) yukleme = k.dosya.oturum;
    else {
      try {
        const o = await yuklemeOturumu({ ad: k.no + ' - ' + k.dosya.ad, boyut: k.dosya.boyut, tur: k.dosya.tur, aciklama: k.urunAd + ' · ' + k.telefon, origin: url.origin });
        yukleme = o.adres;
        k = await talepGuncelle(k.no, (e) => ({ ...e, dosya: { ...e.dosya, durum: 'yukleniyor', oturum: o.adres, klasor: o.klasorId } }));
      } catch (e) {
        console.error('Drive yükleme oturumu açılamadı:', k.no, e && e.message);
        k = await talepGuncelle(k.no, (x) => (x.dosya.durum === 'baglanti' ? null : { ...x, dosya: { ...x.dosya, durum: 'baglanti' } }));
      }
    }
  }

  // İlk bildirim maili yanıtı bekletmez (müşteri hemen talep numarasını görür); gönderilemezse talep-kontrol tekrar dener.
  if (!k.mail.ilk) {
    const is = ilkMail(k.no).catch((e) => console.error('Talep maili gönderilemedi:', k.no, e && e.message));
    if (context && typeof context.waitUntil === 'function') context.waitUntil(is); else await is;
  }

  return json({ no: k.no, anahtar: await talepAnahtari(k.no), yukleme, dosyaAlinamaz: k.dosya.durum === 'baglanti' || k.dosya.durum === 'kota' });
};
