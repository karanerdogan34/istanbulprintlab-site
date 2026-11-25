// Yönetim: aktarıcının karantinaya aldığı (site tarafından reddedilmiş) bildirimleri elle yeniden işler.
// Örn. geçici bir kod hatası yüzünden reddedilen gerçek PayTR bildirimi bu düğmeyle kurtarılır. PayTR imzası yine doğrulanır.
import { OTURUM, cerezOku, coz, json } from '../lib/ortak.mjs';
import { ayarlar, AKTARICI, aktariciBasliklari } from '../lib/paytr.mjs';
import { bildirimIsle } from '../lib/bildirim-isle.mjs';

export default async (req) => {
  const kaynak = req.headers.get('origin');
  const ayniSite = kaynak && kaynak === new URL(req.url).origin;
  if (req.method !== 'POST' || !ayniSite || req.headers.get('x-yonetim') !== '1') return json({ message: 'İzin yok' }, 403);
  const cerez = cerezOku(req, OTURUM);
  if (!cerez || !coz(cerez)) return json({ message: 'Önce yönetim uygulamasına giriş yapın.' }, 401);
  const a = ayarlar();
  if (!a) return json({ message: 'Ödeme ayarları eksik.' }, 500);
  try {
    const yol = '/bekleyenler.php?tur=karantina';
    const r = await fetch(AKTARICI + yol, { headers: aktariciBasliklari(a, 'GET', yol), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return json({ message: 'Aktarıcıya ulaşılamadı (HTTP ' + r.status + ').' }, 502);
    const kayitlar = (await r.json()).kayitlar || [];
    const kabul = [], kalan = [];
    for (const k of kayitlar) {
      const p = Object.fromEntries(new URLSearchParams(String(k.govde || '')));
      const s = await bildirimIsle(a, p, { kaynak: 'karantina' });
      (s.kod === 200 ? kabul : kalan).push(Number(k.id));
    }
    if (kabul.length) {
      const yol2 = '/onay.php', govde = JSON.stringify({ kabul, red: [] });
      await fetch(AKTARICI + yol2, { method: 'POST', body: govde, headers: { 'Content-Type': 'application/json', ...aktariciBasliklari(a, 'POST', yol2, govde) }, signal: AbortSignal.timeout(10000) });
    }
    return json({ toplam: kayitlar.length, kurtarilan: kabul.length, reddedilen: kalan.length });
  } catch (e) {
    console.error('Karantina yeniden deneme:', e && e.message);
    return json({ message: 'İşlem tamamlanamadı, biraz sonra tekrar deneyin.' }, 503);
  }
};
