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
      getWithMetadata: async (k) => (bellek.has(k) ? { data: JSON.parse(bellek.get(k)), etag: String(bellek.get(k).length) + bellek.get(k).slice(-8) } : null),
      setJSON: async (k, v, o = {}) => {
        if (o.onlyIfMatch) { const e = bellek.has(k) ? String(bellek.get(k).length) + bellek.get(k).slice(-8) : null; if (e !== o.onlyIfMatch) return { modified: false }; }
        bellek.set(k, JSON.stringify(v)); return { modified: true };
      },
      list: async ({ prefix }) => ({ blobs: [...bellek.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    };
  }
  return getStore({ name: 'odemeler', consistency: 'strong' });
};

export const linkOku = (id) => depo().get('link/' + id, { type: 'json' });
export const linkYaz = (id, v) => depo().setJSON('link/' + id, v);
// Bağlantı kaydını atomik günceller: okunduğu andan beri başka bir istek değiştirdiyse yazmaz (eş zamanlı ödeme denemelerine karşı).
// guncelle(eski) → yeni kayıt ya da null (vazgeç). Dönüş: { tamam, kayit }.
export async function linkAtomik(id, guncelle) {
  const d = depo();
  const o = await d.getWithMetadata('link/' + id, { type: 'json' });
  if (!o || !o.data) return { tamam: false, kayit: null };
  const yeni = guncelle(o.data);
  if (!yeni) return { tamam: false, kayit: o.data };
  const r = await d.setJSON('link/' + id, yeni, { onlyIfMatch: o.etag });
  return { tamam: !!(r && r.modified), kayit: yeni };
}
export const denemeOku = (oid) => depo().get('deneme/' + oid, { type: 'json' });
export const denemeYaz = (oid, v) => depo().setJSON('deneme/' + oid, v);
// Deneme kaydını atomik günceller (aynı ödeme sonucu farklı kaynaklardan eş zamanlı gelirse bir kez işlenir).
// guncelle(eski) → (async) yeni kayıt ya da null (vazgeç). Dönüş: { tamam, kayit }.
export async function denemeAtomik(oid, guncelle) {
  const d = depo();
  const o = await d.getWithMetadata('deneme/' + oid, { type: 'json' });
  if (!o || !o.data) return { tamam: false, kayit: null };
  const yeni = await guncelle(o.data);
  if (!yeni) return { tamam: false, kayit: o.data };
  const r = await d.setJSON('deneme/' + oid, yeni, { onlyIfMatch: o.etag });
  return { tamam: !!(r && r.modified), kayit: yeni };
}
// Sistem durumu (aktarıcı kontrolü vb.) — yönetim panelinde uyarı göstermek için.
export const sistemOku = (ad) => depo().get('sistem/' + ad, { type: 'json' });
export const sistemYaz = (ad, v) => depo().setJSON('sistem/' + ad, v);

// Yönetim listesi için son denemeler (en yeni önce). Kayıt sayısı küçük olduğu için tamamı okunur, en fazla 200.
export async function sonDenemeler(sinir = 200) {
  const d = depo();
  const { blobs } = await d.list({ prefix: 'deneme/' });
  const hepsi = await Promise.all(blobs.slice(-1000).map((b) => d.get(b.key, { type: 'json' })));
  return hepsi.filter(Boolean).sort((x, y) => String(y.zaman).localeCompare(String(x.zaman))).slice(0, sinir);
}
