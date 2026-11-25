// Sipariş talepleri: hesaplayıcıdan gelen her talep (müşteri WhatsApp'ı açmasa bile) Netlify Blobs'a kaydedilir.
//   talep/<no>      : talep kaydı (ürün, seçimler, ön fiyat, telefon, dosya durumu, mail durumu)
//   istemci/<id>    : aynı tıklamanın iki kez kayıt açmasını önler (çift dokunma, bağlantı kopup yeniden deneme)
//   sinir/<ip>/<saat> : IP başına saatlik talep sınırı (bot/kötüye kullanım)
//   kota/<gün>      : sitenin günlük toplam dosya yükleme kotası
//   ayar/gizli      : imza anahtarı (ilk kullanımda üretilir)
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

let bellek = null; // yalnızca yerel testlerde (etag ve koşullu yazma dahil)
const depo = () => {
  if (process.env.IPL_TEST_BELLEK === '1') {
    bellek = bellek || new Map();
    const etag = (k) => (bellek.has(k) ? crypto.createHash('sha1').update(bellek.get(k)).digest('hex') : null);
    return {
      get: async (k) => (bellek.has(k) ? JSON.parse(bellek.get(k)) : null),
      getWithMetadata: async (k) => (bellek.has(k) ? { data: JSON.parse(bellek.get(k)), etag: etag(k) } : null),
      setJSON: async (k, v, o = {}) => {
        if (o.onlyIfNew && bellek.has(k)) return { modified: false };
        if (o.onlyIfMatch && etag(k) !== o.onlyIfMatch) return { modified: false };
        bellek.set(k, JSON.stringify(v)); return { modified: true };
      },
      list: async ({ prefix }) => ({ blobs: [...bellek.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    };
  }
  return getStore({ name: 'talepler', consistency: 'strong' });
};

export const talepOku = (no) => depo().get('talep/' + no, { type: 'json' });
export const talepYaz = (no, v) => depo().setJSON('talep/' + no, v);
// Yeni talep: yalnızca bu numarada kayıt yoksa yazar (numara çakışmasında var olan müşteri kaydı ezilmez)
export const talepYeniYaz = async (no, v) => { const r = await depo().setJSON('talep/' + no, v, { onlyIfNew: true }); return !!(r && r.modified); };
export const istemciNoDegistir = (id, no) => depo().setJSON('istemci/' + id, { no, zaman: Date.now() });
// Talep kaydını atomik günceller (iki istek aynı anda yazarsa biri diğerinin değişikliğini ezmesin). guncelle(eski) → yeni | null
export async function talepGuncelle(no, guncelle) {
  const d = depo();
  for (let i = 0; i < 5; i++) {
    const o = await d.getWithMetadata('talep/' + no, { type: 'json' });
    if (!o || !o.data) return null;
    const yeni = guncelle(o.data);
    if (!yeni) return o.data;
    const r = await d.setJSON('talep/' + no, yeni, { onlyIfMatch: o.etag });
    if (r && r.modified) return yeni;
  }
  throw new Error('Talep güncellenemedi (eş zamanlı yazma)');
}
// Aynı istemci kimliği için yalnızca bir talep numarası: koşullu ilk yazma kazanır, ikinci istek ilkinin numarasını kullanır.
export async function istemciSahiplen(id, no) {
  const d = depo();
  const r = await d.setJSON('istemci/' + id, { no, zaman: Date.now() }, { onlyIfNew: true });
  if (r && r.modified) return { yeni: true, no };
  const v = await d.get('istemci/' + id, { type: 'json' });
  return { yeni: false, no: v && v.no };
}
istemciSahiplen.oku = (id) => depo().get('istemci/' + id, { type: 'json' });

// Talep numarası: T + YYAAGG + '-' + 4 karakter (karışan harfler yok: 0/O, 1/I/L). Örn. T261125-K7QM
const HARF = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function yeniNo() {
  const s = new Date(Date.now() + 3 * 3600e3); // İstanbul tarihi
  const t = String(s.getUTCFullYear()).slice(2) + String(s.getUTCMonth() + 1).padStart(2, '0') + String(s.getUTCDate()).padStart(2, '0');
  let e = '';
  for (const b of crypto.randomBytes(4)) e += HARF[b % HARF.length];
  return 'T' + t + '-' + e;
}
export const NO_DESENI = /^T\d{6}-[A-Z0-9]{4}$/;

// Talep imzası ve IP özetleri için gizli anahtar: ortam değişkeni yoksa ilk kullanımda rastgele üretilip saklanır (başka bir sırra bağlı değil).
let gizliOnbellek = null;
async function gizli() {
  if (process.env.TALEP_GIZLI) return process.env.TALEP_GIZLI;
  if (gizliOnbellek) return gizliOnbellek;
  const d = depo();
  let v = await d.get('ayar/gizli', { type: 'json' });
  if (!v || !v.g) {
    await d.setJSON('ayar/gizli', { g: crypto.randomBytes(32).toString('base64url') }, { onlyIfNew: true });
    v = await d.get('ayar/gizli', { type: 'json' });
  }
  gizliOnbellek = v.g;
  return gizliOnbellek;
}
// Dosya yüklemesinin sonucunu bildiren isteğin, talebi açan tarayıcıdan geldiğini kanıtlayan imza
export const talepAnahtari = async (no) => crypto.createHmac('sha256', 'ipl-talep:' + (await gizli())).update(no).digest('base64url').slice(0, 32);
export const anahtarDogru = async (no, a) => {
  const b = Buffer.from(await talepAnahtari(no)), c = Buffer.from(String(a || ''));
  return b.length === c.length && crypto.timingSafeEqual(b, c);
};

// Atomik sayaç (koşullu yazma ile): sınır aşıldıysa false döner, aşılmadıysa sayacı artırıp true döner.
async function sayacArtir(k, artis, sinir) {
  const d = depo();
  for (let i = 0; i < 6; i++) {
    const o = await d.getWithMetadata(k, { type: 'json' });
    const n = o && o.data ? o.data.n : 0;
    if (n + artis > sinir) return false;
    const r = o ? await d.setJSON(k, { n: n + artis }, { onlyIfMatch: o.etag }) : await d.setJSON(k, { n: artis }, { onlyIfNew: true });
    if (r && r.modified) return true;
  }
  return false; // yoğun çakışmada temkinli davran
}
// IP başına saatte en fazla 10 talep
export async function sinirAsildi(ip) {
  const h = crypto.createHash('sha256').update('ipl-ip:' + (await gizli()) + ip).digest('hex').slice(0, 24);
  return !(await sayacArtir('sinir/' + h + '/' + Math.floor(Date.now() / 3600e3), 1, 10));
}
// Sitenin tamamı için günlük yükleme kotası (bayt): Drive'ın kötüye kullanımla dolmasını önler
const GUNLUK_KOTA = Number(process.env.TALEP_GUNLUK_KOTA_MB || 5000) * 1048576;
export async function kotaAyir(bayt) {
  return sayacArtir('kota/' + new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), bayt, GUNLUK_KOTA);
}

export async function sonTalepler(sinir = 200) {
  const d = depo();
  const { blobs } = await d.list({ prefix: 'talep/' });
  // Numara tarih içerdiği için ada göre sıralamak yaklaşık tarih sırasıdır; en yeni 400 okunur, sonra zamana göre sıralanır.
  const anahtarlar = blobs.map((b) => b.key).sort().slice(-400);
  const hepsi = await Promise.all(anahtarlar.map((k) => d.get(k, { type: 'json' })));
  return hepsi.filter(Boolean).sort((x, y) => String(y.zaman).localeCompare(String(x.zaman))).slice(0, sinir);
}
// Son N günün talepleri (zamanlanmış kontrol için; numaradaki tarihten süzülür, eski kayıtlar okunmaz)
export async function yakinTalepler(gun = 3) {
  const d = depo(), sinirTarih = new Date(Date.now() + 3 * 3600e3 - gun * 86400e3);
  const alt = 'talep/T' + String(sinirTarih.getUTCFullYear()).slice(2) + String(sinirTarih.getUTCMonth() + 1).padStart(2, '0') + String(sinirTarih.getUTCDate()).padStart(2, '0');
  const { blobs } = await d.list({ prefix: 'talep/' });
  const anahtarlar = blobs.map((b) => b.key).filter((k) => k >= alt);
  return (await Promise.all(anahtarlar.map((k) => d.get(k, { type: 'json' })))).filter(Boolean);
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
  kota: 'Günlük yükleme kotası doldu; dosya alınamadı — müşteriden WhatsApp\'tan isteyin.',
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
