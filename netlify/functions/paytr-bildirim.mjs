// PayTR Bildirim URL'si (callback). Mağaza Paneli > Ayarlar'daki "Bildirim URL" alanına şu adres yazılır:
//   https://www.istanbulprintlab.com/.netlify/functions/paytr-bildirim
// PayTR her ödeme sonucunu buraya gönderir; imza doğrulanır ve "OK" dönülür (OK dönülmezse PayTR tekrar dener).
// Başarılı ödemeler ayrıca PayTR tarafından e-postayla bildirilir ve Mağaza Paneli'nde görünür.
import { ayarlar, bildirimGecerli } from '../lib/paytr.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = ayarlar();
  if (!a) return new Response('Yapilandirma eksik', { status: 500 });
  const p = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!bildirimGecerli(a, p)) {
    console.error('PayTR bildirimi: imza tutmadı', p.merchant_oid);
    return new Response('PAYTR notification failed: bad hash', { status: 400 });
  }
  if (p.status === 'success') {
    console.log('PayTR ödeme başarılı:', p.merchant_oid, 'tutar(kuruş):', p.total_amount, 'taksit:', p.installment_count || '1', p.test_mode === '1' ? '(TEST)' : '');
  } else {
    console.log('PayTR ödeme başarısız:', p.merchant_oid, p.failed_reason_code, p.failed_reason_msg);
  }
  return new Response('OK', { headers: { 'Content-Type': 'text/plain' } });
};
