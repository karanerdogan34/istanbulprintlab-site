// Ödeme sonuç sayfası, ödemenin gerçekten onaylanıp onaylanmadığını buradan sorar (PayTR'ın yönlendirmesi tek başına kanıt değildir).
// Yalnızca durum bilgisi döner; müşteri bilgisi dönmez.
import { json } from '../lib/ortak.mjs';
import { denemeOku } from '../lib/kayit.mjs';

export default async (req) => {
  const oid = new URL(req.url).searchParams.get('oid') || '';
  if (!/^[A-Z0-9]{8,64}$/.test(oid)) return json({ durum: 'bilinmiyor' }, 400);
  try {
    const d = await denemeOku(oid);
    if (!d) return json({ durum: 'bilinmiyor' }, 404);
    const durum = d.durum === 'basarili' || d.durum === 'mukerrer' ? 'basarili' : d.durum === 'basarisiz' ? 'basarisiz' : 'bekliyor';
    return json({ durum, siparisNo: d.siparisNo, toplam: durum === 'basarili' && d.sonuc ? d.sonuc.toplam : null });
  } catch (_) { return json({ durum: 'bekliyor' }); }
};
