// PayTR Bildirim URL'si (callback) — PayTR'ın kendisi buraya ulaşamadığı için (Netlify sunucuları PayTR'dan erişilemiyor)
// Mağaza Paneli > Ayarlar > Bildirim URL'si: https://odeme.istanbulprintlab.com/paytr-bildirim.php (Türkiye'deki aktarıcı).
// Aktarıcı bildirimi kuyruğa yazar ve ham gövdeyi aynen buraya iletir; PayTR imzası burada ayrıca doğrulanır.
// Sonuç kalıcı olarak kaydedildikten sonra "OK" dönülür (aksi halde aktarıcı tekrar dener). Loglara müşteri bilgisi yazılmaz.
import { ayarlar } from '../lib/paytr.mjs';
import { bildirimIsle } from '../lib/bildirim-isle.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = ayarlar();
  if (!a) return new Response('Yapilandirma eksik', { status: 500 });
  const p = Object.fromEntries(new URLSearchParams(await req.text()));
  const kaynak = req.headers.get('x-ipl-aktarici') ? 'aktarici' : 'dogrudan';
  const r = await bildirimIsle(a, p, { kaynak });
  if (r.kod === 400) console.error('PayTR bildirimi reddedildi (imza/biçim)');
  return new Response(r.metin, { status: r.kod, headers: { 'Content-Type': 'text/plain' } });
};
