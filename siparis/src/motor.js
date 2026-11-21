/* IPL fiyat motoru — tarayıcıda ve sunucuda (Netlify Function) aynı kod çalışır.
   Sunucu, ödeme öncesi fiyatı bu motorla yeniden hesaplar; tarayıcıdaki tutara güvenilmez. */
(function (kok) {
  'use strict';

  function yuvarla(x) { var v = Number(Math.abs(x).toFixed(6)); var r = Number(Math.round(Number(v + 'e2')) + 'e-2'); return x < 0 ? -r : r; } // kuruşta yarım yukarı

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
    var cer = null;
    if (cfg.cerceve && g.cerceve && g.cerceve !== 'yok') {
      var olc = null, rnk = null;
      for (var a = 0; a < cfg.cerceve.olculer.length; a++) if (cfg.cerceve.olculer[a].kod === g.cerceve) olc = cfg.cerceve.olculer[a];
      for (var b = 0; b < cfg.cerceve.renkler.length; b++) if (cfg.cerceve.renkler[b].kod === g.cerceveRenk) rnk = cfg.cerceve.renkler[b];
      if (!olc) return {durum: 'hata', hatalar: [{alan: 'cerceve', mesaj: 'Çerçeve ölçüsü seçin.'}]};
      if (!rnk) return {durum: 'hata', hatalar: [{alan: 'cerceve', mesaj: 'Çerçeve rengi seçin.'}]};
      cer = {ad: olc.ad + ' ' + rnk.ad, fiyat: olc.fiyat[rnk.grup]};
      g = {malzeme: g.malzeme, laminasyon: g.laminasyon, en: olc.en, boy: olc.boy, adet: g.adet};
    }
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

    if (cfg.sekiller && g.sekil === 'ozel') return {durum: 'teklif', mesaj: cfg.ozel_mesaj, uyarilar: []};
    var kisa = Math.min(en, boy), uzun = Math.max(en, boy);
    var netEn = (malz && malz.net_en) || cfg.net_en;
    if (cfg.max_boy && (kisa > cfg.net_en || uzun > cfg.max_boy)) {
      teklif = 'Tek parça en fazla ' + cfg.net_en + ' × ' + cfg.max_boy + ' cm üretilir. Daha büyük işler birden fazla parçadan oluşur; bunun için teklif alın.';
    } else if (kisa > netEn) {
      teklif = 'Bu ölçü tek parça üretilemez: iki kenar da ' + netEn + ' cm\'yi aşıyor. Kenarlardan en az biri en fazla ' + netEn + ' cm olmalı. Daha büyük işler parçalı üretilir; bunun için teklif alın.';
    } else if (uzun > genel.tek_parca_max_boy) {
      teklif = 'Tek parça en fazla ' + (genel.tek_parca_max_boy / 100) + ' metre üretilir. Daha uzun işler parçalı üretilir; bunun için teklif alın.';
    }
    if (malz && malz.uyari) uyarilar.push(malz.uyari);
    if (teklif) return {durum: 'teklif', mesaj: teklif, uyarilar: uyarilar};

    var m2Parca = en * boy / 10000;
    var m2 = m2Parca * adet;
    var baski = yuvarla(m2 * malz.m2);
    var tamamlama = baski < genel.asgari_baski ? yuvarla(genel.asgari_baski - baski) : 0;
    var lamBedel = (cfg.laminasyon && lam !== 'yok') ? yuvarla(m2 * malz.m2 * (cfg.laminasyon.carpan - 1)) : 0;
    var kgAdet = 0, kgBedel = 0;
    if (cfg.kusgozu) {
      kgAdet = sayi(g.kusgozu || 0);
      if (!(kgAdet >= 0) || Math.floor(kgAdet) !== kgAdet) return {durum: 'hata', hatalar: [{alan: 'kusgozu', mesaj: 'Kuşgözü adedi 0 veya daha büyük bir tam sayı olmalı.'}]};
      if (kgAdet > 0 && kgAdet < 4) return {durum: 'hata', hatalar: [{alan: 'kusgozu', mesaj: 'Kuşgözü en az 4 adet olmalı (her köşeye bir tane), ya da 0 yazın.'}]};
      kgBedel = kgAdet * adet * cfg.kusgozu.fiyat;
    }
    var cerBedel = cer ? yuvarla(cer.fiyat * adet) : 0;
    var araToplam = yuvarla(baski + tamamlama + lamBedel + kgBedel + cerBedel);
    var kmax = ('kargo_max_m2' in malz) ? malz.kargo_max_m2 : cfg.kargo_max_m2;
    var kdv = yuvarla(araToplam * genel.kdv_orani);
    return {
      durum: 'tamam',
      uyarilar: uyarilar,
      kalemler: {
        m2: yuvarla(m2), m2Parca: yuvarla(m2Parca), birimM2: malz.m2,
        baski: yuvarla(baski), asgariFarki: yuvarla(tamamlama), laminasyon: yuvarla(lamBedel),
        kusgozuAdet: kgAdet * adet, kusgozu: yuvarla(kgBedel),
        cerceve: cerBedel, cerceveAd: cer ? cer.ad : null, cerceveBirim: cer ? cer.fiyat : 0
      },
      araToplam: yuvarla(araToplam), kdv: yuvarla(kdv), toplam: yuvarla(araToplam + kdv),
      kargoUcretsiz: araToplam >= genel.kargo_ucretsiz_esik && !(kmax && m2 > kmax),
      kargoAyrica: !!(kmax && m2 > kmax), kargoMaxM2: kmax || null
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
    var esik = (cfg.ppi_kucuk && Math.max(enCm, boyCm) < cfg.ppi_kucuk.sinir_cm) ? cfg.ppi_kucuk : cfg.ppi;
    var sonuc = ppi >= esik.uygun ? 'uygun' : (ppi >= esik.uyari ? 'inceleme' : 'uygun-degil');
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

  // Folyo yazı kesim ve transfer: m² × harf yüksekliği kademesi
  function yaziHesapla(cfg, genel, g) {
    var hatalar = [];
    var en = sayi(g.en), boy = sayi(g.boy), adet = sayi(g.adet), harf = sayi(g.harf);
    if (!(en > 0)) hatalar.push({alan: 'en', mesaj: 'Yazının toplam genişliğini santimetre olarak girin.'});
    if (!(boy > 0)) hatalar.push({alan: 'boy', mesaj: 'Yazının toplam yüksekliğini santimetre olarak girin.'});
    if (!(harf > 0)) hatalar.push({alan: 'harf', mesaj: 'En küçük harfin yüksekliğini santimetre olarak girin.'});
    if (!(adet >= 1) || Math.floor(adet) !== adet) hatalar.push({alan: 'adet', mesaj: 'Adet 1 veya daha büyük bir tam sayı olmalı.'});
    var renk = null;
    for (var i = 0; i < cfg.renkler.length; i++) if (cfg.renkler[i].kod === g.renk) renk = cfg.renkler[i];
    if (!renk) hatalar.push({alan: 'renk', mesaj: 'Renk seçin.'});
    if (hatalar.length) return {durum: 'hata', hatalar: hatalar};
    if (harf > boy) return {durum: 'hata', hatalar: [{alan: 'harf', mesaj: 'Harf yüksekliği yazının toplam yüksekliğinden büyük olamaz.'}]};
    if (renk.teklif) return {durum: 'teklif', mesaj: (renk.kod === 'diger' ? 'Listede olmayan renkler stok durumuna göre fiyatlandırılır. İstediğiniz rengi belirterek teklif alın.' : renk.ad + ' kesim folyosu standart fiyatlandırmanın dışındadır. Bu iş için teklif alın.'), uyarilar: []};
    if (g.stil === 'el') return {durum: 'teklif', mesaj: 'El yazısı, ince ve birbirine bağlı hatlar ile girift logolar ayrıca fiyatlandırılır. Bu iş için teklif alın.', uyarilar: []};
    var kisa = Math.min(en, boy), uzun = Math.max(en, boy);
    if (kisa > cfg.max_en) return {durum: 'teklif', mesaj: cfg.max_en + ' cm\'yi aşan işler renkli kesim folyosuyla tek parça üretilemez; bu iş baskes (baskı + kesim) olmak zorundadır. Bu iş için teklif alın.', uyarilar: []};
    if (uzun > genel.tek_parca_max_boy) return {durum: 'teklif', mesaj: 'Tek parça en fazla ' + (genel.tek_parca_max_boy / 100) + ' metre üretilir. Daha uzun işler için teklif alın.', uyarilar: []};
    var kademe = null;
    for (var k = 0; k < cfg.kademeler.length; k++) if (harf >= cfg.kademeler[k].min_harf) { kademe = cfg.kademeler[k]; break; }
    if (!kademe) return {durum: 'teklif', mesaj: cfg.kademeler[cfg.kademeler.length - 1].min_harf + ' cm\'den küçük harfler standart fiyatlandırmanın dışındadır. Bu iş için teklif alın.', uyarilar: []};
    var m2 = en * boy / 10000 * adet;
    var baski = yuvarla(m2 * kademe.m2);
    var tamamlama = baski < genel.asgari_baski ? yuvarla(genel.asgari_baski - baski) : 0;
    var araToplam = yuvarla(baski + tamamlama), kdv = yuvarla(araToplam * genel.kdv_orani);
    return {
      durum: 'tamam', uyarilar: [],
      kalemler: {m2: yuvarla(m2), birimM2: kademe.m2, kademe: kademe.ad, baski: yuvarla(baski), asgariFarki: yuvarla(tamamlama), laminasyon: 0, kusgozu: 0, renk: renk.ad},
      araToplam: yuvarla(araToplam), kdv: yuvarla(kdv), toplam: yuvarla(araToplam + kdv),
      kargoUcretsiz: araToplam >= genel.kargo_ucretsiz_esik, kargoAyrica: false
    };
  }

  function hesapla(fiyatlar, urunKod, girdi) {
    var cfg = fiyatlar.urunler[urunKod];
    if (!cfg) return {durum: 'hata', hatalar: [{alan: 'urun', mesaj: 'Ürün bulunamadı.'}]};
    if (cfg.tur === 'rulo' && cfg.kesim) return kesimHesapla(cfg, fiyatlar.genel, girdi);
    if (cfg.tur === 'rulo') return ruloHesapla(cfg, fiyatlar.genel, girdi);
    if (cfg.tur === 'yazi') return yaziHesapla(cfg, fiyatlar.genel, girdi);
    return {durum: 'hata', hatalar: [{alan: 'urun', mesaj: 'Bu ürün türü henüz tanımlı değil.'}]};
  }

  var M = {hesapla: hesapla, dosyaKontrol: dosyaKontrol, sayi: sayi};
  if (typeof module === 'object' && module.exports) module.exports = M; else kok.IPLMotor = M;
})(typeof self !== 'undefined' ? self : this);
