# -*- coding: utf-8 -*-
"""Ek diller: /en/ sayfalarından /ar/ /ru/ /fr/ /de/ /ur/ sayfalarını üretir.
Çeviriler ceviri/<dil>.json dosyalarında (İngilizce metin -> hedef dil). Çevirisi olmayan metin İngilizce kalır.
Mantık (hesaplayıcı, döviz, formlar) İngilizce sayfalarla aynıdır; yalnızca görünen metin, dil/yön ve bağlantılar değişir.
"""
import glob, html, json, os, re

DILLER = {  # kod: (adı kendi dilinde, yön)
    'ar': ('العربية', 'rtl'), 'ru': ('Русский', 'ltr'), 'fr': ('Français', 'ltr'),
    'de': ('Deutsch', 'ltr'), 'ur': ('اردو', 'rtl'),
}
SITE = 'https://www.istanbulprintlab.com'
METIN_RE = re.compile(r'>([^<>]*[A-Za-z][^<>]*)<')
OZ_RE = re.compile(r'\b(content|alt|title|placeholder|aria-label|data-name|value)="([^"]*[A-Za-z][^"]*)"')
JS_RE = re.compile(r"EN\s*\?\s*\(?\s*'((?:[^'\\]|\\.)*)'")
# WhatsApp'a giden hazır mesaj parçaları işletme için İngilizce kalır
JS_KORU = {'Hello, I would like a quote for ', 'lamination: ', 'en-GB'}
ATLA = re.compile(r'^(https?:|/|#|mailto:|tel:|[\w.-]+@|\{\{[^}]*\}\}$)|^[\d\s.,:;%€$₺+×x·/()\-–—|]*$')


KENAR = re.compile(r'^([\s/·|]*)(.*?)([\s/·|]*)$', re.S)


def _parcala(s):
    """(önce, script/style blokları korunarak) metin parçalarını döndürür"""
    return re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->)', s, flags=re.S)


def _gecerli(t):
    t = KENAR.match(t).group(2) if not t.strip().startswith(('/', 'http')) or ' ' in t.strip() else t.strip()
    return len(t) > 1 and not ATLA.match(t) and re.search(r'[A-Za-z]{2}', t)


def metinler(s):
    out = []
    for i, p in enumerate(_parcala(s)):
        if i % 2:
            if p.startswith('<script') and 'ld+json' in p[:60]:
                for m in re.finditer(r'"(name|text|description|headline|alternateName)":\s*"((?:[^"\\]|\\.)*)"', p):
                    if _gecerli(m.group(2)):
                        out.append(json.loads('"%s"' % m.group(2)))
            elif p.startswith('<script'):
                out += [m.group(1).replace("\\'", "'") for m in JS_RE.finditer(p) if _gecerli(m.group(1))]
            continue
        out += [_cekirdek(html.unescape(m.group(1))) for m in METIN_RE.finditer(p) if _gecerli(html.unescape(m.group(1)))]
        out += [html.unescape(m.group(2)).strip() for m in OZ_RE.finditer(p) if _gecerli(html.unescape(m.group(2)))]
    return out




def _cekirdek(t):
    return KENAR.match(t).group(2)


def _cevir_metin(t, C):
    a, t2, b = KENAR.match(t).groups()
    if t2 in C and C[t2]:
        return a + C[t2] + b
    return t


def cevir(s, dil, C):
    ad, yon = DILLER[dil]
    parcalar = _parcala(s)
    for i, p in enumerate(parcalar):
        if i % 2:
            if p.startswith('<script') and 'ld+json' in p[:60]:
                def jr(m):
                    v = json.loads('"%s"' % m.group(2))
                    v2 = C.get(v.strip())
                    return m.group(0) if not v2 else '"%s": %s' % (m.group(1), json.dumps(v2, ensure_ascii=False))
                p = re.sub(r'"(name|text|description|headline|alternateName)":\s*"((?:[^"\\]|\\.)*)"', jr, p)
            elif p.startswith('<script'):
                def jsr(m):
                    v = m.group(1).replace("\\'", "'")
                    v2 = C.get(v)
                    return m.group(0) if not v2 or v in JS_KORU else "'%s'" % v2.replace("'", "\\'")
                p = re.sub(r"'((?:[^'\\\n]|\\.)*)'", jsr, p)
            parcalar[i] = p
            continue
        p = METIN_RE.sub(lambda m: '>%s<' % html.escape(_cevir_metin(html.unescape(m.group(1)), C), quote=False) if _gecerli(html.unescape(m.group(1))) else m.group(0), p)
        p = OZ_RE.sub(lambda m: '%s="%s"' % (m.group(1), html.escape(_cevir_metin(html.unescape(m.group(2)), C))) if _gecerli(html.unescape(m.group(2))) and m.group(1) != 'value' else m.group(0), p)
        parcalar[i] = p
    s = ''.join(parcalar)
    # dil, yön, bağlantılar
    s = re.sub(r'<html lang="en"', '<html lang="%s" dir="%s"' % (dil, yon), s, count=1)
    s = s.replace('href="/en/', 'href="/%s/' % dil).replace(SITE + '/en/', '%s/%s/' % (SITE, dil))
    s = re.sub(r'(<div class="view"[^>]*) lang="en"', r'\1 lang="%s"' % dil, s)
    s = s.replace("closest('[lang=en]')", "closest('[lang=%s]')" % dil)
    s = s.replace('"inLanguage": "en"', '"inLanguage": "%s"' % dil)
    s = re.sub(r'<meta property="og:locale" content="[^"]*">', '<meta property="og:locale" content="%s">' % dil, s)
    if yon == 'rtl':
        s = s.replace('</head>', RTL_CSS + '</head>', 1)
    return s


RTL_CSS = ('<style>html[dir=rtl] body{font-family:"Noto Naskh Arabic","Segoe UI",Tahoma,Arial,sans-serif}'
           'html[dir=rtl] input[type=number],html[dir=rtl] input[type=tel],html[dir=rtl] input[type=email],html[dir=rtl] [dir=ltr]{direction:ltr;text-align:right}'
           'html[dir=rtl] body>a[href="#icerik"]:not(:focus){left:auto!important;right:-9999px}'
           'html[dir=rtl] .mTotal,html[dir=rtl] .mFx,html[dir=rtl] a[href^="tel:"]{direction:ltr;unicode-bidi:isolate;display:inline-block}</style>')


def en_sayfalar(dist):
    return sorted(glob.glob('%s/en/**/index.html' % dist, recursive=True))


def cikar(dist, hedef):
    """Çevrilecek tüm İngilizce metinleri tek listede toplar (çeviri dosyası hazırlamak için)."""
    gor, liste = set(), []
    for f in en_sayfalar(dist):
        for t in metinler(open(f, encoding='utf-8').read()):
            if t not in gor:
                gor.add(t)
                liste.append(t)
    json.dump(liste, open(hedef, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return liste


def uret(dist, kok='ceviri'):
    """dist/en altındaki her sayfadan diğer dillerin sayfalarını üretir; çevirisi eksik metinleri döndürür."""
    eksik = {}
    for dil in DILLER:
        yol = os.path.join(kok, '%s.json' % dil)
        C = json.load(open(yol, encoding='utf-8')) if os.path.exists(yol) else {}
        for f in en_sayfalar(dist):
            s = open(f, encoding='utf-8').read()
            hedef = f.replace('%s/en/' % dist, '%s/%s/' % (dist, dil), 1)
            os.makedirs(os.path.dirname(hedef), exist_ok=True)
            open(hedef, 'w', encoding='utf-8').write(cevir(s, dil, C))
            for t in metinler(s):
                if not C.get(t):
                    eksik.setdefault(dil, set()).add(t)
    return {k: len(v) for k, v in eksik.items()}


# ---------- dil seçici, hreflang, site haritası (bütün dillerdeki sayfalar derlendikten sonra) ----------
TUM = ['tr', 'en'] + list(DILLER)
KISA = {'tr': 'TR', 'en': 'EN', 'ar': 'AR', 'ru': 'RU', 'fr': 'FR', 'de': 'DE', 'ur': 'UR'}
SECICI_CSS = ('<style>.dilsec{position:relative;display:inline-block;overflow:visible!important}.dilsec>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px}'
              '.dilsec>summary::-webkit-details-marker{display:none}.dilsec>summary::after{content:"▾";font-size:11px}'
              '.dilsec>div{position:absolute;top:calc(100% + 8px);inset-inline-end:0;background:#fff;border:1px solid #E4E4E0;border-radius:8px;padding:6px;z-index:120;'
              'display:grid;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,.08)}.dilsec>div a{padding:8px 10px;border-radius:6px;text-decoration:none;color:#0B0B0B;white-space:nowrap}'
              '.dilsec>div a:hover,.dilsec>div a[aria-current]{background:#F4F4F1}</style>')
ADLAR = dict({'tr': 'Türkçe', 'en': 'English'}, **{k: v[0] for k, v in DILLER.items()})


def _karsiliklar(dist):
    """her sayfa için {dil: url} eşlemesi; TR<->EN eşlemesi sayfalardaki hreflang etiketlerinden okunur"""
    gruplar = []
    for f in glob.glob('%s/en/**/index.html' % dist, recursive=True):
        s = open(f, encoding='utf-8').read()
        yol = f[len(dist):].replace('index.html', '')
        tr = re.search(r'<link rel="alternate" hreflang="tr" href="%s([^"]*)">' % re.escape(SITE), s)
        g = {'en': yol}
        if tr:
            g['tr'] = tr.group(1)
        for d in DILLER:
            g[d] = yol.replace('/en/', '/%s/' % d, 1)
        gruplar.append(g)
    return gruplar


def _secici(g, aktif):
    linkler = ''.join('<a href="%s" hreflang="%s" lang="%s"%s>%s</a>' % (g[d], d, d, ' aria-current="true"' if d == aktif else '', ADLAR[d]) for d in TUM if d in g)
    return '<details class="dilsec"><summary aria-label="Language">%s</summary><div>%s</div></details>' % (KISA[aktif], linkler)


def baglantilar(dist):
    gruplar = _karsiliklar(dist)
    for g in gruplar:
        etiket = ''.join('<link rel="alternate" hreflang="%s" href="%s%s">\n' % (d, SITE, g[d]) for d in TUM if d in g)
        etiket += '<link rel="alternate" hreflang="x-default" href="%s%s">\n' % (SITE, g.get('tr', g['en']))
        for d in TUM:
            if d not in g:
                continue
            f = '%s%sindex.html' % (dist, g[d])
            if not os.path.exists(f):
                continue
            s = open(f, encoding='utf-8').read()
            s = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?', '', s)
            s = s.replace('</head>', etiket + SECICI_CSS + '</head>', 1)
            # üst çubuktaki TR / EN bağlantıları -> açılır dil seçici
            s = re.sub(r'<a href="[^"]*" id="langTR"[^>]*>TR</a><a href="[^"]*" id="langEN"[^>]*>EN</a>', lambda m: _secici(g, d), s, count=1)
            open(f, 'w', encoding='utf-8').write(s)
    # karşılığı olmayan Türkçe sayfalar: diğer diller ana sayfalarına gider
    for f in glob.glob('%s/**/index.html' % dist, recursive=True):
        s = open(f, encoding='utf-8').read()
        if 'id="langEN"' not in s:
            continue
        yol = f[len(dist):].replace('index.html', '')
        g = dict({'tr': yol, 'en': '/en/'}, **{d: '/%s/' % d for d in DILLER})
        s2 = re.sub(r'<a href="[^"]*" id="langTR"[^>]*>TR</a><a href="[^"]*" id="langEN"[^>]*>EN</a>', lambda m: _secici(g, 'tr'), s, count=1)
        if s2 != s:
            open(f, 'w', encoding='utf-8').write(s2.replace('</head>', SECICI_CSS + '</head>', 1))
    return gruplar


def site_haritasi(dist, gruplar):
    p = '%s/sitemap.xml' % dist
    if not os.path.exists(p):
        return
    s = open(p, encoding='utf-8').read()
    def alt(g):
        return ''.join('<xhtml:link rel="alternate" hreflang="%s" href="%s%s"/>' % (d, SITE, g[d]) for d in TUM if d in g) + \
            '<xhtml:link rel="alternate" hreflang="x-default" href="%s%s"/>' % (SITE, g.get('tr', g['en']))
    yeni = []
    for g in gruplar:
        a = alt(g)
        for d in TUM:
            if d not in g:
                continue
            loc = '<loc>%s%s</loc>' % (SITE, g[d])
            m = re.search(r'<url>%s(.*?)</url>' % re.escape(loc), s, flags=re.S)
            if m:
                ic = re.sub(r'<xhtml:link [^>]*/>', '', m.group(1))
                s = s.replace(m.group(0), '<url>%s%s%s</url>' % (loc, ic, a))
            elif d in DILLER:
                yeni.append('<url>%s%s</url>' % (loc, a))
    s = s.replace('</urlset>', '\n'.join(yeni) + '\n</urlset>')
    open(p, 'w', encoding='utf-8').write(s)
