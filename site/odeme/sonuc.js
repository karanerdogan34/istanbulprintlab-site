/* Ödeme sonuç sayfası: PayTR'ın yönlendirmesi tek başına kanıt değildir; ödeme durumunu sunucudaki kayıttan sorar. */
(function () {
  var oid = ''; try { oid = sessionStorage.getItem('ipl_odeme_oid') || ''; } catch (e) {}
  var b = document.getElementById('sBaslik'), m = document.getElementById('sMetin'), deneme = 0;
  var tl = function (k) { return (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; };
  function bitir(baslik, metin) { b.textContent = baslik; m.textContent = metin; }
  if (!oid) { bitir('Ödeme işleminiz tamamlandı', 'Ödemeniz onaylandığında size WhatsApp veya telefonla bilgi vereceğiz. Sorunuz olursa WhatsApp\'tan yazabilirsiniz.'); return; }
  (function sor() {
    fetch('/.netlify/functions/odeme-durum?oid=' + encodeURIComponent(oid)).then(function (r) { return r.json(); }).then(function (d) {
      if (d.durum === 'basarili') { try { sessionStorage.removeItem('ipl_odeme_oid'); } catch (e) {} return bitir('Ödemeniz alındı', d.siparisNo + ' numaralı siparişinizin ödemesi alındı' + (d.toplam ? ' (' + tl(d.toplam) + ')' : '') + '. Teşekkür ederiz; siparişiniz üretime alınıyor, süreçle ilgili sizi WhatsApp veya telefonla bilgilendireceğiz.'); }
      if (d.durum === 'basarisiz') return bitir('Ödeme tamamlanamadı', 'Kartınızdan tutar çekilmedi. Ödeme bağlantınıza dönüp tekrar deneyebilirsiniz.');
      if (++deneme < 10) return setTimeout(sor, 3000);
      bitir('Ödemeniz kontrol ediliyor', 'Bankanızın onayı henüz bize ulaşmadı. Onay gelince sizi bilgilendireceğiz; kartınızdan çekim yapıldıysa ödemeniz güvendedir. Sorunuz olursa WhatsApp\'tan yazın.');
    }).catch(function () { if (++deneme < 10) setTimeout(sor, 3000); });
  })();
})();
