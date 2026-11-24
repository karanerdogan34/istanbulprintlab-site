// PayTR Bildirim URL'si (callback). Mağaza Paneli > Ayarlar'daki "Bildirim URL" alanına şu adres yazılır:
//   https://www.istanbulprintlab.com/.netlify/functions/paytr-bildirim
// İmza doğrulanır, sonuç kalıcı olarak kaydedilir ve ancak ondan sonra "OK" dönülür (OK dönülmezse PayTR bildirimi tekrar gönderir).
// Aynı bildirim birden çok kez gelirse ikinci kez işlenmez. Loglara müşteri bilgisi yazılmaz.
import { ayarlar, bildirimGecerli } from '../lib/paytr.mjs';
import { denemeOku, denemeYaz, linkOku, linkYaz } from '../lib/kayit.mjs';

const OK = () => new Response('OK', { headers: { 'Content-Type': 'text/plain' } });

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = ayarlar();
  if (!a) return new Response('Yapilandirma eksik', { status: 500 });
  const p = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!/^[A-Za-z0-9]{1,64}$/.test(String(p.merchant_oid || '')) || !bildirimGecerli(a, p)) {
    console.error('PayTR bildirimi reddedildi (imza/biçim)');
    return new Response('PAYTR notification failed: bad hash', { status: 400 });
  }
  const oid = p.merchant_oid;
  try {
    const d = await denemeOku(oid);
    if (!d) { console.error('PayTR bildirimi: kayıtsız sipariş', oid, p.status); return OK(); }
    if (d.durum === 'basarili' || d.durum === 'basarisiz' || d.durum === 'mukerrer') return OK(); // tekrar gelen bildirim
    const zaman = new Date().toISOString();
    if (p.status === 'success') {
      const odenen = parseInt(p.total_amount, 10);
      // Tahsil edilen tutar sipariş tutarından az olamaz (taksitte vade farkı nedeniyle fazla olabilir).
      const tutarUyumlu = Number.isFinite(odenen) && odenen >= d.kurus;
      const k = await linkOku(d.linkId);
      const mukerrer = k && k.durum === 'odendi' && k.odemeOid !== oid;
      await denemeYaz(oid, { ...d, durum: mukerrer ? 'mukerrer' : 'basarili', sonuc: { zaman, toplam: odenen, siparisTutari: d.kurus, taksit: p.installment_count || '1', odemeTuru: p.payment_type || '', tutarUyumlu, test: p.test_mode === '1' } });
      if (k && !mukerrer) await linkYaz(d.linkId, { ...k, durum: 'odendi', odemeOid: oid, odemeZaman: zaman });
      console.log(mukerrer ? 'PayTR: MÜKERRER ÖDEME — iade gerekebilir' : 'PayTR: ödeme başarılı', oid, d.siparisNo, 'toplam(kuruş):', odenen, tutarUyumlu ? '' : 'TUTAR UYUŞMAZLIĞI', p.test_mode === '1' ? '(TEST)' : '');
    } else {
      await denemeYaz(oid, { ...d, durum: 'basarisiz', sonuc: { zaman, kod: p.failed_reason_code || '', mesaj: String(p.failed_reason_msg || '').slice(0, 200) } });
      console.log('PayTR: ödeme başarısız', oid, p.failed_reason_code || '');
    }
  } catch (e) {
    console.error('PayTR bildirimi kaydedilemedi, PayTR tekrar deneyecek:', oid, e && e.message);
    return new Response('kayit hatasi', { status: 500 });
  }
  return OK();
};
