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
KOD_GIBI = re.compile(r'[{}=;<>]|^[\w.#\-\[\]:()]+$|^\s*$|https?:|^/')
KENAR = re.compile(r'^(\s*)(.*?)(\s*)$', re.S)


def _parca(s):
    return re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->)', s, flags=re.S)


def _dogal(t):
    """insan için yazılmış metin mi (kod parçası değil)"""
    t = t.strip()
    return len(t) > 1 and TR_HARF.search(t) and not KOD_GIBI.search(t)


def metinler(s):
    out = []
    for i, p in enumerate(_parca(s)):
        if i % 2:
            if p.startswith('<script') and 'ld+json' in p[:80]:
                out += [json.loads('"%s"' % m.group(2)) for m in LD_RE.finditer(p) if _dogal(json.loads('"%s"' % m.group(2)))]
            elif p.startswith('<script'):
                out += [m.group(1).replace("\\'", "'") for m in JS_STR.finditer(p) if ' ' in m.group(1) and _dogal(m.group(1).replace("\\'", "'"))]
            continue
        out += [KENAR.match(html.unescape(m.group(1))).group(2) for m in METIN_RE.finditer(p) if _dogal(html.unescape(m.group(1)))]
        out += [html.unescape(m.group(2)).strip() for m in OZ_RE.finditer(p) if _dogal(html.unescape(m.group(2)))]
    return out


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
                def jsr(m):
                    v = C.get(m.group(1).replace("\\'", "'"))
                    return "'%s'" % v.replace('\\', '\\\\').replace("'", "\\'") if v else m.group(0)
                x = JS_STR.sub(jsr, x)
            p[i] = x
            continue
        x = METIN_RE.sub(lambda m: '>%s<' % html.escape(_c(html.unescape(m.group(1)), C), quote=False), x)
        x = OZ_RE.sub(lambda m: '%s="%s"' % (m.group(1), html.escape(_c(html.unescape(m.group(2)), C))), x)
        p[i] = x
    return ''.join(p)


def sozluk(dil, kok='ceviri_tr'):
    yol = os.path.join(kok, '%s.json' % dil)
    return json.load(open(yol, encoding='utf-8')) if os.path.exists(yol) else {}
