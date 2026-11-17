# -*- coding: utf-8 -*-
"""IstanbulPrintLab site derlemesi.
content/*.json (yönetim panelinden düzenlenir) site/ içindeki sayfalara işlenir.
Netlify her yayında bunu çalıştırır: python3 build.py
"""
import html, json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
E = html.escape

KART = '''<a href="{href}"><div class="clip"><img class="ph" src="{src}" alt="{alt}" loading="lazy" style="height:420px"></div><div><span class="tag">{tag}</span><h3>{t}</h3><p>{d}{oku}</p></div></a>'''


def projeler_html():
    data = json.load(open('content/projeler.json', encoding='utf-8'))
    out = []
    for p in data.get('projeler', []):
        if p.get('gizle') or not p.get('gorsel'):
            continue
        link = (p.get('baglanti') or '').strip()
        out.append(KART.format(
            href=E(link or '#teklif'), src=E(p['gorsel']),
            alt=E(p.get('alt') or '%s — %s' % (p.get('baslik', ''), p.get('aciklama', ''))),
            tag=E(p.get('etiket', '')), t=E(p.get('baslik', '')), d=E(p.get('aciklama', '')),
            oku=' <b>Vaka çalışmasını oku →</b>' if link else ''))
    return '\n' + '\n'.join(out) + '\n'


# Sitedeki iletişim bilgilerinin kaynak (orijinal) hâli. Panelden değiştirilen değerler
# derleme sırasında bütün HTML sayfalarında bunların yerine yazılır.
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
    yeni.update({k: (v or '').strip() for k, v in json.load(open('content/iletisim.json', encoding='utf-8')).items() if (v or '').strip()})
    if yeni == ESKI:
        return []
    (og, op, od), (ng, np_, nd) = tel(ESKI['telefon']), tel(yeni['telefon'])
    c = [(og, ng), (op, np_), (od, nd), (ESKI['eposta'], yeni['eposta']), (ESKI['adres'], yeni['adres']),
         (', %s / ' % ESKI['ilce'], ', %s / ' % yeni['ilce']),
         ('"addressLocality":"%s"' % ESKI['ilce'], '"addressLocality":"%s"' % yeni['ilce'])]
    return [(a, b) for a, b in c if a != b]


def main():
    cift = iletisim_ciftleri()
    for kok, _, dosyalar in os.walk('site'):
        if kok.startswith(os.path.join('site', 'admin')):
            continue
        for f in dosyalar:
            if not f.endswith('.html'):
                continue
            yol = os.path.join(kok, f)
            s = open(yol, encoding='utf-8').read()
            s2 = s
            if yol == os.path.join('site', 'index.html'):
                s2 = re.sub(r'<!--PROJELER-->.*?<!--/PROJELER-->',
                            lambda m: '<!--PROJELER-->' + projeler_html() + '<!--/PROJELER-->', s2, flags=re.S)
            for a, b in cift:
                s2 = s2.replace(a, b)
            if s2 != s:
                open(yol, 'w', encoding='utf-8').write(s2)
    print('Derleme tamam.')


if __name__ == '__main__':
    main()
