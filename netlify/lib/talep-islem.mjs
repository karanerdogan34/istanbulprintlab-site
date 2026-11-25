// Talep işlemleri (fonksiyonlar ve zamanlanmış kontrol ortak kullanır): bildirim mailleri ve dosya sonucunun kaydı.
import { talepOku, talepGuncelle, mailMetni } from './talep.mjs';
import { dosyaBilgisi, mailGonder } from './google.mjs';

// İlk bildirim maili (talep düşer düşmez); gönderildiyse tekrar gönderilmez
export async function ilkMail(no) {
  const k = await talepOku(no);
  if (!k || k.mail.ilk) return;
  await mailGonder({ konu: 'Yeni sipariş talebi ' + k.no + ' — ' + k.urunAd + ' — ' + k.telefon, metin: mailMetni(k) });
  await talepGuncelle(no, (e) => ({ ...e, mail: { ...e.mail, ilk: true } }));
}


const temiz = (s, n) => String(s || '').replace(/[<>\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Dosya sonucunu kaydeder ve ikinci maili gönderir (talep-kontrol da kullanır)
export async function dosyaSonucla(no, sonuc) {
  let k = await talepGuncelle(no, (e) => {
    if (!e.dosya || e.dosya.durum === 'tamam' || (sonuc.hata && e.dosya.durum === 'hata')) return null;
    return { ...e, dosya: sonuc.id ? { ...e.dosya, durum: 'tamam', id: sonuc.id, link: sonuc.link } : { ...e.dosya, durum: 'hata', hata: temiz(sonuc.hata, 200) } };
  });
  if (!k || k.mail.dosya || !['tamam', 'hata'].includes(k.dosya.durum)) return k;
  // Kayıt hatası yukarı iletilir (çağıran 503 döner); mail hatası kaydı bozmaz, talep-kontrol tekrar dener.
  const d = k.dosya;
  const konu = (d.durum === 'tamam' ? 'Dosya geldi ' : 'DOSYA YÜKLENEMEDİ ') + no + ' — ' + k.urunAd + ' — ' + k.telefon;
  try { await mailGonder({ konu, metin: mailMetni(k) }); } catch (e) { console.error('Dosya maili gönderilemedi:', no, e && e.message); return k; }
  return talepGuncelle(no, (e) => ({ ...e, mail: { ...e.mail, ilk: true, dosya: true } }));
}

// Drive'daki dosyanın bu talebe ait olduğunu doğrular. null = dosya uygun değil (kalıcı); geçici Drive hatası istisna fırlatır.
export async function dosyaDogrula(k, id) {
  const f = await dosyaBilgisi(id);
  const uygun = f && !f.trashed && (f.parents || []).includes(k.dosya.klasor) && String(f.name || '').startsWith(k.no + ' - ') && Number(f.size) === Number(k.dosya.boyut);
  return uygun ? { id: f.id, link: f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view') } : null;
}

