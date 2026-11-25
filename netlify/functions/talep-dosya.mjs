// Hesaplayıcı: tarayıcının Drive'a yüklediği dosyanın sonucunu bildirir (tamam / hata). Dosyanın gerçekten bizim klasörümüzde,
// bu talebin numarasıyla ve beyan edilen boyutta olduğu Drive'dan doğrulanır; sonra info@ adresine dosya linkiyle ikinci mail gider.
import { json } from '../lib/ortak.mjs';
import { talepOku, talepYaz, anahtarDogru, mailMetni } from '../lib/talep.mjs';
import { dosyaBilgisi, mailGonder } from '../lib/google.mjs';

export default async (req) => {
  const url = new URL(req.url), kaynak = req.headers.get('origin');
  if (req.method !== 'POST' || !kaynak || kaynak !== url.origin || !(req.headers.get('content-type') || '').startsWith('application/json')) return json({ message: 'İzin yok' }, 403);
  let g;
  try { g = await req.json(); } catch (_) { return json({ message: 'Geçersiz istek' }, 400); }
  const no = String(g.no || '');
  if (!/^T\d{6}-[A-Z0-9]{4}$/.test(no) || !anahtarDogru(no, g.anahtar)) return json({ message: 'İzin yok' }, 403);
  const k = await talepOku(no);
  if (!k || !k.dosya || k.dosya.durum === 'yok') return json({ message: 'Talep bulunamadı' }, 404);
  if (k.dosya.durum === 'tamam') return json({ tamam: true });

  let konu;
  if (g.id) {
    const f = await dosyaBilgisi(g.id).catch(() => null);
    const uygun = f && !f.trashed && (f.parents || []).includes(k.dosya.klasor) && String(f.name || '').startsWith(no + ' - ') && Number(f.size) === Number(k.dosya.boyut);
    if (!uygun) return json({ message: 'Dosya doğrulanamadı' }, 409);
    k.dosya = { ...k.dosya, durum: 'tamam', id: f.id, link: f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view') };
    konu = 'Dosya geldi ' + no + ' — ' + k.urunAd + ' — ' + k.telefon;
  } else {
    if (k.dosya.durum === 'hata') return json({ tamam: true }); // aynı hata için ikinci mail atılmaz
    k.dosya = { ...k.dosya, durum: 'hata', hata: String(g.hata || '').slice(0, 200) };
    konu = 'DOSYA YÜKLENEMEDİ ' + no + ' — ' + k.urunAd + ' — ' + k.telefon;
  }
  await talepYaz(no, k);
  try {
    await mailGonder({ konu, metin: mailMetni(k) });
    k.mail = { ...k.mail, ilk: true, dosya: true }; await talepYaz(no, k);
  } catch (e) { console.error('Dosya maili gönderilemedi:', no, e && e.message); }
  return json({ tamam: true });
};
