"""ceviri_tr/kaynak/<dil>.txt (numara<TAB>çeviri) + anahtar.json (Türkçe metinler) -> ceviri_tr/<dil>.json
Anahtarın başındaki/sonundaki boşluklar çeviriye aynen eklenir. Mevcut sözlükteki diğer kayıtlar korunur."""
import json, os, re, sys
K = os.path.dirname(os.path.abspath(__file__))
anahtar = json.load(open(os.path.join(K, 'anahtar.json'), encoding='utf-8'))
for dil in sys.argv[1:]:
    hedef = os.path.join(K, '..', '%s.json' % dil)
    C = json.load(open(hedef, encoding='utf-8')) if os.path.exists(hedef) else {}
    n = 0
    for satir in open(os.path.join(K, '%s.txt' % dil), encoding='utf-8'):
        satir = satir.rstrip('\n')
        if not satir.strip():
            continue
        no, _, t = satir.partition('\t')
        k = anahtar[int(no)]
        m = re.match(r'^(\s*).*?(\s*)$', k, re.S)
        C[k] = m.group(1) + t.strip() + m.group(2)
        n += 1
    json.dump(C, open(hedef, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(dil, n, 'çeviri,', len(C), 'kayıt')
