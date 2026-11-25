// Zamanlanmış ödeme kontrolü (10 dakikada bir — Netlify kredisi tasarrufu için). İki yedek katman:
//  1) Türkiye'deki aktarıcının kuyruğunda siteye iletilememiş bildirim varsa imzalı istekle çeker, işler ve onaylar.
//  2) Ödeme sayfası açılıp sonucu hâlâ gelmemiş denemeler için PayTR Durum Sorgu API'ye sorar (geri çekilmeli aralıklarla).
// Son çalışma bilgisi 'sistem/kontrol' kaydına yazılır; yönetim panelindeki Ödemeler ekranı buna göre uyarı gösterir.
import { ayarlar, durumSorgu, AKTARICI, aktariciBasliklari } from '../lib/paytr.mjs';
import { bildirimIsle } from '../lib/bildirim-isle.mjs';
import { sonDenemeler, denemeAtomik, sistemOku, sistemYaz } from '../lib/kayit.mjs';

export const config = { schedule: '*/10 * * * *' };

const DK = 60e3;
// Durum sorgusu zamanlaması: ödeme sayfası açıldıktan 5 dk sonra başla, 48 saat boyunca giderek seyrelen aralıklarla sor.
const sorguAraligi = (sayi) => (sayi < 3 ? 5 : sayi < 6 ? 15 : sayi < 10 ? 60 : 240) * DK;

async function aktaricidanCek(a) {
  const sonuc = { bekleyen: 0, kabul: 0, red: 0, hata: '' };
  try {
    const yol = '/bekleyenler.php';
    const r = await fetch(AKTARICI + yol, { headers: aktariciBasliklari(a, 'GET', yol), signal: AbortSignal.timeout(10000) });
    if (!r.ok) { sonuc.hata = 'Aktarıcı yanıtı HTTP ' + r.status; return sonuc; }
    const j = await r.json();
    const kayitlar = Array.isArray(j.kayitlar) ? j.kayitlar : [];
    sonuc.bekleyen = kayitlar.length;
    sonuc.karantina = Number(j.karantina) || 0;
    sonuc.enEski = kayitlar.length ? Math.min(...kayitlar.map((k) => Number(k.alindi) || 0)) * 1000 : null;
    const kabul = [], red = [];
    for (const k of kayitlar) {
      const p = Object.fromEntries(new URLSearchParams(String(k.govde || '')));
      const s = await bildirimIsle(a, p, { kaynak: 'aktarici-cekme' });
      if (s.kod === 200) kabul.push(Number(k.id)); else if (s.kod === 400) red.push(Number(k.id));
    }
    if (kabul.length || red.length) {
      const yol2 = '/onay.php', govde = JSON.stringify({ kabul, red });
      const o = await fetch(AKTARICI + yol2, { method: 'POST', body: govde, headers: { 'Content-Type': 'application/json', ...aktariciBasliklari(a, 'POST', yol2, govde) }, signal: AbortSignal.timeout(10000) });
      if (!o.ok) sonuc.hata = 'Onay gönderilemedi HTTP ' + o.status;
    }
    sonuc.kabul = kabul.length; sonuc.red = red.length;
  } catch (e) { sonuc.hata = 'Aktarıcıya ulaşılamadı: ' + (e && e.message || '').slice(0, 80); }
  return sonuc;
}

async function durumlariSor(a) {
  const simdi = Date.now(), sonuc = { soruldu: 0, bulundu: 0, bildirilmedi: 0 };
  const L = await sonDenemeler(200);
  const adaylar = L.filter((d) => d.durum === 'baslatildi' && d.oid && d.zaman).filter((d) => {
    const yas = simdi - Date.parse(d.zaman);
    const s = d.sorgu || { sayi: 0, son: 0 };
    return yas > 5 * DK && yas < 48 * 60 * DK && simdi - (s.son || 0) >= sorguAraligi(s.sayi || 0);
  }).slice(0, 10);
  for (const d of adaylar) {
    const r = await durumSorgu(a, d.oid);
    sonuc.soruldu++;
    let uyari = r.durum === 'bildirilmedi' ? 'PayTR bu ödemeyi başarılı görüyor ama sonuç siteye ulaşmadı — PayTR panelinden kontrol edin.' : '';
    if (r.durum === 'basarili') {
      // Ek doğrulamalar: test/canlı modu, para birimi ve sipariş tutarı tutmalı; tutmuyorsa otomatik kaydetme, uyar.
      if (r.test !== (a.test === '1')) uyari = 'Durum sorgusu: ödemenin test/canlı modu mağaza ayarıyla uyuşmuyor — PayTR panelinden kontrol edin.';
      else if (r.paraBirimi && !/^(TL|TRY)$/i.test(r.paraBirimi)) uyari = 'Durum sorgusu: beklenmeyen para birimi (' + r.paraBirimi + ') — PayTR panelinden kontrol edin.';
      else if (Number.isFinite(r.odemeKurus) && r.odemeKurus !== d.kurus) uyari = 'Durum sorgusu: PayTR\'daki sipariş tutarı farklı — PayTR panelinden kontrol edin.';
    }
    if (r.durum === 'basarili' && !uyari) {
      const s = await bildirimIsle(a, { merchant_oid: d.oid, status: 'success', total_amount: String(r.toplamKurus), installment_count: r.taksit, test_mode: r.test ? '1' : '0' }, { guvenilir: true, kaynak: 'durum-sorgu' });
      if (s.kod === 200) { sonuc.bulundu++; continue; }
    }
    if (uyari) sonuc.bildirilmedi++;
    await denemeAtomik(d.oid, async (x) => (x.durum !== 'baslatildi' ? null : {
      ...x, sorgu: { sayi: ((x.sorgu && x.sorgu.sayi) || 0) + 1, son: Date.now(), sonuc: r.durum, ...(uyari ? { uyari } : {}) },
    }));
  }
  return sonuc;
}

export default async () => {
  const a = ayarlar();
  if (!a) return;
  const zaman = new Date().toISOString();
  const once = (await sistemOku('kontrol').catch(() => null)) || {};
  // Görev 10 dakikada bir çalışır; durum sorgusu da her çalışmada yapılır (eşik, zamanlama kaymalarına karşı 9 dk).
  const sorguZamani = !once.sorguZaman || Date.now() - Date.parse(once.sorguZaman) >= 9 * 60e3;
  const [aktarici, sorgu] = await Promise.all([aktaricidanCek(a), sorguZamani ? durumlariSor(a).catch((e) => ({ hata: e && e.message })) : Promise.resolve(once.sorgu || null)]);
  await sistemYaz('kontrol', {
    zaman, aktarici, sorgu, sorguZaman: sorguZamani ? zaman : once.sorguZaman,
    sonBasarili: aktarici.hata ? once.sonBasarili || null : zaman,
  }).catch((e) => console.error('Kontrol durumu yazılamadı:', e && e.message));
  if (aktarici.hata) console.error('Ödeme kontrolü:', aktarici.hata);
  if (aktarici.kabul || (sorguZamani && sorgu && sorgu.bulundu)) console.log('Ödeme kontrolü: aktarıcıdan', aktarici.kabul, 'bildirim, durum sorgusundan', sorgu.bulundu, 'ödeme kaydedildi');
};
