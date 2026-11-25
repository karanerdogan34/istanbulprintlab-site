// Hesaplayıcı: Drive'a yüklenen dosyanın durumu ve sonucu.
//   { durum: 1 }  → yükleme oturumunda kaç bayt alındığını sunucu sorar (tarayıcı Range başlığını okuyamazsa); süresi dolmuşsa yeni oturum açar
//   { id }        → dosya bitti: gerçekten bizim klasörümüzde, bu talebin numarasıyla ve beyan edilen boyutta olduğu doğrulanır, ikinci mail gider
//   { hata }      → yükleme başarısız: "DOSYA YÜKLENEMEDİ" maili
// Gönderilemeyen mailler ve sonucu hiç bildirilmeyen yüklemeler talep-kontrol (zamanlanmış) tarafından tamamlanır.
import crypto from 'node:crypto';
import { json } from '../lib/ortak.mjs';
import { talepOku, talepGuncelle, anahtarDogru, NO_DESENI } from '../lib/talep.mjs';
import { oturumDurumu, yuklemeOturumu } from '../lib/google.mjs';
import { dosyaSonucla, dosyaDogrula } from '../lib/talep-islem.mjs';

export default async (req) => {
  const url = new URL(req.url), kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const no = String(g.no || '');
  if (!NO_DESENI.test(no) || !(await anahtarDogru(no, g.anahtar))) return json({ message: 'İzin yok' }, 403);
  const k = await talepOku(no);
  if (!k || !k.dosya || !k.dosya.oturum) return json({ message: 'Talep bulunamadı' }, 404);
  if (k.dosya.durum === 'tamam') return json({ tamam: true, bitti: true });

  try {
    if (g.durum) {
      const d = await oturumDurumu(k.dosya.oturum, k.dosya.boyut);
      if (d.gecersiz) { // oturumun süresi dolmuş: yeni oturum, yükleme baştan. Yalnızca kilidi alan istek Google'da oturum açar.
        const eski = k.dosya.oturum, simdi = Date.now(), kimlik = crypto.randomUUID();
        const kl = await talepGuncelle(no, (e) => (e.dosya.oturum !== eski || (e.dosya.kilit && simdi - e.dosya.kilit.t < 20000) ? null : { ...e, dosya: { ...e.dosya, kilit: { t: simdi, id: kimlik } } }));
        if (kl.dosya.oturum !== eski) return json({ yeni: kl.dosya.oturum, sonraki: 0 });
        if (!kl.dosya.kilit || kl.dosya.kilit.id !== kimlik) return json({ message: 'Geçici hata' }, 503); // diğer istek yeniliyor; tarayıcı birazdan tekrar sorar
        const o = await yuklemeOturumu({ ad: no + ' - ' + k.dosya.ad, boyut: k.dosya.boyut, tur: k.dosya.tur, aciklama: k.urunAd + ' · ' + k.telefon, origin: url.origin });
        const s = await talepGuncelle(no, (e) => (e.dosya.oturum !== eski ? null : { ...e, dosya: { ...e.dosya, oturum: o.adres, klasor: o.klasorId, kilit: null } }));
        return json({ yeni: s.dosya.oturum, sonraki: 0 });
      }
      if (!d.bitti) return json({ sonraki: d.sonraki });
      if (!d.id) return json({ message: 'Geçici hata' }, 503);
      g = { id: d.id };
    }
    if (g.id) {
      const f = await dosyaDogrula(k, g.id);
      if (!f) return json({ message: 'Dosya doğrulanamadı' }, 409);
      await dosyaSonucla(no, f);
      return json({ tamam: true, bitti: true });
    }
    if (g.hata) {
      // Önce Drive'a sor: tarayıcı hata sansa da dosya tamamlanmış olabilir
      // Önce Drive'a sor; sorulamazsa (geçici hata) durum değiştirilmez, 503 döner ve talep-kontrol sonra tamamlar
      const d = await oturumDurumu(k.dosya.oturum, k.dosya.boyut);
      const f = d.bitti && d.id ? await dosyaDogrula(k, d.id) : null;
      if (!f && d.bitti) return json({ tamam: false }); // dosya Drive'da ama bu talebe uymuyor/doğrulanamadı: talep-kontrol bakar
      await dosyaSonucla(no, f || { hata: g.hata });
      return json({ tamam: !!f, bitti: !!f });
    }
  } catch (e) {
    console.error('Dosya durumu işlenemedi:', no, e && e.message);
    return json({ message: 'Geçici hata' }, 503);
  }
  return json({ message: 'Geçersiz istek' }, 400);
};
