/* IPL fiyat motoru — tarayıcıda ve sunucuda (Netlify Function) aynı kod çalışır.
   Sunucu, ödeme öncesi fiyatı bu motorla yeniden hesaplar; tarayıcıdaki tutara güvenilmez. */
(function (kok) {
  'use strict';

  function yuvarla(x) { return Math.round(x * 100) / 100; }

  function sayi(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  // Rulo ürünler: folyo, branda, sticker, one way vision, mesh, afiş, poster
  function ruloHesapla(cfg, genel, g) {
    var hatalar = [], teklif = null, uyarilar = [];
    var en = sayi(g.en), boy = sayi(g.boy), adet = sayi(g.adet);
    if (!(en > 0)) hatalar.push({alan: 'en', mesaj: 'Genişliği santimetre olarak girin (ör. 120).'});
    if (!(boy > 0)) hatalar.push({alan: 'boy', mesaj: 'Yüksekliği santimetre olarak girin (ör. 80).'});
    if (!(adet >= 1) || Math.floor(adet) !== adet) hatalar.push({alan: 'adet', mesaj: 'Adet 1 veya daha büyük bir tam sayı olmalı.'});
    var malz = null;
    for (var i = 0; i < cfg.malzemeler.length; i++) if (cfg.malzemeler[i].kod === g.malzeme) malz = cfg.malzemeler[i];
    if (!malz) hatalar.push({alan: 'malzeme', mesaj: 'Malzeme seçin.'});
    var lam = g.laminasyon || 'yok';
    if (cfg.laminasyon && cfg.laminasyon.secenekler.indexOf(lam) < 0) hatalar.push({alan: 'laminasyon', mesaj: 'Laminasyon seçin.'});
    if (hatalar.length) return {durum: 'hata', hatalar: hatalar};

    var kisa = Math.min(en, boy), uzun = Math.max(en, boy);
    if (kisa > cfg.net_en) {
      teklif = 'Bu ölçü tek parça üretilemez: iki kenar da ' + cfg.net_en + ' cm\'yi aşıyor. Kenarlardan en az biri en fazla ' + cfg.net_en + ' cm olmalı. Daha büyük işler parçalı üretilir; bunun için teklif alın.';
    } else if (uzun > genel.tek_parca_max_boy) {
      teklif = 'Tek parça en fazla ' + (genel.tek_parca_max_boy / 100) + ' m üretilir. Daha uzun işler parçalı üretilir; bunun için teklif alın.';
    }
    if (malz && malz.uyari) uyarilar.push(malz.uyari);
    if (teklif) return {durum: 'teklif', mesaj: teklif, uyarilar: uyarilar};

    var m2Parca = en * boy / 10000;
    var m2 = m2Parca * adet;
    var baski = m2 * malz.m2;
    var tamamlama = baski < genel.asgari_baski ? genel.asgari_baski - baski : 0;
    var lamBedel = (lam !== 'yok') ? m2 * malz.m2 * (cfg.laminasyon.carpan - 1) : 0;
    var araToplam = baski + tamamlama + lamBedel;
    var kdv = araToplam * genel.kdv_orani;
    return {
      durum: 'tamam',
      uyarilar: uyarilar,
      kalemler: {
        m2: yuvarla(m2), m2Parca: yuvarla(m2Parca), birimM2: malz.m2,
        baski: yuvarla(baski), asgariFarki: yuvarla(tamamlama), laminasyon: yuvarla(lamBedel)
      },
      araToplam: yuvarla(araToplam), kdv: yuvarla(kdv), toplam: yuvarla(araToplam + kdv),
      kargoUcretsiz: araToplam >= genel.kargo_ucretsiz_esik
    };
  }

  // Dosya uygunluğu: gerçek baskı ölçüsündeki efektif PPI ve oran kontrolü
  function dosyaKontrol(cfg, px, enCm, boyCm) {
    var enIn = enCm / 2.54, boyIn = boyCm / 2.54;
    var dikey = (px.h >= px.w) === (boyCm >= enCm);
    var pw = dikey ? px.w : px.h, ph = dikey ? px.h : px.w;
    var ppi = Math.min(pw / enIn, ph / boyIn);
    var oranDosya = pw / ph, oranBaski = enCm / boyCm;
    var sapma = Math.abs(oranDosya - oranBaski) / oranBaski;
    var sonuc = ppi >= cfg.ppi.uygun ? 'uygun' : (ppi >= cfg.ppi.uyari ? 'inceleme' : 'uygun-degil');
    return {ppi: Math.round(ppi), sonuc: sonuc, oranSapma: Math.round(sapma * 100), dondur: !dikey};
  }

  function hesapla(fiyatlar, urunKod, girdi) {
    var cfg = fiyatlar.urunler[urunKod];
    if (!cfg) return {durum: 'hata', hatalar: [{alan: 'urun', mesaj: 'Ürün bulunamadı.'}]};
    if (cfg.tur === 'rulo') return ruloHesapla(cfg, fiyatlar.genel, girdi);
    return {durum: 'hata', hatalar: [{alan: 'urun', mesaj: 'Bu ürün türü henüz tanımlı değil.'}]};
  }

  var M = {hesapla: hesapla, dosyaKontrol: dosyaKontrol, sayi: sayi};
  if (typeof module === 'object' && module.exports) module.exports = M; else kok.IPLMotor = M;
})(typeof self !== 'undefined' ? self : this);
