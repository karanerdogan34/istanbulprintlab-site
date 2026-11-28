# -*- coding: utf-8 -*-
"""Yeni tasarım sayfalarının (ana sayfa, sipariş panelleri, ödeme) yabancı dil sürümleri.
Kaynak: derlenmiş Türkçe sayfa. Çeviri: ceviri_tr/<dil>.json (Türkçe metin -> hedef dil).
Yalnızca sözlükte birebir karşılığı olan metin değişir; kod, fiyat mantığı ve formlar aynı kalır.
"""
import html, json, os, re

TR_HARF = re.compile(r'[A-Za-zÇĞİÖŞÜçğıöşü]{2}')
METIN_RE = re.compile(r'>([^<>]*[A-Za-zÇĞİÖŞÜçğıöşü][^<>]*)<')
OZ_RE = re.compile(r'\b(content|alt|title|placeholder|aria-label|data-ad|data-etiket)="([^"]*[A-Za-zÇĞİÖŞÜçğıöşü][^"]*)"')
JS_STR = re.compile(r"'((?:[^'\\\n]|\\.)*)'")
LD_RE = re.compile(r'"(name|text|description|headline|alternateName|caption)":\s*"((?:[^"\\]|\\.)*)"')
KOD_GIBI = re.compile(r'[{}=<>]|^[\w.#\-\[\]:()]+$|^\s*$|https?:|^/')
KENAR = re.compile(r'^(\s*)(.*?)(\s*)$', re.S)
# yapılandırma (fiyat dosyası) içindeki görünen metinler
CFG_RE = re.compile(r'"(ad|not|uyari|b|m|aciklama|ozel_mesaj|lamNot|malzeme_baslik|kargo_metni|mesaj)":\s*"((?:[^"\\]|\\.)*)"')
CHIPS_RE = re.compile(r'"chips":\s*\[((?:\s*"(?:[^"\\]|\\.)*",?)*)\]')
KELIME_IZIN = {'adet', 'laminasyon', 'kuşgözü', 'kesim'}  # HTML parçası içindeki küçük harfli kelimeler
JS_KELIME_IZIN = {'kuşgözü'}  # tek başına JS metni olarak çevrilebilecekler ('adet', 'laminasyon' kod anahtarıdır, çevrilmez)
TEK_KELIME = re.compile(r'^[A-ZÇĞİÖŞÜ][a-zçğıöşü]+$')
KORU = {'Tarih', 'Currency', 'Date', 'Error', 'Image', 'Object', 'Math', 'Number', 'String', 'Array', 'Promise', 'Event', 'Blob', 'File', 'Enter', 'Escape'}
JS_OZ = re.compile(r'\b(placeholder|aria-label|title|alt)="([^"]+)"')
HTML_IC = re.compile(r'(^|>)([^<>]*[A-Za-zÇĞİÖŞÜçğıöşü][^<>]*)(<|$)')


def _parca(s):
    return re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->)', s, flags=re.S)


def _dogal(t):
    """insan için yazılmış metin mi (kod parçası değil)"""
    t = t.strip()
    return len(t) > 1 and TR_HARF.search(t) and not KOD_GIBI.search(t)


def _html_ok(t):
    """HTML metni ve öznitelikleri: tek kelime de olabilir"""
    t = t.strip()
    return len(t) > 1 and TR_HARF.search(t) and not re.match(r'^(https?:|/|#|mailto:|tel:)', t) and '{{' not in t


def metinler(s):
    out = []
    for i, p in enumerate(_parca(s)):
        if i % 2:
            if p.startswith('<script') and 'ld+json' in p[:80]:
                out += [json.loads('"%s"' % m.group(2)) for m in LD_RE.finditer(p) if _dogal(json.loads('"%s"' % m.group(2)))]
            elif p.startswith('<script'):
                out += _js_metinler(p)
            continue
        out += [KENAR.match(html.unescape(m.group(1))).group(2) for m in METIN_RE.finditer(p) if _html_ok(html.unescape(m.group(1)))]
        out += [html.unescape(m.group(2)).strip() for m in OZ_RE.finditer(p) if _html_ok(html.unescape(m.group(2)))]
    return out


def _js_metinler(p):
    out = []
    for m in CFG_RE.finditer(p):
        v = json.loads('"%s"' % m.group(2))
        if _dogal(v) or TEK_KELIME.match(v):
            out.append(v)
    for m in CHIPS_RE.finditer(p):
        out += [json.loads(x) for x in re.findall(r'"(?:[^"\\]|\\.)*"', m.group(1))]
    for m in JS_STR.finditer(p):
        v = m.group(1).replace("\\'", "'")
        if '<' in v:
            out += [KENAR.match(h.group(2)).group(2) for h in HTML_IC.finditer(v) if _dogal(h.group(2)) or TEK_KELIME.match(h.group(2).strip()) or h.group(2).strip() in KELIME_IZIN]
            out += [o.group(2) for o in JS_OZ.finditer(v) if _html_ok(o.group(2))]
        elif (' ' in v and _dogal(v)) or (TEK_KELIME.match(v) and v not in KORU) or v in JS_KELIME_IZIN:
            out.append(v)
    return out


def _js_cevir(x, C):
    def cr(m):
        v = C.get(json.loads('"%s"' % m.group(2)))
        return '"%s":%s' % (m.group(1), json.dumps(v, ensure_ascii=False)) if v else m.group(0)
    x = CFG_RE.sub(cr, x)
    def ch(m):
        ogeler = [json.loads(y) for y in re.findall(r'"(?:[^"\\]|\\.)*"', m.group(1))]
        return '"chips":%s' % json.dumps([C.get(o) or o for o in ogeler], ensure_ascii=False)
    x = CHIPS_RE.sub(ch, x)
    def jsr(m):
        v = m.group(1).replace("\\'", "'")
        if '<' in v:
            def hr(h):
                a, ic, b = KENAR.match(h.group(2)).groups()
                t = C.get(ic)
                return h.group(1) + (a + t + b if t else h.group(2)) + h.group(3)
            yeni = HTML_IC.sub(hr, v)
            yeni = JS_OZ.sub(lambda o: '%s="%s"' % (o.group(1), C.get(o.group(2)) or o.group(2)), yeni)
            return "'%s'" % yeni.replace('\\', '\\\\').replace("'", "\\'") if yeni != v else m.group(0)
        if v in KORU or not ((' ' in v and _dogal(v)) or TEK_KELIME.match(v) or v in JS_KELIME_IZIN):
            return m.group(0)
        t = C.get(v)
        return "'%s'" % t.replace('\\', '\\\\').replace("'", "\\'") if t else m.group(0)
    return JS_STR.sub(jsr, x)


def _c(t, C):
    a, ic, b = KENAR.match(t).groups()
    v = C.get(ic)
    return a + v + b if v else t


def cevir(s, C):
    p = _parca(s)
    for i, x in enumerate(p):
        if i % 2:
            if x.startswith('<script') and 'ld+json' in x[:80]:
                def jr(m):
                    v = C.get(json.loads('"%s"' % m.group(2)).strip())
                    return '"%s": %s' % (m.group(1), json.dumps(v, ensure_ascii=False)) if v else m.group(0)
                x = LD_RE.sub(jr, x)
            elif x.startswith('<script'):
                x = _js_cevir(x, C)
            p[i] = x
            continue
        x = METIN_RE.sub(lambda m: '>%s<' % html.escape(_c(html.unescape(m.group(1)), C), quote=False), x)
        x = OZ_RE.sub(lambda m: '%s="%s"' % (m.group(1), html.escape(_c(html.unescape(m.group(2)), C))), x)
        p[i] = x
    return ''.join(p)


def sozluk(dil, kok='ceviri_tr'):
    yol = os.path.join(kok, '%s.json' % dil)
    return json.load(open(yol, encoding='utf-8')) if os.path.exists(yol) else {}


# ---------- sayfa üretimi ----------
SITE = 'https://www.istanbulprintlab.com'


def _tr_en_haritasi(dist):
    """Türkçe yol -> İngilizce yol (İngilizce sayfalardaki hreflang="tr" etiketinden)"""
    import glob
    h = {}
    for f in glob.glob('%s/en/**/index.html' % dist, recursive=True):
        m = re.search(r'<link rel="alternate" hreflang="tr" href="%s([^"]*)">' % re.escape(SITE), open(f, encoding='utf-8').read())
        if m:
            h[m.group(1)] = f[len(dist):].replace('index.html', '')
    return h


def _sayi(x, dil):
    """dile göre sayı biçimi (rakamlar Latin)"""
    v = ('{:,.2f}'.format(x) if abs(x - round(x)) > 0.004 else '{:,.0f}'.format(x))
    if dil in ('en', 'ar', 'ur', 'fa'):
        return v
    if dil in ('ru', 'fr'):
        return v.replace(',', '\u00a0').replace('.', ',')
    return v.replace(',', ' ').replace('.', ',').replace(' ', '.')


YD_CARPAN = 1.2
ONEK = {'en': 'from ', 'ru': 'от ', 'de': 'ab ', 'fr': 'dès ', 'es': 'desde ', 'it': 'da ', 'ar': 'من ', 'ur': 'از ', 'fa': 'از '}
FX_JS = ('<script>(function(){var L=document.querySelectorAll("[data-tl]");if(!L.length)return;fetch("/api/kur",{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.text()})'
         '.then(function(x){var d=new DOMParser().parseFromString(x,"application/xml"),g=function(c){var e=d.querySelector(\'Currency[CurrencyCode="\'+c+\'"] ForexSelling\');return e?parseFloat(e.textContent):0};'
         'var E=g("EUR"),U=g("USD");if(!(E>0&&U>0))return;L.forEach(function(el){var t=+el.dataset.tl,s=el.querySelector(".fx");if(!s){s=document.createElement("span");s.className="fx";el.appendChild(s)}'
         's.textContent=" ≈ €"+Math.round(t/E)+" · $"+Math.round(t/U)})}).catch(function(){})})();</script>'
         '<style>.ukart small .fx{display:block;font-size:12.5px;opacity:.9;margin-top:2px}</style>')


def kart_fiyatlari(s, dil, C=None):
    """Ana sayfa ürün kartları: yurt dışı fiyatı (KDV hariç Türkiye fiyatı x1,2, KDV yok) ve euro/dolar karşılığı"""
    def f(m):
        tl = float(m.group(1).replace('.', '')) * YD_CARPAN
        ek = html.unescape(m.group(2))
        onek = ONEK.get(dil, '') if "'den" in ek else ''
        temel = ek.replace("'den", '').strip()
        birim = (C or {}).get(temel) or re.sub(r"\+ KDV\s*", '', temel).strip()
        return '<small data-tl="%.2f"><span>%s%s ₺</span>%s' % (tl, onek, _sayi(tl, dil), (' <span>%s</span>' % birim) if birim else '')
    s = re.sub(r'<small><span>([\d.]+) ₺</span> <span>([^<]*)</span>', f, s)
    return s.replace('</body>', FX_JS + '</body>', 1)


def uret(dist, diller, yerel, rtl_css):
    """Yeni tasarım sayfalarını (ana sayfa, sipariş panelleri, ödeme) her dile çevirir.
    diller: {kod: (ad, yon)} — 'en' dahil. Dönüş: {dil: çevirisi eksik metin sayısı}"""
    import glob, shutil
    harita = _tr_en_haritasi(dist)
    kaynaklar = ['index.html', 'odeme/index.html'] + sorted(f[len(dist) + 1:] for f in glob.glob('%s/siparis/*/index.html' % dist))
    eksik = {}
    for dil, (ad, yon) in diller.items():
        C = sozluk(dil)
        for k in kaynaklar:
            s = open(os.path.join(dist, k), encoding='utf-8').read()
            for t in metinler(s):
                if not C.get(t):
                    eksik.setdefault(dil, set()).add(t)
            if k == 'index.html':
                s = kart_fiyatlari(s, dil, C)
            s = cevir(s, C)
            yol = '/' + k.replace('index.html', '')
            # dil, yön, dil değişkeni
            s = re.sub(r'<html lang="tr"', '<html lang="%s" dir="%s"' % (dil, yon), s, count=1)
            s = s.replace('<head>', '<head>\n<script>window.IPL_DIL=%s;window.IPL_YEREL=%s;</script>' % (json.dumps(dil), json.dumps(yerel.get(dil, 'en-GB'))), 1)
            if yon == 'rtl':
                s = s.replace('</head>', rtl_css + '</head>', 1)
            # adresler: kendi adresi, panel ve ödeme bu dilde; karşılığı olan sayfalara o dilin sayfası
            s = s.replace('href="%s%s"' % (SITE, yol), 'href="%s/%s%s"' % (SITE, dil, yol)).replace('content="%s%s"' % (SITE, yol), 'content="%s/%s%s"' % (SITE, dil, yol))
            s = s.replace("'/siparis/'+", "'/%s/siparis/'+" % dil).replace('src="/odeme/odeme.js"', 'src="/%s/odeme/odeme.js"' % dil)
            def bag(m):
                p = m.group(2)
                yalin, _, ek = p.partition('#')
                if yalin in harita:
                    return '%s="%s%s"' % (m.group(1), harita[yalin].replace('/en/', '/%s/' % dil, 1), ('#' + ek) if ek else '')
                if yalin == '/':
                    return '%s="/%s/%s"' % (m.group(1), dil, ('#' + ek) if ek else '')
                return m.group(0)
            s = re.sub(r'(href)="(/[^"]*)"', bag, s)
            s = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?', '', s)
            if k == 'index.html':  # dil bağlantıları için Türkçe karşılığı
                s = s.replace('</head>', '<link rel="alternate" hreflang="tr" href="%s/">\n</head>' % SITE, 1)
            hedef = os.path.join(dist, dil, k)
            os.makedirs(os.path.dirname(hedef), exist_ok=True)
            open(hedef, 'w', encoding='utf-8').write(s)
        # ödeme betiği
        js = open(os.path.join(dist, 'odeme', 'odeme.js'), encoding='utf-8').read()
        open(os.path.join(dist, dil, 'odeme', 'odeme.js'), 'w', encoding='utf-8').write(cevir('<script>' + js + '</script>', C)[8:-9])
        for t in metinler('<script>' + js + '</script>'):
            if not C.get(t):
                eksik.setdefault(dil, set()).add(t)
    return {d: len(v) for d, v in eksik.items()}
