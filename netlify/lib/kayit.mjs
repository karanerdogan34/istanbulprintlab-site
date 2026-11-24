// Ödeme kayıtları: Netlify Blobs (sitenin kendi, ücretsiz anahtar-değer deposu). Ayrı veritabanı hizmeti gerekmez.
//   link/<id>    : ödeme bağlantısı (sipariş no, tutar, taksit sınırı, bitiş, durum: bekliyor | odendi | iptal)
//   deneme/<oid> : her ödeme denemesi (bağlantı, müşteri ve fatura bilgisi, sözleşme onayı kanıtı, PayTR sonucu)
import { getStore } from '@netlify/blobs';

let bellek = null; // yalnızca yerel testlerde kullanılır
const depo = () => {
  if (process.env.IPL_TEST_BELLEK === '1') {
    bellek = bellek || new Map();
    return {
      get: async (k) => (bellek.has(k) ? JSON.parse(bellek.get(k)) : null),
      setJSON: async (k, v) => { bellek.set(k, JSON.stringify(v)); },
      list: async ({ prefix }) => ({ blobs: [...bellek.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    };
  }
  return getStore({ name: 'odemeler', consistency: 'strong' });
};

export const linkOku = (id) => depo().get('link/' + id, { type: 'json' });
export const linkYaz = (id, v) => depo().setJSON('link/' + id, v);
export const denemeOku = (oid) => depo().get('deneme/' + oid, { type: 'json' });
export const denemeYaz = (oid, v) => depo().setJSON('deneme/' + oid, v);

// Yönetim listesi için son denemeler (en yeni önce). Kayıt sayısı küçük olduğu için tamamı okunur, en fazla 200.
export async function sonDenemeler(sinir = 200) {
  const d = depo();
  const { blobs } = await d.list({ prefix: 'deneme/' });
  const hepsi = await Promise.all(blobs.slice(-1000).map((b) => d.get(b.key, { type: 'json' })));
  return hepsi.filter(Boolean).sort((x, y) => String(y.zaman).localeCompare(String(x.zaman))).slice(0, sinir);
}
