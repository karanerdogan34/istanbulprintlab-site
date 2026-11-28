"""Sipariş panellerine kısa bilgi kutusu: malzeme, ölçü sınırı, kargoya veriliş, fiyat (KDV hariç), asgari sipariş.
TR sipariş sayfalarına derlemede eklenir; cok_dil bunları diğer dillere çevirir. Asgari tutar panelin tl0() işleviyle
yazılır, böylece yurt dışı modunda %20 farkla gösterilir."""
import glob, json, os, html

ETIKET = ['Kısa bilgi', 'Malzeme', 'Ölçü', 'Kargoya veriliş', 'Fiyatlar', 'Asgari sipariş']


def _satirlar(k, u, G):
    t = u['tur']
    malz = [m['ad'] for m in u.get('malzemeler', [])]
    olcu = None
    kargo = 'Onaydan sonra 1–2 iş gününde kargoda'
    if t == 'rulo':
        boy = u.get('max_boy')
        if u.get('kesim'):
            olcu = 'Sticker başına en az %d cm, sipariş başına en fazla %d adet' % (u['kesim']['min_cm'], u['kesim']['max_adet'])
        elif boy:
            olcu = 'Tek parça en fazla %d × %d cm' % (u['net_en'], boy)
        else:
            olcu = 'Tek parça en fazla %d cm × %d m' % (u['net_en'], G['tek_parca_max_boy'] // 100)
        if k in ('foreks-baski', 'fotoblok-baski'):
            malz = ['PVC foreks levha, 3–10 mm' if k == 'foreks-baski' else 'Fotoblok levha, 3–10 mm']
            kargo = 'Kargoyla gönderilmez; İstanbul içi teslimat ya da Kadıköy atölyeden teslim alma'
    elif t == 'yazi':
        malz = ['Renkli kesim folyosu']
        olcu = 'Harf yüksekliği en az 5 cm, toplam en en fazla %d cm' % u['max_en']
    elif t == 'dtf':
        if 'tabaka' in u:
            malz = ['DTF transfer filmi']
            olcu = 'Tasarım en az %d cm, en fazla %d × %d cm' % (u['min_cm'], u['tabaka']['en'], u['tabaka']['boy'])
        else:
            malz = ['UV DTF filmi']
            olcu = 'Tasarım en az %d cm, bir kenarı en fazla %d cm' % (u['min_cm'], u['rulo_en'])
    elif t == 'duvar':
        olcu = 'Duvar kenarları en fazla %d metre' % (G['tek_parca_max_boy'] // 100)
    elif t == 'kartvizit':
        malz = ['350 gr mat kuşe kağıt']
        olcu = '85 × 55 mm'
    elif t == 'davetiye':
        malz = ['350 gr mat kuşe, selefonlu']
        olcu = '13 × 18 cm'
        kargo = 'Onaydan sonra %d iş gününde kargoda' % u.get('uretim_is_gunu', 3)
    return malz, olcu, kargo


def anahtarlar():
    """Çeviri için gereken TR metinleri."""
    F = json.load(open('siparis/src/fiyatlar.json'))
    G = F['genel']; S = list(ETIKET) + ['KDV hariç']
    for k, u in F['urunler'].items():
        m, o, kg = _satirlar(k, u, G)
        for x in m + [o, kg]:
            if x and x not in S:
                S.append(x)
    return S


def ekle(dist):
    F = json.load(open('siparis/src/fiyatlar.json'))
    G = F['genel']; n = 0
    for k, u in F['urunler'].items():
        p = os.path.join(dist, 'siparis', k, 'index.html')
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        if 'id="bilgiKutu"' in s:
            continue
        malz, olcu, kargo = _satirlar(k, u, G)
        E = html.escape
        sat = []
        if malz:
            sat.append((ETIKET[1], ''.join('<span>%s</span>' % E(m) + (', ' if i < len(malz) - 1 else '') for i, m in enumerate(malz))))
        if olcu:
            sat.append((ETIKET[2], '<span>%s</span>' % E(olcu)))
        sat.append((ETIKET[3], '<span>%s</span>' % E(kargo)))
        sat.append((ETIKET[4], '<span>KDV hariç</span>'))
        if t_ := (u['tur'] != 'davetiye'):
            sat.append((ETIKET[5], '<span data-asgari></span>'))
        kutu = ('<dl class="bk" id="bilgiKutu" aria-label="%s">' % E(ETIKET[0])
                + ''.join('<div><dt>%s</dt><dd>%s</dd></div>' % (E(a), b) for a, b in sat) + '</dl>'
                + '<script>(function(){function y(){var e=document.querySelector("[data-asgari]");if(e&&window.IPL_TL0)e.textContent=window.IPL_TL0(%s);}window.addEventListener("load",y);document.addEventListener("change",function(){setTimeout(y,0);});})();</script>' % G['asgari_baski'])
        css = ('<style>.bk{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 16px;margin:14px 0 4px;'
               'padding:12px 14px;border:1px solid var(--line,#e4e4e0);border-radius:10px;font-size:14px}.bk div{margin:0}'
               '.bk dt{font-size:12px;opacity:.65;margin:0}.bk dd{margin:2px 0 0}</style>')
        a = '<div class="chips" id="chips"></div>'
        if a not in s:
            continue
        s = s.replace(a, a + kutu, 1).replace('</head>', css + '</head>', 1)
        open(p, 'w', encoding='utf-8').write(s)
        n += 1
    return n
