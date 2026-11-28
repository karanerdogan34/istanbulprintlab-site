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
    const durum = ['basarili', 'mukerrer', 'inceleme'].includes(d.durum) ? 'basarili' : d.durum === 'basarisiz' ? 'basarisiz' : 'bekliyor';
    const ok = durum === 'basarili';
    // Analytics için yalnızca sipariş tutarı, kargo ve ürün açıklaması döner (müşteri bilgisi yok)
    return json({ durum, siparisNo: d.siparisNo, toplam: ok && d.sonuc ? d.sonuc.toplam : null,
      kurus: ok ? d.kurus || null : null, kargoKurus: ok ? d.kargoKurus || 0 : null, urun: ok ? String(d.aciklama || '').slice(0, 100) : null });
  } catch (_) { return json({ durum: 'bekliyor' }); }
};
