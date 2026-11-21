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
    var lam = cfg.laminasyon ? (g.laminasyon || 'yok') : 'yok';
    if (cfg.laminasyon && cfg.laminasyon.secenekler.indexOf(lam) < 0) hatalar.push({alan: 'laminasyon', mesaj: 'Laminasyon seçin.'});
    if (hatalar.length) return {durum: 'hata', hatalar: hatalar};

    var kisa = Math.min(en, boy), uzun = Math.max(en, boy);
    if (kisa > cfg.net_en) {
      teklif = 'Bu ölçü tek parça üretilemez: iki kenar da ' + cfg.net_en + ' cm\'yi aşıyor. Kenarlardan en az biri en fazla ' + cfg.net_en + ' cm olmalı. Daha büyük işler parçalı üretilir; bunun için teklif alın.';
    } else if (uzun > genel.tek_parca_max_boy) {
      teklif = 'Tek parça en fazla ' + (genel.tek_parca_max_boy / 100) + ' metre üretilir. Daha uzun işler parçalı üretilir; bunun için teklif alın.';
    }
    if (malz && malz.uyari) uyarilar.push(malz.uyari);
    if (teklif) return {durum: 'teklif', mesaj: teklif, uyarilar: uyarilar};

    var m2Parca = en * boy / 10000;
    var m2 = m2Parca * adet;
    var baski = m2 * malz.m2;
    var tamamlama = baski < genel.asgari_baski ? genel.asgari_baski - baski : 0;
    var lamBedel = (cfg.laminasyon && lam !== 'yok') ? m2 * malz.m2 * (cfg.laminasyon.carpan - 1) : 0;
    var kgAdet = 0, kgBedel = 0;
    if (cfg.kusgozu) {
      kgAdet = sayi(g.kusgozu || 0);
      if (!(kgAdet >= 0) || Math.floor(kgAdet) !== kgAdet) return {durum: 'hata', hatalar: [{alan: 'kusgozu', mesaj: 'Kuşgözü adedi 0 veya daha büyük bir tam sayı olmalı.'}]};
      if (kgAdet > 0 && kgAdet < 4) return {durum: 'hata', hatalar: [{alan: 'kusgozu', mesaj: 'Kuşgözü en az 4 adet olmalı (her köşeye bir tane), ya da 0 yazın.'}]};
      kgBedel = kgAdet * adet * cfg.kusgozu.fiyat;
    }
    var araToplam = baski + tamamlama + lamBedel + kgBedel;
    var kdv = araToplam * genel.kdv_orani;
    return {
      durum: 'tamam',
      uyarilar: uyarilar,
      kalemler: {
        m2: yuvarla(m2), m2Parca: yuvarla(m2Parca), birimM2: malz.m2,
        baski: yuvarla(baski), asgariFarki: yuvarla(tamamlama), laminasyon: yuvarla(lamBedel),
        kusgozuAdet: kgAdet * adet, kusgozu: yuvarla(kgBedel)
      },
      araToplam: yuvarla(araToplam), kdv: yuvarla(kdv), toplam: yuvarla(araToplam + kdv),
      kargoUcretsiz: araToplam >= genel.kargo_ucretsiz_esik && !(cfg.kargo_max_m2 && m2 > cfg.kargo_max_m2),
      kargoAyrica: !!(cfg.kargo_max_m2 && m2 > cfg.kargo_max_m2)
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

  // Kesimli ürünler (sticker/etiket): şekil + parça ölçüsü + adet → rulo hesabına çevrilir
  function kesimHesapla(cfg, genel, g) {
    var K = cfg.kesim, sekil = g.sekil || 'dikdortgen';
    if (sekil === 'ozel') return {durum: 'teklif', mesaj: K.ozel_mesaj, uyarilar: []};
    var en = sayi(g.en), boy = sekil === 'dikdortgen' ? sayi(g.boy) : en, adet = sayi(g.adet), hatalar = [];
    var etiket = sekil === 'yuvarlak' ? 'Çapı' : (sekil === 'kare' ? 'Kenar uzunluğunu' : 'Genişliği');
    if (!(en > 0)) hatalar.push({alan: 'en', mesaj: etiket + ' santimetre olarak girin.'});
    if (sekil === 'dikdortgen' && !(boy > 0)) hatalar.push({alan: 'boy', mesaj: 'Yüksekliği santimetre olarak girin.'});
    if (!(adet >= 1) || Math.floor(adet) !== adet) hatalar.push({alan: 'adet', mesaj: 'Adet 1 veya daha büyük bir tam sayı olmalı.'});
    if (hatalar.length) return {durum: 'hata', hatalar: hatalar};
    if (Math.min(en, boy) < K.min_cm) return {durum: 'teklif', mesaj: K.min_cm + ' cm\'den küçük kesimler standart fiyatlandırmanın dışındadır. Bu iş için teklif alın.', uyarilar: []};
    if (adet > K.max_adet) return {durum: 'teklif', mesaj: K.max_adet + ' adetten fazla kesimli sticker siparişleri teklifle fiyatlandırılır. Bu iş için teklif alın.', uyarilar: []};
    var r = ruloHesapla(cfg, genel, {malzeme: g.malzeme, laminasyon: g.laminasyon, en: en, boy: boy, adet: adet});
    if (r.durum === 'tamam') { r.kalemler.sekil = sekil; r.kalemler.parca = sekil === 'yuvarlak' ? ('Ø ' + en + ' cm') : (en + ' × ' + boy + ' cm'); }
    return r;
  }

  function hesapla(fiyatlar, urunKod, girdi) {
    var cfg = fiyatlar.urunler[urunKod];
    if (!cfg) return {durum: 'hata', hatalar: [{alan: 'urun', mesaj: 'Ürün bulunamadı.'}]};
    if (cfg.tur === 'rulo' && cfg.kesim) return kesimHesapla(cfg, fiyatlar.genel, girdi);
    if (cfg.tur === 'rulo') return ruloHesapla(cfg, fiyatlar.genel, girdi);
    return {durum: 'hata', hatalar: [{alan: 'urun', mesaj: 'Bu ürün türü henüz tanımlı değil.'}]};
  }

  var M = {hesapla: hesapla, dosyaKontrol: dosyaKontrol, sayi: sayi};
  if (typeof module === 'object' && module.exports) module.exports = M; else kok.IPLMotor = M;
})(typeof self !== 'undefined' ? self : this);
