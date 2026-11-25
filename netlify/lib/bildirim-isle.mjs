// PayTR ödeme sonucunu işleyen ortak mantık. Üç kaynaktan çağrılır:
//   1) paytr-bildirim  : Türkiye'deki aktarıcıdan (odeme.istanbulprintlab.com) gelen bildirim (PayTR imzası doğrulanır)
//   2) aktarici-cek    : aktarıcı kuyruğundan çekilen bildirim (PayTR imzası doğrulanır)
//   3) durum-sorgu     : PayTR Durum Sorgu API'den sunucunun kendisinin aldığı sonuç (güvenilir kaynak, imza yok)
// Aynı ödeme birden çok kaynaktan, eş zamanlı gelse bile bir kez işlenir (atomik güncelleme).
import { bildirimGecerli } from './paytr.mjs';
import { denemeOku, denemeAtomik, linkOku, linkAtomik } from './kayit.mjs';

const SONLANMIS = new Set(['basarili', 'basarisiz', 'mukerrer', 'inceleme']);

// p: { merchant_oid, status, total_amount, hash?, installment_count?, payment_type?, test_mode?, failed_reason_code?, failed_reason_msg? }
// Dönüş: { kod: 200|400|500, metin }
export async function bildirimIsle(a, p, { guvenilir = false, kaynak = 'bildirim' } = {}) {
  if (!/^[A-Za-z0-9]{1,64}$/.test(String(p.merchant_oid || ''))) return { kod: 400, metin: 'PAYTR notification failed: bad oid' };
  if (!guvenilir && !bildirimGecerli(a, p)) return { kod: 400, metin: 'PAYTR notification failed: bad hash' };
  const oid = p.merchant_oid;
  try {
    const ilk = await denemeOku(oid);
    if (!ilk) { console.error('PayTR sonucu: kayıtsız sipariş', oid, p.status, kaynak); return { kod: 200, metin: 'OK' }; }
    const zaman = new Date().toISOString();

    if (p.status === 'success') {
      // 1) Deneme kaydını atomik olarak sonuçlandır (zaten sonuçlanmışsa dokunma).
      let sonDurum = null, linkId = ilk.linkId;
      for (let i = 0; i < 5; i++) {
        const r = await denemeAtomik(oid, async (d) => {
          if (SONLANMIS.has(d.durum) && d.durum !== 'basarisiz') { sonDurum = d.durum; return null; }
          const odenen = parseInt(p.total_amount, 10);
          const tutarUyumlu = Number.isFinite(odenen) && odenen >= d.kurus;
          const k = await linkOku(d.linkId);
          const mukerrer = !!(k && k.durum === 'odendi' && k.odemeOid !== oid);
          const iptalSonrasi = !!(k && k.durum === 'iptal');
          const durum = mukerrer ? 'mukerrer' : (!tutarUyumlu || iptalSonrasi) ? 'inceleme' : 'basarili';
          const not = mukerrer ? 'Aynı siparişe ikinci ödeme — iade gerekebilir' : !tutarUyumlu ? 'Ödenen tutar sipariş tutarından düşük' : iptalSonrasi ? 'İptal edilmiş linke ödeme — iade gerekebilir' : '';
          sonDurum = durum;
          return { ...d, durum, sonuc: { zaman, toplam: odenen, siparisTutari: d.kurus, taksit: String(p.installment_count || '1'), odemeTuru: p.payment_type || '', tutarUyumlu, test: String(p.test_mode) === '1', not, kaynak } };
        });
        if (r.tamam || sonDurum) break;
      }
      if (!sonDurum) throw new Error('deneme kaydı güncellenemedi');
      console.log('PayTR:', sonDurum, oid, ilk.siparisNo, 'kaynak:', kaynak, String(p.test_mode) === '1' ? '(TEST)' : '');
      if (sonDurum !== 'basarili') return { kod: 200, metin: 'OK' };
      // 2) Bağlantıyı "ödendi" yap (önceki işlemde yarım kaldıysa burada tamamlanır).
      // Bağlantı güncellenemezse 500 dönülür; bildirim tekrar geldiğinde (deneme zaten 'basarili') burada tamamlanır.
      let linkTamam = false;
      for (let i = 0; i < 3 && !linkTamam; i++) {
        const r = await linkAtomik(linkId, (k) => (k.durum === 'odendi' ? null : { ...k, durum: 'odendi', odemeOid: oid, odemeZaman: zaman }));
        linkTamam = r.tamam || !r.kayit || r.kayit.durum === 'odendi';
      }
      if (!linkTamam) throw new Error('bağlantı ödendi olarak işaretlenemedi');
    } else {
      await denemeAtomik(oid, async (d) => (SONLANMIS.has(d.durum) ? null
        : { ...d, durum: 'basarisiz', sonuc: { zaman, kod: p.failed_reason_code || '', mesaj: String(p.failed_reason_msg || '').slice(0, 200), kaynak } }));
      console.log('PayTR: ödeme başarısız', oid, p.failed_reason_code || '', 'kaynak:', kaynak);
    }
  } catch (e) {
    console.error('PayTR sonucu kaydedilemedi, tekrar denenecek:', oid, e && e.message);
    return { kod: 500, metin: 'kayit hatasi' };
  }
  return { kod: 200, metin: 'OK' };
}
