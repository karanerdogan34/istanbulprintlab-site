# -*- coding: utf-8 -*-
"""IstanbulPrintLab site derlemesi.
Kaynak: site/ (fiyatlar {{anahtar}} işaretli) + content/*.json (yönetim panelinden düzenlenir)
Çıktı: dist/ — Netlify yalnızca dist/ klasörünü yayınlar.
Çalıştırma: python3 build.py
"""
import glob, html, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, 'src'))
import sayfalar as S  # noqa: E402

E = html.escape
DIST = 'dist'


def oku(p):
    return open(p, encoding='utf-8').read()


def yaz(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(s)


def js(p):
    return json.load(open(p, encoding='utf-8'))


# ---------- anasayfa proje kartları ----------
KART = '''<a href="{href}"><div class="clip"><img class="ph" src="{src}" alt="{alt}" loading="lazy" style="height:420px"></div><div><span class="tag">{tag}</span><h3>{t}</h3><p>{d}{oku}</p></div></a>'''


def projeler_html():
    out = []
    for p in js('content/projeler.json').get('projeler', []):
        if p.get('gizle') or not p.get('gorsel'):
            continue
        link = (p.get('baglanti') or '').strip()
        out.append(KART.format(
            href=E(link or '#teklif'), src=E(p['gorsel']),
            alt=E(p.get('alt') or '%s — %s' % (p.get('baslik', ''), p.get('aciklama', ''))),
            tag=E(p.get('etiket', '')), t=E(p.get('baslik', '')), d=E(p.get('aciklama', '')),
            oku=' <b>Vaka çalışmasını oku →</b>' if link else ''))
    return '\n' + '\n'.join(out) + '\n'


# ---------- fiyatlar ----------
TOK = re.compile(r'\{\{([a-z0-9_]+)(?:\*([\d.]+))?(\+kdv|:ham)?\}\}')


def fiyat_isle(s, P):
    def r(m):
        if m.group(1) not in P:
            return m.group(0)
        n = float(P[m.group(1)]) * float(m.group(2) or 1)
        if m.group(3) == '+kdv':
            n = n * 1.2
        n = int(round(n))
        return str(n) if m.group(3) == ':ham' else '{:,}'.format(n).replace(',', '.')
    return TOK.sub(r, s)


# ---------- iletişim ----------
ESKI = {'telefon': '+90 532 523 73 64', 'eposta': 'info@istanbulprintlab.com',
        'adres': 'Fikirtepe Mah. Dispanser Sok. No:50/A-B', 'ilce': 'Kadıköy'}


def tel(t):
    d = re.sub(r'\D', '', t)
    if d.startswith('0'):
        d = '90' + d[1:]
    if not d.startswith('90'):
        d = '90' + d
    g = '+90 %s %s %s %s' % (d[2:5], d[5:8], d[8:10], d[10:]) if len(d) == 12 else '+' + d
    return g, '+' + d, d


def iletisim_ciftleri():
    yeni = dict(ESKI)
    yeni.update({k: (v or '').strip() for k, v in js('content/iletisim.json').items() if (v or '').strip()})
    if yeni == ESKI:
        return []
    (og, op, od), (ng, np_, nd) = tel(ESKI['telefon']), tel(yeni['telefon'])
    c = [(og, ng), (op, np_), (od, nd), (ESKI['eposta'], yeni['eposta']), (ESKI['adres'], yeni['adres']),
         (', %s / ' % ESKI['ilce'], ', %s / ' % yeni['ilce']),
         ('"addressLocality":"%s"' % ESKI['ilce'], '"addressLocality":"%s"' % yeni['ilce'])]
    return [(a, b) for a, b in c if a != b]


# ---------- vaka çalışmaları ----------
def vakalar():
    sablon = oku('site/projeler/antre-gourmet/index.html')
    sluglar = []
    for f in sorted(glob.glob('content/vakalar/*.json')):
        d = js(f)
        if d.get('taslak'):
            continue
        d['slug'] = re.sub(r'[^a-z0-9-]', '', (d.get('slug') or os.path.splitext(os.path.basename(f))[0]).strip().lower())
        sluglar.append((d['slug'], d))
        yaz('%s/projeler/%s/index.html' % (DIST, d['slug']), S.uret_vaka(sablon, 'antre-gourmet', d))
    if 'antre-gourmet' not in [x for x, _ in sluglar]:
        shutil.rmtree('%s/projeler/antre-gourmet' % DIST, ignore_errors=True)
    # site haritası: silinen projeleri çıkar, yenilerini ekle (mevcut satırlar yerinde kalır)
    sm = oku('%s/sitemap.xml' % DIST)
    var = set(re.findall(r'https://www\.istanbulprintlab\.com/projeler/([^/<]+)/', sm))
    yeni = [x for x, _ in sluglar]
    for sl in var - set(yeni):
        sm = re.sub(r'\n?[ \t]*<url><loc>https://www\.istanbulprintlab\.com/projeler/%s/</loc>.*?</url>' % re.escape(sl), '', sm, flags=re.S)
    ek = ''.join('  <url><loc>https://www.istanbulprintlab.com/projeler/%s/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n' % sl for sl in yeni if sl not in var)
    if ek:
        sm = sm.replace('</urlset>', ek + '</urlset>')
    yaz('%s/sitemap.xml' % DIST, sm)


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    shutil.copytree('site', DIST)
    # ürün sayfaları
    for f in glob.glob('content/sayfalar/*.json'):
        d = js(f)
        p = '%s/%s/index.html' % (DIST, d['yol'])
        if os.path.exists(p):
            yaz(p, S.uygula_urun(oku(p), d))
    # anasayfa
    p = '%s/index.html' % DIST
    s = S.uygula_ana(oku(p), js('content/anasayfa.json'))
    s = re.sub(r'<!--PROJELER-->.*?<!--/PROJELER-->', lambda m: '<!--PROJELER-->' + projeler_html() + '<!--/PROJELER-->', s, flags=re.S)
    yaz(p, s)
    vakalar()
    # fiyat ve iletişim — bütün sayfalara
    P = js('content/fiyatlar.json')
    cift = iletisim_ciftleri()
    for kok, _, dosyalar in os.walk(DIST):
        if kok.startswith(os.path.join(DIST, 'admin')):
            continue
        for f in dosyalar:
            if not f.endswith('.html'):
                continue
            yol = os.path.join(kok, f)
            s = oku(yol)
            s2 = fiyat_isle(s, P)
            for a, b in cift:
                s2 = s2.replace(a, b)
            if s2 != s:
                yaz(yol, s2)
    kalan = [os.path.join(k, f) for k, _, fs in os.walk(DIST) for f in fs if f.endswith('.html') and TOK.search(oku(os.path.join(k, f)))]
    if kalan:
        raise SystemExit('Fiyat işareti kaldı: %s' % kalan[:5])
    print('Derleme tamam.')


if __name__ == '__main__':
    main()
