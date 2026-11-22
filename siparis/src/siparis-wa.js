/* WhatsApp sipariş talebi (ödeme altyapısı gelene kadar geçici akış).
   "Ödemeye geç" düğmesi, sayfadaki seçimleri ve ön fiyatı hazır bir WhatsApp mesajına çevirir.
   Kesin fiyat ve üretim onayı dosya kontrolünden sonra IPL tarafından verilir; ödeme onaydan sonra alınır. */
(function () {
  var NUMARA = '905325237364';
  var btn = document.getElementById('devam'), form = document.getElementById('f');
  if (!btn || !form) return;
  btn.textContent = 'WhatsApp\'tan sipariş talebi gönder';

  var not = document.createElement('div');
  not.className = 'msg warn';
  not.style.margin = '12px 0';
  not.textContent = 'Gösterilen tutar ön hesaplamadır. Kesin fiyat ve üretim uygunluğu dosyanız incelendikten sonra onaylanır; ödeme onayımızdan sonra alınır.';
  btn.parentNode.insertBefore(not, btn);

  function temiz(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function gorunur(el) { return !!(el.offsetParent || el.getClientRects().length); }
  function etiketMetni(lab) {
    if (!lab) return '';
    var k = lab.cloneNode(true);
    k.querySelectorAll('input,select,textarea,small').forEach(function (x) { x.remove(); });
    return temiz(k.textContent);
  }
  function grupBasligi(el) {
    var sec = el.closest('section.step'), c = el.closest('label') || el;
    for (var p = c; p && p !== sec; p = p.parentElement) {
      for (var o = p.previousElementSibling; o; o = o.previousElementSibling) {
        if (o.matches('p.hint')) return temiz(o.textContent).replace(/:$/, '');
        if (o.matches('h2')) break;
      }
    }
    var h = sec && sec.querySelector('h2');
    if (!h) return '';
    var k = h.cloneNode(true); k.querySelectorAll('.n').forEach(function (x) { x.remove(); });
    return temiz(k.textContent);
  }
  function secimler() {
    var satir = [], dosyalar = [];
    form.querySelectorAll('input,select,textarea').forEach(function (el) {
      if (el.id === 'onay' || el.type === 'hidden' || el.type === 'color' || el.type === 'date' || el.type === 'time') return; // tarih ve saat özette okunur biçimde yer alır
      var sec = el.closest('section.step');
      if (sec && !gorunur(sec)) return;
      var gizliKap = el.closest('[style*="display: none"],[style*="display:none"]');
      if (gizliKap && gizliKap !== el) return;
      if (el.type === 'file') { if (el.files && el.files[0]) dosyalar.push(el.files[0].name); return; }
      if (el.type === 'radio') {
        if (!el.checked) return;
        var lab = el.closest('label'), deger = '';
        if (lab) { var b = lab.querySelector('b'), sm = lab.querySelector('small');
          // yazı tipi seçeneklerinde kalın metin örnek yazıdır; yazı tipinin adı alttaki küçük satırdadır
          if (b && b.style.fontFamily && sm) deger = temiz(sm.textContent); else deger = temiz(b ? b.textContent : (sm ? sm.textContent : '')) || temiz(lab.getAttribute('title')); }
        if (el.value === 'ozel') { var oz = document.getElementById('renkOzel'); if (oz) deger = 'Özel renk ' + oz.value.toUpperCase(); }
        if (deger) satir.push(grupBasligi(el) + ': ' + deger);
        return;
      }
      if (el.type === 'checkbox') { if (el.checked) satir.push(etiketMetni(el.closest('label')) || el.id); return; }
      var v = el.tagName === 'SELECT' ? temiz(el.options[el.selectedIndex] && el.options[el.selectedIndex].text) : temiz(el.value);
      if (!v) return;
      var ad = etiketMetni(el.closest('label')) || temiz(el.getAttribute('placeholder')) || el.id;
      satir.push(ad + ': ' + v);
    });
    document.querySelectorAll('.filecard b').forEach(function (b) { var n = temiz(b.textContent); if (n && dosyalar.indexOf(n) < 0) dosyalar.push(n); });
    return { satir: satir, dosyalar: dosyalar };
  }
  function fiyatSatirlari() {
    var out = [];
    document.querySelectorAll('#ozetIc .line').forEach(function (l) {
      var s = l.querySelectorAll('span');
      if (s.length >= 2) out.push(temiz(s[0].textContent) + ': ' + temiz(s[1].textContent));
    });
    return out;
  }
  function mesaj() {
    var urun = temiz((document.querySelector('h1') || {}).textContent);
    var s = secimler(), f = fiyatSatirlari(), pdf = document.getElementById('pdfIndir');
    var m = ['Merhaba, istanbulprintlab.com üzerinden sipariş talebi göndermek istiyorum.', '', 'Ürün: ' + urun];
    if (s.satir.length) m.push('', 'Seçimlerim:', s.satir.map(function (x) { return '• ' + x; }).join('\n'));
    f = f.filter(function (x) { return s.satir.indexOf(x) < 0; });
    if (f.length) m.push('', 'Ön hesaplama:', f.map(function (x) { return '• ' + x; }).join('\n'));
    if (pdf && gorunur(pdf)) m.push('', 'Sitede oluşturduğum baskı dosyasını (PDF) bu mesaja ekliyorum.');
    else if (s.dosyalar.length) m.push('', 'Baskı dosyam: ' + s.dosyalar.join(', ') + ' (bu mesaja ekliyorum).');
    m.push('', 'Seçimlerimi ve yazımları kontrol edip onayladım.');
    return m.join('\n');
  }
  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    var a = document.createElement('a');
    a.href = 'https://wa.me/' + NUMARA + '?text=' + encodeURIComponent(mesaj());
    a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  });
  // Gömülü hesaplayıcıda WhatsApp/telefon/e-posta tıklamalarını üst sayfaya bildir; üst sayfa Google etiketiyle dönüşüm olarak gönderir
  if (window.parent !== window && document.documentElement.classList.contains('gomulu')) {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (!a) return;
      var h = a.getAttribute('href') || '';
      var ad = /wa\.me|whatsapp/i.test(h) ? 'whatsapp_click' : (/^tel:/i.test(h) ? 'phone_click' : (/^mailto:/i.test(h) ? 'email_click' : null));
      if (ad) try { window.parent.postMessage({ ipl: 'olay', ad: ad, urun: location.pathname }, location.origin); } catch (x) {}
    }, true);
  }
  window.IPLSiparisMesaji = mesaj; // test için

  // Sitenin ürün sayfasına gömülüyken yüksekliği üst sayfaya bildir (çerçeve kaydırma çubuğu olmadan uzar)
  if (document.documentElement.classList.contains('gomulu') && window.parent !== window) {
    var son = 0;
    var bildir = function () { var h = Math.ceil(document.body.getBoundingClientRect().height) + 4; if (Math.abs(h - son) > 2) { son = h; window.parent.postMessage({ ipl: 'yukseklik', h: h, yol: location.pathname }, location.origin); } };
    if (window.ResizeObserver) new ResizeObserver(bildir).observe(document.body);
    window.addEventListener('load', bildir); setInterval(bildir, 1500); bildir();
    // Üst sayfa kaydırıldıkça sipariş özeti görünür alanda kalır (masaüstünde iki sütunlu düzende)
    var ozet = document.getElementById('ozet'), duzen = ozet && ozet.parentElement;
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.ipl !== 'konum' || !ozet) return;
      var ikiSutun = ozet.getBoundingClientRect().left > form.getBoundingClientRect().left + 40;
      if (!ikiSutun) { ozet.style.transform = ''; return; }
      ozet.style.transform = '';
      var ust = ozet.getBoundingClientRect().top + window.scrollY, alt = duzen.getBoundingClientRect().bottom + window.scrollY;
      var kayma = Math.max(0, Math.min(-e.data.top + (e.data.ust || 0) + 16 - ust, alt - ust - ozet.offsetHeight));
      ozet.style.transform = kayma ? 'translateY(' + Math.round(kayma) + 'px)' : '';
    });
  }
})();
