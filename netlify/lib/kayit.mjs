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
    };
  }
  return getStore({ name: 'odemeler', consistency: 'strong' });
};

export const linkOku = (id) => depo().get('link/' + id, { type: 'json' });
export const linkYaz = (id, v) => depo().setJSON('link/' + id, v);
export const denemeOku = (oid) => depo().get('deneme/' + oid, { type: 'json' });
export const denemeYaz = (oid, v) => depo().setJSON('deneme/' + oid, v);
