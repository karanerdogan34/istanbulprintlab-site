// Zamanlanmış kontrol (15 dakikada bir): hiçbir talep sessizce kaybolmasın diye
//  • gönderilemeyen ilk bildirim maillerini tekrar dener,
//  • sonucu tarayıcıdan bildirilmeyen yüklemeleri (sayfa kapandı, bağlantı koptu) Drive'a sorup tamamlar ya da "YÜKLENEMEDİ" olarak bildirir,
//  • dosya sonucu kaydedilmiş ama maili gidememiş talepler için maili tekrar dener.
// Yalnızca son 3 günün talepleri okunur.
import { yakinTalepler } from '../lib/talep.mjs';
import { baglantiDurumu, oturumDurumu } from '../lib/google.mjs';
import { ilkMail, dosyaSonucla, dosyaDogrula } from '../lib/talep-islem.mjs';

const DK = 60e3;

export default async () => {
  if (!(await baglantiDurumu()).bagli) return new Response('Google bağlı değil');
  const L = await yakinTalepler(3), simdi = Date.now();
  let islenen = 0;
  for (const k of L) {
    const yas = simdi - Date.parse(k.zaman);
    try {
      if (!k.mail.ilk && yas > 2 * DK) { await ilkMail(k.no); islenen++; }
      const d = k.dosya || {};
      if (d.durum === 'yukleniyor' && d.oturum && yas > 30 * DK) {
        const o = await oturumDurumu(d.oturum, d.boyut).catch(() => null);
        if (o && o.bitti && o.id) { const f = await dosyaDogrula(k, o.id); await dosyaSonucla(k.no, f || { hata: 'Drive\'daki dosya doğrulanamadı' }); islenen++; } // geçici Drive hatası istisna fırlatır: sonraki turda tekrar denenir
        else if (yas > 3 * 60 * DK || (o && o.gecersiz)) { await dosyaSonucla(k.no, { hata: 'Yükleme tamamlanmadı (müşteri sayfadan ayrıldı ya da bağlantı koptu)' }); islenen++; }
      } else if ((d.durum === 'tamam' || d.durum === 'hata') && !k.mail.dosya) { await dosyaSonucla(k.no, d.durum === 'tamam' ? { id: d.id, link: d.link } : { hata: d.hata || 'hata' }); islenen++; }
    } catch (e) { console.error('Talep kontrolü:', k.no, e && e.message); }
  }
  return new Response('Kontrol edilen: ' + L.length + ', işlenen: ' + islenen);
};

export const config = { schedule: '*/15 * * * *' };
