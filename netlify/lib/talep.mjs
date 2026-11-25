// Sipariş talepleri: hesaplayıcıdan gelen her talep (müşteri WhatsApp'ı açmasa bile) Netlify Blobs'a kaydedilir.
//   talep/<no>      : talep kaydı (ürün, seçimler, ön fiyat, telefon, dosya durumu, mail durumu)
//   istemci/<id>    : aynı tıklamanın iki kez kayıt açmasını önler (çift dokunma, bağlantı kopup yeniden deneme)
//   sinir/<ip>/<saat> : IP başına saatlik talep sınırı (bot/kötüye kullanım)
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

let bellek = null; // yalnızca yerel testlerde
const depo = () => {
  if (process.env.IPL_TEST_BELLEK === '1') {
    bellek = bellek || new Map();
    return {
      get: async (k) => (bellek.has(k) ? JSON.parse(bellek.get(k)) : null),
      setJSON: async (k, v) => { bellek.set(k, JSON.stringify(v)); },
      list: async ({ prefix }) => ({ blobs: [...bellek.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    };
  }
  return getStore({ name: 'talepler', consistency: 'strong' });
};

export const talepOku = (no) => depo().get('talep/' + no, { type: 'json' });
export const talepYaz = (no, v) => depo().setJSON('talep/' + no, v);
export const istemciOku = (id) => depo().get('istemci/' + id, { type: 'json' });
export const istemciYaz = (id, no) => depo().setJSON('istemci/' + id, { no, zaman: Date.now() });

// Talep numarası: T + YYAAGG + '-' + 4 karakter (karışan harfler yok: 0/O, 1/I/L). Örn. T261125-K7QM
const HARF = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function yeniNo() {
  const s = new Date(Date.now() + 3 * 3600e3); // İstanbul tarihi
  const t = String(s.getUTCFullYear()).slice(2) + String(s.getUTCMonth() + 1).padStart(2, '0') + String(s.getUTCDate()).padStart(2, '0');
  let e = '';
  for (const b of crypto.randomBytes(4)) e += HARF[b % HARF.length];
  return 'T' + t + '-' + e;
}

function gizli() {
  const s = process.env.TALEP_GIZLI || process.env.GITHUB_CLIENT_SECRET;
  if (!s) throw new Error('Sunucu ayarı eksik');
  return s;
}
// Dosya yüklemesinin sonucunu bildiren isteğin, talebi açan tarayıcıdan geldiğini kanıtlayan imza
export const talepAnahtari = (no) => crypto.createHmac('sha256', 'ipl-talep:' + gizli()).update(no).digest('base64url').slice(0, 32);
export const anahtarDogru = (no, a) => {
  const b = Buffer.from(talepAnahtari(no)), c = Buffer.from(String(a || ''));
  return b.length === c.length && crypto.timingSafeEqual(b, c);
};

// IP başına saatte en fazla SINIR talep. Sayaç atomik değildir; amaç kesin sayım değil, seri kötüye kullanımı kesmek.
const SINIR = 10;
export async function sinirAsildi(ip) {
  const d = depo();
  const h = crypto.createHash('sha256').update('ipl-ip:' + gizli() + ip).digest('hex').slice(0, 24);
  const k = 'sinir/' + h + '/' + Math.floor(Date.now() / 3600e3);
  const v = (await d.get(k, { type: 'json' })) || { n: 0 };
  if (v.n >= SINIR) return true;
  await d.setJSON(k, { n: v.n + 1 });
  return false;
}

export async function sonTalepler(sinir = 200) {
  const d = depo();
  const { blobs } = await d.list({ prefix: 'talep/' });
  // Numara tarih içerdiği için ada göre sıralamak yaklaşık tarih sırasıdır; en yeni 400 okunur, sonra zamana göre sıralanır.
  const anahtarlar = blobs.map((b) => b.key).sort().slice(-400);
  const hepsi = await Promise.all(anahtarlar.map((k) => d.get(k, { type: 'json' })));
  return hepsi.filter(Boolean).sort((x, y) => String(y.zaman).localeCompare(String(x.zaman))).slice(0, sinir);
}

// Türkiye numaralarını wa.me / tel biçimine çevirir: 0532..., 532..., +90 532... → 905325237364
export function telefonDuzelt(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '0') d = '90' + d.slice(1);
  else if (d.length === 10 && d[0] === '5') d = '90' + d;
  else if (d.startsWith('00')) d = d.slice(2);
  return d;
}

const MB = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' MB');
const tarih = (z) => new Date(z).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });
const DOSYA_DURUMU = {
  yok: 'Dosya yok (müşteri dosya yüklemedi).',
  yukleniyor: 'Yükleniyor… Tamamlanınca ayrı bir mail gelir. Gelmezse müşteriyi arayıp dosyayı WhatsApp\'tan isteyin.',
  tamam: 'Yüklendi.',
  hata: 'YÜKLENEMEDİ — müşteriyi arayıp dosyayı WhatsApp\'tan isteyin.',
  baglanti: 'Drive bağlantısı kurulamadı; dosya alınamadı — müşteriden WhatsApp\'tan isteyin.',
};

// Bildirim maili: telefonda ilk bakışta aranacak numara ve ürün görünsün diye en üstte
export function mailMetni(k) {
  const tel = telefonDuzelt(k.telefon), d = k.dosya || { durum: 'yok' };
  const waMetni = encodeURIComponent('Merhaba, istanbulprintlab.com üzerinden gönderdiğiniz ' + k.no + ' numaralı sipariş talebiniz hakkında yazıyoruz.');
  return [
    'Talep no: ' + k.no,
    'Zaman: ' + tarih(k.zaman),
    'Telefon: +' + tel + (k.ad ? '  (' + k.ad + ')' : ''),
    'Aramak için: tel:+' + tel,
    'WhatsApp\'tan yazmak için: https://wa.me/' + tel + '?text=' + waMetni,
    'Ürün: ' + k.urunAd,
    k.toplam ? 'Ön hesaplama toplamı: ' + k.toplam : null,
    '',
    'DOSYA: ' + (d.ad ? d.ad + ' (' + MB(d.boyut) + ') — ' : '') + DOSYA_DURUMU[d.durum || 'yok'] + (d.link ? '\n' + d.link : ''),
    '',
    k.not ? 'Müşteri notu: ' + k.not + '\n' : null,
    '— Müşterinin seçimleri —',
    k.ozet,
    '',
    'Sayfa: ' + k.sayfa,
    'Tüm talepler: https://www.istanbulprintlab.com/yonetim/talepler/',
  ].filter((s) => s !== null).join('\n');
}
