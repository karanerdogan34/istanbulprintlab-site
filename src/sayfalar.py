# -*- coding: utf-8 -*-
"""Ürün sayfaları ve anasayfa: HTML içindeki düzenlenebilir alanları okur (cikar) ve
yönetim panelindeki JSON'a göre yeniden yazar (uygula). Biçim birebir korunur."""
import html, json, re

# ---------- metin <-> basit Markdown ([yazı](adres), **kalın**) ----------

def h2m(s):
    s = re.sub(r'<a href="([^"]*)">(.*?)</a>', lambda m: '[%s](%s)' % (m.group(2), m.group(1)), s, flags=re.S)
    s = re.sub(r'<b>(.*?)</b>', r'**\1**', s, flags=re.S)
    return html.unescape(s)


class IcerikHatasi(Exception):
    pass


GUVENLI_URL = re.compile(r'^(?:https?://[^\s"<>]+|/[^\s"<>]*|#[\w-]*|mailto:[^\s"<>]+|tel:\+?[\d ]+)$')
GUVENLI_GORSEL = re.compile(r'^/img/[A-Za-z0-9._/ -]+\.(?:webp|jpe?g|png|gif|svg|avif)$', re.I)


def guvenli_url(u):
    u = html.unescape(u or '').strip()
    if not GUVENLI_URL.match(u) or '..' in u:
        raise IcerikHatasi('İzin verilmeyen bağlantı adresi: %r (yalnızca /site-ici-adres, https://..., mailto:, tel: kullanılabilir)' % u)
    return attr(u)


def gorsel(u):
    u = (u or '').strip()
    if not GUVENLI_GORSEL.match(u) or '..' in u:
        raise IcerikHatasi('Geçersiz fotoğraf adresi: %r (fotoğraflar /img/ klasöründen seçilmeli)' % u)
    return attr(u)


def m2h(s):
    s = html.escape(s or '', quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: '<a href="%s">%s</a>' % (guvenli_url(m.group(2)), m.group(1)), s)
    return s


def m2t(s):
    """JSON-LD için düz metin."""
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', r'\1', s or '')
    return s.replace('**', '')


def attr(s):
    return html.escape(s or '', quote=True).replace('&#x27;', "'")


# ---------- yardımcılar ----------

def _bul(p, s, start=0, flags=re.S):
    return re.compile(p, flags).search(s, start)


def _ld_faq(s):
    """FAQPage mainEntity listesinin konumu (başlangıç, bitiş, liste)."""
    i = s.find('"FAQPage"')
    if i < 0:
        return None
    j = s.find('"mainEntity":', i)
    k = s.index('[', j)
    obj, end = json.JSONDecoder().raw_decode(s[k:])
    return k, k + end, obj


DETAY = re.compile(r'<details( open)?><summary>(.*?)<span class="plus" aria-hidden="true">\+</span></summary><p>(.*?)</p></details>', re.S)


def _faq_blok(s, bas=0):
    """İlk ardışık <details> dizisi (aralarında yalnız boşluk)."""
    m = DETAY.search(s, bas)
    if not m:
        return None
    a, b = m.start(), m.end()
    while True:
        n = DETAY.match(s, b) or DETAY.match(s, b + len(s[b:]) - len(s[b:].lstrip()))
        if not n or s[b:n.start()].strip():
            break
        b = n.end()
    return a, b, s[a:b]


def _sss_html(liste, ornek):
    ayrac = ornek.split('</details>')[1][:len(ornek.split('</details>')[1]) - len(ornek.split('</details>')[1].lstrip())] if ornek.count('</details>') > 1 else ''
    out = []
    for x in liste:
        out.append('<details%s><summary>%s<span class="plus" aria-hidden="true">+</span></summary><p>%s</p></details>' % (
            ' open' if x.get('acik') else '', m2h(x.get('soru')), m2h(x.get('cevap'))))
    return ayrac.join(out)


def _baslik_meta(s):
    t = _bul(r'<title>(.*?)</title>', s)
    d = _bul(r'<meta name="description" content="([^"]*)">', s)
    return (html.unescape(t.group(1)) if t else ''), (html.unescape(d.group(1)) if d else '')


def _meta_yaz(s, eski_t, eski_d, yeni_t, yeni_d):
    if yeni_t and yeni_t != eski_t:
        s = s.replace('<title>%s</title>' % html.escape(eski_t, quote=False), '<title>%s</title>' % html.escape(yeni_t, quote=False), 1)
        s = s.replace('content="%s"' % attr(eski_t), 'content="%s"' % attr(yeni_t))
    if yeni_d and yeni_d != eski_d:
        s = s.replace('content="%s"' % attr(eski_d), 'content="%s"' % attr(yeni_d))
    return s


# ---------- ürün sayfası ----------

def cikar_urun(s):
    d = {}
    d['seo_baslik'], d['seo_aciklama'] = _baslik_meta(s)
    p = s.index('class="wrap pdp"')
    m = _bul(r'<span class="tag">(.*?)</span>', s, p); d['etiket'] = h2m(m.group(1)) if m else ''
    m = _bul(r'<h1([^>]*)>(.*?)</h1>', s, p); d['baslik'] = h2m(m.group(2))
    m = _bul(r'</h1>\s*<p class="lead"[^>]*>(.*?)</p>', s, p); d['giris'] = h2m(m.group(1)) if m else ''
    m = _bul(r'<ul class="checks">\n(.*?)</ul>', s, p)
    d['neden'] = [h2m(x) for x in re.findall(r'<li class="ok"><span class="dot">✓</span><span>(.*?)</span></li>', m.group(1))] if m else []
    gm = _bul(r'<img class="gal-main ph"(?: id="[^"]*")? src="([^"]*)" alt="([^"]*)"', s, p)
    th = _bul(r'<div class="thumbs"[^>]*>\n(.*?)\n</div>', s, p)
    if th:
        d['fotolar'] = [dict(gorsel=b, aciklama=html.unescape(a), kucuk_aciklama=html.unescape(c))
                        for a, b, c in re.findall(r'<button type="button" aria-pressed="(?:true|false)" aria-label="([^"]*)" data-src="([^"]*)" data-alt="[^"]*"><img src="[^"]*" alt="([^"]*)"(?: loading="lazy")?></button>', th.group(1))]
    elif gm:
        d['fotolar'] = [dict(gorsel=gm.group(1), aciklama=html.unescape(gm.group(2)))]
    else:
        d['fotolar'] = []
    m = _bul(r'<table class="spec"><tbody>\n(.*?)</tbody></table>', s, p)
    d['ozellikler'] = [dict(ad=h2m(a), deger=h2m(b)) for a, b in re.findall(r'<tr><th scope="row">(.*?)</th><td>(.*?)</td></tr>', m.group(1))] if m else []
    f = _faq_blok(s, p)
    d['sss'] = [dict(soru=h2m(q), cevap=h2m(a), acik=bool(o)) for o, q, a in DETAY.findall(f[2])] if f else []
    return d


def uygula_urun(s, d):
    eski = cikar_urun(s)
    s = _meta_yaz(s, eski['seo_baslik'], eski['seo_aciklama'], d.get('seo_baslik'), d.get('seo_aciklama'))
    p = s.index('class="wrap pdp"')

    def sub1(pat, repl, s, grp=1):
        m = _bul(pat, s, p)
        if not m:
            raise IcerikHatasi('Sayfada beklenen alan bulunamadı: %s' % pat[:60])
        return s[:m.start(grp)] + repl + s[m.end(grp):]

    if eski['etiket'] or d.get('etiket'):
        s = sub1(r'<span class="tag">(.*?)</span>', m2h(d.get('etiket')), s)
    s = sub1(r'<h1[^>]*>(.*?)</h1>', m2h(d.get('baslik')), s)
    if eski['giris'] or d.get('giris'):
        s = sub1(r'</h1>\s*<p class="lead"[^>]*>(.*?)</p>', m2h(d.get('giris')), s)
    if eski['neden'] or d.get('neden'):
        s = sub1(r'<ul class="checks">\n(.*?)</ul>', ''.join('<li class="ok"><span class="dot">✓</span><span>%s</span></li>\n' % m2h(x) for x in d.get('neden') or []), s)
    fot = [x for x in d.get('fotolar') or [] if x.get('gorsel')]
    if fot:
        s = sub1(r'<img class="gal-main ph"(?: id="[^"]*")? src="([^"]*)"', gorsel(fot[0]['gorsel']), s)
        s = sub1(r'<img class="gal-main ph"(?: id="[^"]*")? src="[^"]*" alt="([^"]*)"', attr(fot[0].get('aciklama')), s)
        th = _bul(r'<div class="thumbs"[^>]*>\n(.*?)\n</div>', s, p)
        if th:
            ilk_lazy = 'loading="lazy"></button>' in th.group(1).split('\n')[0]
            s = sub1(r'<div class="thumbs"[^>]*>\n(.*?)\n</div>', '\n'.join(
                '<button type="button" aria-pressed="%s" aria-label="%s" data-src="%s" data-alt="%s"><img src="%s" alt="%s"%s></button>' % (
                    'true' if i == 0 else 'false', attr(x.get('aciklama')), gorsel(x['gorsel']), attr(x.get('aciklama')), gorsel(x['gorsel']),
                    attr(x.get('kucuk_aciklama') or x.get('aciklama')), '' if (i == 0 and not ilk_lazy) else ' loading="lazy"') for i, x in enumerate(fot)), s)
    if eski['ozellikler'] or d.get('ozellikler'):
        s = sub1(r'<table class="spec"><tbody>\n(.*?)</tbody></table>', ''.join(
            '<tr><th scope="row">%s</th><td>%s</td></tr>\n' % (m2h(x.get('ad')), m2h(x.get('deger'))) for x in d.get('ozellikler') or []), s)
    s = _sss_yaz(s, d.get('sss'), p)
    return s


def _sss_yaz(s, sss, p):
    if sss is None:
        return s
    f = _faq_blok(s, p)
    if not f:
        if sss:
            raise IcerikHatasi('Bu sayfada SSS bölümü yok; SSS eklenemez.')
        return s
    a, b, ornek = f
    eski_sorular = [m2t(h2m(q)) for _, q, _ in DETAY.findall(ornek)]
    s = s[:a] + _sss_html(sss, ornek) + s[b:]
    ld = _ld_faq(s)
    if ld and [x.get('name') for x in ld[2]] == eski_sorular:
        k, e, eski = ld
        yeni = [{"@type": "Question", "name": m2t(x.get('soru')), "acceptedAnswer": {"@type": "Answer", "text": m2t(x.get('cevap'))}} for x in sss]
        s = s[:k] + json.dumps(yeni, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e') + s[e:]
    return s


# ---------- anasayfa ----------

def _bolum(s, sid):
    i = s.index('id="%s"' % sid)
    a = s.rfind('<section', 0, i)
    return a, s.index('</section>', a)


def cikar_ana(s):
    d = {}
    d['seo_baslik'], d['seo_aciklama'] = _baslik_meta(s)
    m = _bul(r'<h1 class="hsmall"><span class="regmark" aria-hidden="true"></span>(.*?)</h1>', s); d['ust_baslik'] = h2m(m.group(1))
    d['buyuk_baslik'] = [h2m(x) for x in re.findall(r'<span class="ln"><span>(.*?)</span></span>', _bul(r'<p class="hbig">(.*?)</p>', s).group(1))]
    m = _bul(r'<p class="lead" style="font-size:20px">(.*?)</p>', s); d['giris'] = h2m(m.group(1))
    m = _bul(r'<p class="hfast">(.*?)</p>', s); d['hiz_notu'] = h2m(m.group(1))
    a, b = _bolum(s, 'yilbasi-bant'); y = s[a:b]
    d['yilbasi'] = dict(
        goster=True,
        gorsel=_bul(r'<img class="ph" src="([^"]*)"', y).group(1),
        gorsel_aciklama=html.unescape(_bul(r'<img class="ph" src="[^"]*" alt="([^"]*)"', y).group(1)),
        ust_yazi=h2m(_bul(r'<span class="eyebrow">(.*?)</span>', y).group(1)),
        baslik=h2m(_bul(r'<h2 class="h2">(.*?)</h2>', y).group(1)),
        maddeler=[h2m(x) for x in re.findall(r'<li class="ok"><span class="dot">✓</span><span>(.*?)</span></li>', y)])
    a, b = _bolum(s, 'cam-filmi-bant'); c = s[a:b]
    d['cam_filmi'] = dict(
        ust_yazi=h2m(_bul(r'<span class="tag">(.*?)</span>', c).group(1)),
        baslik=h2m(_bul(r'<h2 class="h2">(.*?)</h2>', c).group(1)),
        giris=h2m(_bul(r'<p class="lead">(.*?)</p>', c).group(1)))
    a, b = _bolum(s, 'sss')
    d['sss'] = [dict(soru=h2m(q), cevap=h2m(x), acik=bool(o)) for o, q, x in DETAY.findall(s[a:b])]
    return d


def uygula_ana(s, d):
    eski = cikar_ana(s)
    s = _meta_yaz(s, eski['seo_baslik'], eski['seo_aciklama'], d.get('seo_baslik'), d.get('seo_aciklama'))

    def sub1(pat, repl, s, bas=0, grp=1):
        m = _bul(pat, s, bas)
        if not m:
            raise IcerikHatasi('Anasayfada beklenen alan bulunamadı: %s' % pat[:60])
        return s[:m.start(grp)] + repl + s[m.end(grp):]

    s = sub1(r'<h1 class="hsmall"><span class="regmark" aria-hidden="true"></span>(.*?)</h1>', m2h(d.get('ust_baslik')), s)
    s = sub1(r'<p class="hbig">(.*?)</p>', ' '.join('<span class="ln"><span>%s</span></span>' % m2h(x) for x in d.get('buyuk_baslik') or []), s)
    s = sub1(r'<p class="lead" style="font-size:20px">(.*?)</p>', m2h(d.get('giris')), s)
    s = sub1(r'<p class="hfast">(.*?)</p>', m2h(d.get('hiz_notu')), s)
    y = d.get('yilbasi') or {}
    a, b = _bolum(s, 'yilbasi-bant')
    if y.get('goster') is False:
        s = s[:a] + '<!-- yılbaşı bandı gizli -->' + s[b + len('</section>'):]
    else:
        sec = s[a:b]
        sec = sub1(r'<img class="ph" src="([^"]*)"', gorsel(y.get('gorsel', '')), sec)
        sec = sub1(r'<img class="ph" src="[^"]*" alt="([^"]*)"', attr(y.get('gorsel_aciklama')), sec)
        sec = sub1(r'<span class="eyebrow">(.*?)</span>', m2h(y.get('ust_yazi')), sec)
        sec = sub1(r'<h2 class="h2">(.*?)</h2>', m2h(y.get('baslik')), sec)
        sec = sub1(r'<ul class="checks">\n(.*?)</ul>', ''.join('<li class="ok"><span class="dot">✓</span><span>%s</span></li>\n' % m2h(x) for x in y.get('maddeler') or []), sec)
        s = s[:a] + sec + s[b:]
    c = d.get('cam_filmi') or {}
    a, b = _bolum(s, 'cam-filmi-bant'); sec = s[a:b]
    sec = sub1(r'<span class="tag">(.*?)</span>', m2h(c.get('ust_yazi')), sec)
    sec = sub1(r'<h2 class="h2">(.*?)</h2>', m2h(c.get('baslik')), sec)
    sec = sub1(r'<p class="lead">(.*?)</p>', m2h(c.get('giris')), sec)
    s = s[:a] + sec + s[b:]
    a, b = _bolum(s, 'sss')
    s = _sss_yaz(s, d.get('sss'), a)
    return s


# ---------- vaka çalışması (proje) sayfaları ----------

def cikar_vaka(s, slug):
    d = {'slug': slug}
    d['seo_baslik'], d['seo_aciklama'] = _baslik_meta(s)
    d['firma'] = h2m(_bul(r'<div class="wrap crumbs">.*? / <a href="/#projeler">Projeler</a> / (.*?)</div>', s).group(1))
    d['etiket'] = h2m(_bul(r'<span class="tag">(.*?)</span>', s, s.index('<main')).group(1))
    d['baslik'] = h2m(_bul(r'<h1 class="h2"[^>]*>(.*?)</h1>', s).group(1))
    m = _bul(r'<section class="wrap"><img class="ph" src="([^"]*)" alt="([^"]*)"', s)
    d['kapak'], d['kapak_aciklama'] = m.group(1), html.unescape(m.group(2))
    d['ihtiyac'] = h2m(_bul(r'<h2 style="font-size:28px">İhtiyaç</h2><p class="lead"[^>]*>(.*?)</p>', s).group(1))
    d['zorluk'] = h2m(_bul(r'<h2 style="font-size:28px">Zorluk</h2><p class="lead"[^>]*>(.*?)</p>', s).group(1))
    d['cozum'] = [h2m(x) for x in re.findall(r'<li>(.*?)</li>', _bul(r'<h2 style="font-size:28px">Çözüm</h2><ul[^>]*>(.*?)</ul>', s).group(1))]
    d['bilgiler'] = [dict(ad=h2m(a), deger=h2m(b)) for a, b in re.findall(r'<tr><th scope="row">(.*?)</th><td>(.*?)</td></tr>', _bul(r'<table class="spec"><tbody>\n(.*?)</tbody></table>', s).group(1))]
    g = _bul(r'<div class="grid g4">\n(.*?)</div>', s).group(1)
    d['kareler'] = [dict(gorsel=a, aciklama=html.unescape(b)) for a, b in re.findall(r'<img class="ph" src="([^"]*)" alt="([^"]*)"', g)]
    return d


def uret_vaka(sablon, sablon_slug, d):
    """Antre Gourmet sayfasını şablon alarak yeni (veya güncellenmiş) proje sayfası üretir."""
    eski = cikar_vaka(sablon, sablon_slug)
    s = sablon
    slug = d['slug']
    if slug != sablon_slug:
        # İngilizce karşılığı yok: dil bağlantılarını kaldır
        s = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?', '', s)
        s = s.replace(' data-en="en-%s"' % sablon_slug, '')
        s = s.replace('href="/en/projects/%s/"' % sablon_slug, 'href="/en/"')
        s = s.replace('/projeler/%s/' % sablon_slug, '/projeler/%s/' % slug)
        s = s.replace('data-view="%s"' % sablon_slug, 'data-view="%s"' % slug)
        s = s.replace('<!-- ============ VAKA: %s ============ -->' % eski['firma'].upper(), '<!-- ============ VAKA: %s ============ -->' % d.get('firma', '').upper())
    if slug == sablon_slug:
        yt, yd = d.get('seo_baslik') or eski['seo_baslik'], d.get('seo_aciklama') or eski['seo_aciklama']
    else:
        yt = d.get('seo_baslik') or '%s | IstanbulPrintLab' % m2t(d.get('baslik') or d.get('firma'))
        yd = d.get('seo_aciklama') or m2t(d.get('ihtiyac'))[:155]
    s = _meta_yaz(s, eski['seo_baslik'], eski['seo_aciklama'], yt, yd)
    if d.get('firma') != eski['firma']:
        s = s.replace('<a href="/#projeler">Projeler</a> / %s</div>' % m2h(eski['firma']), '<a href="/#projeler">Projeler</a> / %s</div>' % m2h(d.get('firma')))
        s = s.replace('"name": %s, "item": "https://www.istanbulprintlab.com/projeler/' % json.dumps(m2t(eski['firma']), ensure_ascii=False),
                      '"name": %s, "item": "https://www.istanbulprintlab.com/projeler/' % json.dumps(m2t(d.get('firma')), ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e'))
    m0 = s.index('<main')

    def sub1(pat, repl, s, grp=1):
        m = _bul(pat, s, m0)
        if not m:
            raise IcerikHatasi('Proje şablonunda beklenen alan bulunamadı: %s' % pat[:60])
        return s[:m.start(grp)] + repl + s[m.end(grp):]

    s = sub1(r'<span class="tag">(.*?)</span>', m2h(d.get('etiket')), s)
    s = sub1(r'<h1 class="h2"[^>]*>(.*?)</h1>', m2h(d.get('baslik')), s)
    s = sub1(r'<section class="wrap"><img class="ph" src="([^"]*)"', gorsel(d.get('kapak') or eski['kapak']), s)
    s = sub1(r'<section class="wrap"><img class="ph" src="[^"]*" alt="([^"]*)"', attr(d.get('kapak_aciklama')), s)
    s = sub1(r'<h2 style="font-size:28px">İhtiyaç</h2><p class="lead"[^>]*>(.*?)</p>', m2h(d.get('ihtiyac')), s)
    s = sub1(r'<h2 style="font-size:28px">Zorluk</h2><p class="lead"[^>]*>(.*?)</p>', m2h(d.get('zorluk')), s)
    s = sub1(r'<h2 style="font-size:28px">Çözüm</h2><ul[^>]*>(.*?)</ul>', ''.join('<li>%s</li>' % m2h(x) for x in d.get('cozum') or []), s)
    s = sub1(r'<table class="spec"><tbody>\n(.*?)</tbody></table>', ''.join('<tr><th scope="row">%s</th><td>%s</td></tr>\n' % (m2h(x.get('ad')), m2h(x.get('deger'))) for x in d.get('bilgiler') or []), s)
    s = sub1(r'<div class="grid g4">\n(.*?)</div>', ''.join('<img class="ph" src="%s" alt="%s" loading="lazy" style="height:260px">\n' % (gorsel(x['gorsel']), attr(x.get('aciklama'))) for x in d.get('kareler') or [] if x.get('gorsel')), s)
    return s
