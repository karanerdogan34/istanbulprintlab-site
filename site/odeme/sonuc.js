/* Ödeme sonuç sayfası: PayTR'ın yönlendirmesi tek başına kanıt değildir; ödeme durumunu sunucudaki kayıttan sorar. */
(function () {
  var oid = ''; try { oid = sessionStorage.getItem('ipl_odeme_oid') || ''; } catch (e) {}
  var b = document.getElementById('sBaslik'), m = document.getElementById('sMetin'), deneme = 0;
  var tl = function (k) { return (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; };
  function bitir(baslik, metin) { b.textContent = baslik; m.textContent = metin; }
  // Analytics satın alma etkinliği (GA4 + PostHog): yalnızca sunucu ödemeyi "basarili" dediğinde, her sipariş için bir kez
  function satinAlma(d) {
    try {
      var no = String(d.siparisNo || oid), anahtar = 'ipl_purchase_' + no;
      try { if (localStorage.getItem(anahtar)) return; localStorage.setItem(anahtar, '1'); } catch (e) {}
      var p = { transaction_id: no, currency: 'TRY' };
      if (d.kurus) {
        var kargo = (d.kargoKurus || 0) / 100, urunKdvli = (d.kurus / 100) - kargo, net = Math.round(urunKdvli / 1.2 * 100) / 100;
        p.value = net; p.tax = Math.round((urunKdvli - net) * 100) / 100; p.shipping = kargo;
        p.items = [{ item_id: no, item_name: d.urun || 'Baskı siparişi', price: net, quantity: 1 }];
      } else if (d.toplam) p.value = Math.round(d.toplam) / 100;
      if (typeof window.gtag === 'function') window.gtag('event', 'purchase', p);
      else { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: 'purchase', ecommerce: p }); }
    } catch (e) {}
  }
  if (!oid) { bitir('Ödeme işleminiz tamamlandı', 'Ödemeniz onaylandığında size WhatsApp veya telefonla bilgi vereceğiz. Sorunuz olursa WhatsApp\'tan yazabilirsiniz.'); return; }
  (function sor() {
    fetch('/.netlify/functions/odeme-durum?oid=' + encodeURIComponent(oid)).then(function (r) { return r.json(); }).then(function (d) {
      if (d.durum === 'basarili') { try { sessionStorage.removeItem('ipl_odeme_oid'); } catch (e) {} satinAlma(d); return bitir('Ödemeniz alındı', d.siparisNo + ' numaralı siparişinizin ödemesi alındı' + (d.toplam ? ' (' + tl(d.toplam) + ')' : '') + '. Teşekkür ederiz; siparişiniz üretime alınıyor, süreçle ilgili sizi WhatsApp veya telefonla bilgilendireceğiz.'); }
      if (d.durum === 'basarisiz') return bitir('Ödeme tamamlanamadı', 'Kartınızdan tutar çekilmedi. Ödeme bağlantınıza dönüp tekrar deneyebilirsiniz.');
      if (++deneme < 10) return setTimeout(sor, 3000);
      bitir('Ödemeniz kontrol ediliyor', 'Bankanızın onayı henüz bize ulaşmadı. Onay gelince sizi bilgilendireceğiz; kartınızdan çekim yapıldıysa ödemeniz güvendedir. Sorunuz olursa WhatsApp\'tan yazın.');
    }).catch(function () { if (++deneme < 10) setTimeout(sor, 3000); });
  })();
})();
