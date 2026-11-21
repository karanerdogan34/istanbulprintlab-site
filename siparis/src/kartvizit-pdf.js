/* IPL kartvizit baskı PDF'i — tarayıcıda üretilir.
   Ölçü 91 × 61 mm (85 × 55 mm kesim + her kenarda 3 mm taşma), TrimBox/BleedBox tanımlı.
   Yazılar font gömülmeden vektör kontura çevrilir; renkler CMYK, metin siyahı yalnızca K (%100). */
(function (kok) {
  'use strict';
  var BIRIM = 72 / 25.4 / 10;           // 1 şablon birimi = 0,1 mm → pt
  var TASMA = 30, W = 850, H = 550;      // 3 mm taşma
  var PW = (W + 2 * TASMA) * BIRIM, PH = (H + 2 * TASMA) * BIRIM, TB = TASMA * BIRIM;

  // Palet renklerinin baskı (CMYK) karşılıkları; 0–1 aralığında
  var CMYK = {
    '#FFFFFF': [0, 0, 0, 0], '#F4F1EA': [.03, .04, .08, 0], '#ECECEC': [0, 0, 0, .10],
    '#2E2E2E': [0, 0, 0, .88], '#1B2A57': [1, .85, .30, .25], '#7A1F2B': [.20, .95, .70, .35],
    '#1E5B45': [.85, .30, .75, .30], '#B08A3E': [.20, .40, .85, .15], '#2F6FB0': [.85, .50, 0, 0],
    '#3A3835': [0, .05, .05, .80], '#D8D6D2': [0, .01, .03, .18]
  };
  function hex6(h) { h = String(h || '').trim().toUpperCase(); if (/^#[0-9A-F]{3}$/.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return h; }
  function cmyk(h, metin) {
    h = hex6(h);
    if (h === '#0B0B0B' || h === '#000000') return metin ? [0, 0, 0, 1] : [.5, .4, .4, 1]; // yazı tek renk siyah, zemin zengin siyah
    if (CMYK[h]) return CMYK[h].slice();
    var r = parseInt(h.substr(1, 2), 16) / 255, g = parseInt(h.substr(3, 2), 16) / 255, b = parseInt(h.substr(5, 2), 16) / 255;
    var k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  }
  function karistir(on, arka, o) { return on.map(function (v, i) { return o * v + (1 - o) * arka[i]; }); } // saydamlık düzleştirilir
  function n(x) { var v = Math.round(x * 1000) / 1000; return (Object.is(v, -0) ? 0 : v).toString(); }
  function renkKomut(c, kontur) { return c.map(n).join(' ') + (kontur ? ' K' : ' k'); }

  function stilOku(el) {
    var s = {}; (el.getAttribute('style') || '').split(';').forEach(function (p) { var i = p.indexOf(':'); if (i > 0) s[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    ['fill', 'opacity', 'stroke', 'stroke-width'].forEach(function (a) { if (el.getAttribute(a) !== null && s[a] === undefined) s[a] = el.getAttribute(a); });
    return s;
  }
  function sayi(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }

  // SVG path (M L H V Z, mutlak) → PDF yol komutları
  function svgYol(d) {
    var t = String(d).match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [], out = [], i = 0, cmd = '', x = 0, y = 0;
    while (i < t.length) {
      if (/[A-Za-z]/.test(t[i])) cmd = t[i++].toUpperCase();
      if (cmd === 'Z') { out.push('h'); continue; }
      if (cmd === 'M' || cmd === 'L') { x = +t[i++]; y = +t[i++]; out.push(n(x) + ' ' + n(y) + (cmd === 'M' ? ' m' : ' l')); if (cmd === 'M') cmd = 'L'; }
      else if (cmd === 'H') { x = +t[i++]; out.push(n(x) + ' ' + n(y) + ' l'); }
      else if (cmd === 'V') { y = +t[i++]; out.push(n(x) + ' ' + n(y) + ' l'); }
      else i++;
    }
    return out.join('\n');
  }
  // opentype.js yol komutları → PDF (ikinci derece eğriler kübiğe çevrilir)
  function glifYol(cmds) {
    var out = [], cx = 0, cy = 0, sx = 0, sy = 0;
    cmds.forEach(function (c) {
      if (c.type === 'M') { out.push(n(c.x) + ' ' + n(c.y) + ' m'); cx = sx = c.x; cy = sy = c.y; }
      else if (c.type === 'L') { out.push(n(c.x) + ' ' + n(c.y) + ' l'); cx = c.x; cy = c.y; }
      else if (c.type === 'C') { out.push([c.x1, c.y1, c.x2, c.y2, c.x, c.y].map(n).join(' ') + ' c'); cx = c.x; cy = c.y; }
      else if (c.type === 'Q') {
        var a1 = cx + 2 / 3 * (c.x1 - cx), b1 = cy + 2 / 3 * (c.y1 - cy), a2 = c.x + 2 / 3 * (c.x1 - c.x), b2 = c.y + 2 / 3 * (c.y1 - c.y);
        out.push([a1, b1, a2, b2, c.x, c.y].map(n).join(' ') + ' c'); cx = c.x; cy = c.y;
      } else if (c.type === 'Z') { out.push('h'); cx = sx; cy = sy; }
    });
    return out.join('\n');
  }
  function daire(cx, cy, r) {
    var k = 0.5522847 * r;
    return [n(cx + r) + ' ' + n(cy) + ' m',
      [cx + r, cy + k, cx + k, cy + r, cx, cy + r].map(n).join(' ') + ' c',
      [cx - k, cy + r, cx - r, cy + k, cx - r, cy].map(n).join(' ') + ' c',
      [cx - r, cy - k, cx - k, cy - r, cx, cy - r].map(n).join(' ') + ' c',
      [cx + k, cy - r, cx + r, cy - k, cx + r, cy].map(n).join(' ') + ' c', 'h'].join('\n');
  }

  function scriptYukle(url) {
    return new Promise(function (ok, red) {
      if (kok.opentype) return ok();
      var s = document.createElement('script'); s.src = url; s.onload = function () { ok(); }; s.onerror = function () { red(new Error('Yazı motoru yüklenemedi.')); };
      document.head.appendChild(s);
    });
  }
  var fontOnbellek = {};
  function fontYukle(yol, dosya) {
    if (!fontOnbellek[dosya]) fontOnbellek[dosya] = fetch(yol + dosya).then(function (r) { if (!r.ok) throw new Error('Font yüklenemedi: ' + dosya); return r.arrayBuffer(); }).then(function (b) { return kok.opentype.parse(b); });
    return fontOnbellek[dosya];
  }

  function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    var cs = new CompressionStream('deflate');
    var st = new Blob([u8]).stream().pipeThrough(cs);
    return new Response(st).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // Logo: tuval üzerinden RGB + alfa (SMask) olarak gömülür
  function logoHazirla(url) {
    return new Promise(function (ok, red) {
      var im = new Image();
      im.onload = function () {
        var sc = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
        var w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, w, h);
        var px = cx.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3), a = new Uint8Array(w * h), saydam = false;
        for (var i = 0, j = 0; i < px.length; i += 4, j++) { rgb[j * 3] = px[i]; rgb[j * 3 + 1] = px[i + 1]; rgb[j * 3 + 2] = px[i + 2]; a[j] = px[i + 3]; if (px[i + 3] < 255) saydam = true; }
        Promise.all([deflate(rgb), saydam ? deflate(a) : Promise.resolve(null)]).then(function (z) {
          ok({w: w, h: h, oranW: im.naturalWidth, oranH: im.naturalHeight, rgb: z[0] || rgb, rgbZ: !!z[0], alfa: saydam ? (z[1] || a) : null, alfaZ: !!z[1]});
        }, red);
      };
      im.onerror = function () { red(new Error('Logo okunamadı.')); };
      im.src = url;
    });
  }

  // Bir yüzü (SVG metni) PDF içerik akışına çevirir
  function yuzCiz(svgMetni, fontlar, logo, eksik) {
    var doc = new DOMParser().parseFromString(svgMetni, 'image/svg+xml'), kokEl = doc.documentElement;
    var parca = ['q', [BIRIM, 0, 0, -BIRIM, TB, PH - TB].map(n).join(' ') + ' cm'], zemin = [0, 0, 0, 0], ilkRect = true, logoVar = false;
    Array.prototype.forEach.call(kokEl.querySelectorAll('rect,circle,path,text,image'), function (el) {
      var s = stilOku(el), op = sayi(s.opacity, 1), tag = el.tagName.toLowerCase();
      var dolgu = s.fill && s.fill !== 'none' ? cmyk(s.fill, tag === 'text') : null;
      if (dolgu && op < 1) dolgu = karistir(dolgu, zemin, op);
      if (tag === 'rect') {
        var x = sayi(el.getAttribute('x'), 0), y = sayi(el.getAttribute('y'), 0), w = sayi(el.getAttribute('width'), 0), h = sayi(el.getAttribute('height'), 0);
        if (ilkRect && dolgu) { zemin = dolgu; ilkRect = false; }
        if (dolgu) parca.push(renkKomut(dolgu) + '\n' + [x, y, w, h].map(n).join(' ') + ' re f');
      } else if (tag === 'circle') {
        var yol = daire(sayi(el.getAttribute('cx'), 0), sayi(el.getAttribute('cy'), 0), sayi(el.getAttribute('r'), 0));
        if (dolgu) parca.push(renkKomut(dolgu) + '\n' + yol + '\nf');
        if (s.stroke && s.stroke !== 'none') parca.push(renkKomut(cmyk(s.stroke), true) + ' ' + n(sayi(s['stroke-width'], 1)) + ' w\n' + yol + '\nS');
      } else if (tag === 'path') {
        if (dolgu) parca.push(renkKomut(dolgu) + '\n' + svgYol(el.getAttribute('d')) + '\nf');
      } else if (tag === 'text') {
        var metin = el.textContent; if (!metin || !dolgu) return;
        var kalin = sayi(s['font-weight'], 400) >= 600, font = fontlar[kalin ? 1 : 0], boyut = sayi(s['font-size'], 16);
        Array.from(metin).forEach(function (ch) { if (ch.trim() && font.charToGlyph(ch).index === 0 && eksik.indexOf(ch) < 0) eksik.push(ch); });
        var gen = font.getAdvanceWidth(metin, boyut, {kerning: true}), tx = sayi(el.getAttribute('x'), 0), ty = sayi(el.getAttribute('y'), 0);
        if (s['text-anchor'] === 'middle') tx -= gen / 2; else if (s['text-anchor'] === 'end') tx -= gen;
        var p = font.getPath(metin, tx, ty, boyut, {kerning: true});
        if (p.commands.length) parca.push(renkKomut(dolgu) + '\n' + glifYol(p.commands) + '\nf');
      } else if (tag === 'image' && logo) {
        var ix = sayi(el.getAttribute('x'), 0), iy = sayi(el.getAttribute('y'), 0), iw = sayi(el.getAttribute('width'), 0), ih = sayi(el.getAttribute('height'), 0);
        var sc = Math.min(iw / logo.oranW, ih / logo.oranH), dw = logo.oranW * sc, dh = logo.oranH * sc, dx = ix + (iw - dw) / 2, dy = iy + (ih - dh) / 2;
        parca.push('q ' + [dw, 0, 0, -dh, dx, dy + dh].map(n).join(' ') + ' cm /Logo Do Q'); logoVar = true;
      }
    });
    parca.push('Q');
    return {icerik: parca.join('\n'), logo: logoVar};
  }

  function pdfYaz(yuzler, logo) {
    var enc = new TextEncoder(), parcalar = [], ofset = [], boy = 0, no = 0;
    function ekle(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parcalar.push(b); boy += b.length; }
    var nesneler = []; // [{dict, stream?}]
    function yeni() { nesneler.push(null); return nesneler.length; }
    var katalog = yeni(), sayfalar = yeni(), bilgi = yeni(), logoNo = null, alfaNo = null;
    if (logo) {
      logoNo = yeni(); if (logo.alfa) alfaNo = yeni();
      if (alfaNo) nesneler[alfaNo - 1] = {d: '<< /Type /XObject /Subtype /Image /Width ' + logo.w + ' /Height ' + logo.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8' + (logo.alfaZ ? ' /Filter /FlateDecode' : '') + ' /Length ' + logo.alfa.length + ' >>', s: logo.alfa};
      nesneler[logoNo - 1] = {d: '<< /Type /XObject /Subtype /Image /Width ' + logo.w + ' /Height ' + logo.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8' + (logo.rgbZ ? ' /Filter /FlateDecode' : '') + (alfaNo ? ' /SMask ' + alfaNo + ' 0 R' : '') + ' /Length ' + logo.rgb.length + ' >>', s: logo.rgb};
    }
    var kutu = '/MediaBox [0 0 ' + n(PW) + ' ' + n(PH) + '] /BleedBox [0 0 ' + n(PW) + ' ' + n(PH) + '] /TrimBox [' + [TB, TB, PW - TB, PH - TB].map(n).join(' ') + ']';
    var cocuklar = [];
    yuzler.forEach(function (y) {
      var sayfa = yeni(), icerik = yeni(), akis = enc.encode(y.icerik);
      nesneler[icerik - 1] = {d: '<< /Length ' + akis.length + ' >>', s: akis};
      nesneler[sayfa - 1] = {d: '<< /Type /Page /Parent ' + sayfalar + ' 0 R ' + kutu + ' /Resources << ' + (y.logo && logoNo ? '/XObject << /Logo ' + logoNo + ' 0 R >> ' : '') + '>> /Contents ' + icerik + ' 0 R >>'};
      cocuklar.push(sayfa + ' 0 R');
    });
    nesneler[katalog - 1] = {d: '<< /Type /Catalog /Pages ' + sayfalar + ' 0 R >>'};
    nesneler[sayfalar - 1] = {d: '<< /Type /Pages /Kids [' + cocuklar.join(' ') + '] /Count ' + cocuklar.length + ' >>'};
    nesneler[bilgi - 1] = {d: '<< /Title (IstanbulPrintLab kartvizit baski dosyasi 85x55 mm + 3 mm tasma) /Producer (IstanbulPrintLab) >>'};
    ekle('%PDF-1.4\n'); ekle(new Uint8Array([37, 226, 227, 207, 211, 10]));
    nesneler.forEach(function (o, i) {
      ofset[i] = boy; ekle((i + 1) + ' 0 obj\n' + o.d + '\n');
      if (o.s) { ekle('stream\n'); ekle(o.s); ekle('\nendstream\n'); }
      ekle('endobj\n');
    });
    var xref = boy;
    var x = 'xref\n0 ' + (nesneler.length + 1) + '\n0000000000 65535 f \n' + ofset.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
    ekle(x + 'trailer\n<< /Size ' + (nesneler.length + 1) + ' /Root ' + katalog + ' 0 R /Info ' + bilgi + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parcalar, {type: 'application/pdf'});
  }

  // secenek: {yuzler: [svg metni, ...], font: 'Montserrat', yol: 'fontlar/', logo: dataURL|null}
  function olustur(secenek) {
    var yol = secenek.yol || 'fontlar/', ad = secenek.font.replace(/\s/g, '');
    return scriptYukle(yol + 'opentype.min.js').then(function () {
      return Promise.all([fontYukle(yol, ad + '-400.woff'), fontYukle(yol, ad + '-700.woff'), secenek.logo ? logoHazirla(secenek.logo) : null]);
    }).then(function (r) {
      var eksik = [], yuzler = secenek.yuzler.map(function (s) { return yuzCiz(s, [r[0], r[1]], r[2], eksik); });
      if (eksik.length) return {blob: null, eksik: eksik};
      return {blob: pdfYaz(yuzler, r[2]), eksik: []};
    });
  }

  kok.IPLKartvizitPDF = {olustur: olustur, olcu: {genislikMm: 91, yukseklikMm: 61, kesimMm: [85, 55], tasmaMm: 3}};
})(typeof self !== 'undefined' ? self : this);
