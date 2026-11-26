// Hesaplayıcı: baskıya hazır siparişte müşteri beklemeden kartla öder.
// Talep kaydedildikten (ve dosyası yüklendikten) sonra tarayıcı bu adrese talep no + anahtarla gelir; tutar sunucuda
// aynı fiyat motoruyla yeniden hesaplanır, imzalı ödeme bağlantısı üretilir ve müşteri doğrudan /odeme/ sayfasına geçer.
// Teklif gerektiren, kargosu ayrıca belirlenecek ya da dosyası henüz gelmemiş talepler için bağlantı üretilmez.
import crypto from 'node:crypto';
import { json } from '../lib/ortak.mjs';
import { ayarlar, linkImzala, SITE } from '../lib/paytr.mjs';
import { linkOku, linkYaz } from '../lib/kayit.mjs';
import { talepOku, talepGuncelle, anahtarDogru, NO_DESENI } from '../lib/talep.mjs';
import { motor, fiyatlar } from '../lib/uretilen/siparis-motor.mjs';

const GUN = 86400e3;
const DOSYASIZ = new Set(['folyo-yazi-kesim']); // yazıyı sitede yazan müşteride dosya yok (girdi.mod 'yaz')

// Dönüş: { kurus, kargoKurus, aciklama } ya da { neden }
export function tutarHesapla(k) {
  const h = k.hesap;
  if (!h || !h.kod || !h.odenebilir) return { neden: 'uygun-degil' };
  if (!fiyatlar.urunler[h.kod]) return { neden: 'urun' };
  let r;
  try { r = motor.hesapla(fiyatlar, h.kod, h.girdi || {}); } catch (_) { return { neden: 'hesap' }; }
  if (!r || r.durum !== 'tamam') return { neden: 'teklif' };
  if (r.kargoAyrica) return { neden: 'kargo' };
  const toplam = Number(r.genelToplam || r.toplam), kargo = Number(r.kargoUcret || 0);
  if (!(toplam >= 1) || toplam > 1000000) return { neden: 'hesap' };
  return { kurus: Math.round(toplam * 100), kargoKurus: Math.round(kargo * 100), aciklama: String(k.urunAd || 'Baskı siparişi').slice(0, 100) };
}

export default async (req) => {
  const url = new URL(req.url), kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const no = String(g.no || '');
  if (!NO_DESENI.test(no) || !(await anahtarDogru(no, g.anahtar))) return json({ message: 'İzin yok' }, 403);
  const a = ayarlar();
  if (!a) return json({ message: 'Online ödeme şu an kullanılamıyor. Talebiniz bize ulaştı; size dönüş yapacağız.' }, 503);
  const k = await talepOku(no);
  if (!k) return json({ message: 'Talep bulunamadı.' }, 404);

  // Daha önce bu talep için bağlantı üretildiyse aynısı kullanılır (çift tıklama, sayfa yenileme)
  if (k.odeme && k.odeme.linkId) {
    const l = await linkOku(k.odeme.linkId);
    if (l && l.durum === 'odendi') return json({ message: 'Bu siparişin ödemesi alınmıştır, teşekkür ederiz.', odendi: true }, 409);
    if (l && l.durum === 'bekliyor' && l.b > Date.now() + 3600e3 && k.odeme.link) return json({ link: k.odeme.link });
  }

  const dosyaGerekli = !(DOSYASIZ.has(k.hesap && k.hesap.kod) && k.hesap.girdi && !k.dosya.ad);
  if (dosyaGerekli && (!k.dosya || k.dosya.durum !== 'tamam')) return json({ message: 'Dosyanız henüz tam yüklenmedi. Yükleme bitince ödeme düğmesi açılır.', bekle: true }, 409);

  const t = tutarHesapla(k);
  if (!t.kurus) {
    const neden = { teklif: 'Bu iş teklifle fiyatlandırılıyor.', kargo: 'Bu siparişin kargo ücreti ayrıca belirleniyor.' }[t.neden] || 'Bu sipariş için online ödeme açılamadı.';
    return json({ message: neden + ' Talebiniz bize ulaştı; size dönüş yapacağız.' }, 409);
  }

  const id = crypto.randomBytes(12).toString('hex');
  const veri = { i: id, n: no, a: t.aciklama, k: t.kurus, t: 12, b: Date.now() + 3 * GUN };
  if (t.kargoKurus > 0) veri.kg = t.kargoKurus;
  await linkYaz(id, { ...veri, durum: 'bekliyor', olusturma: new Date().toISOString(), test: a.test === '1', kaynak: 'hesaplayici' });
  const link = SITE + '/odeme/?l=' + linkImzala(a, veri);
  await talepGuncelle(no, (e) => ({ ...e, odeme: { linkId: id, link, kurus: t.kurus, zaman: new Date().toISOString() } })).catch((e) => console.error('Talebe ödeme bağlantısı yazılamadı:', no, e && e.message));
  return json({ link, kurus: t.kurus });
};
