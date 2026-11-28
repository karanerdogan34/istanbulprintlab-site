"""Yabancı dil ana sayfalarına: ülkelere göre kargo bölümü (tüm diller) ve
İstanbul'u ziyaret edenler için ürün bölümü (EN, RU).
Fiyat veya süre sözü verilmez; kargo ücreti siparişe göre en uygun firmadan sorulup bildirilir."""
import os

# Her dil: (başlık, giriş, [(ülke, metin)...], alt not)
KARGO = {
'en': ('Shipping to your country',
 'We print in our workshop in Kadıköy, Istanbul and send your order abroad in sturdy packaging. Product prices for abroad are shown without Turkish VAT. Shipping is not included: after your order we compare carriers and tell you the cheapest price for your address. Import duties and taxes in your country are paid by the recipient.',
 [('Germany and the EU', 'Türkiye is outside the EU, so EU import VAT and any customs duty are charged when the parcel arrives.'),
  ('United Kingdom', 'UK import VAT and any customs duty may be charged on delivery.'),
  ('UAE and the Gulf', 'Sent by express courier. Local customs duty and VAT may apply on arrival.'),
  ('Russia', 'Not every international courier delivers to Russia at the moment. We check which carriers serve your city and offer you the working options and prices.'),
  ('USA and Canada', 'Sent by express courier. Local customs rules apply; duties may be charged on delivery.'),
  ('Other countries', 'Write to us with your city and postcode; we find a carrier and tell you the price before you pay for shipping.')],
 'Rigid boards (foam board, PVC board) and photo blocks are not sent abroad. In Istanbul you can also pick up your order at our workshop in Kadıköy.'),
'ru': ('Доставка в вашу страну',
 'Мы печатаем в нашей мастерской в Кадыкёе (Стамбул) и отправляем заказ за границу в надёжной упаковке. Цены для заграницы указаны без турецкого НДС. Доставка не входит: после заказа мы сравниваем перевозчиков и сообщаем самую выгодную цену до вашего адреса. Таможенные пошлины и налоги вашей страны оплачивает получатель.',
 [('Германия и ЕС', 'Турция не входит в ЕС, поэтому импортный НДС ЕС и возможные пошлины взимаются при получении посылки.'),
  ('Великобритания', 'При получении могут взиматься импортный НДС и пошлины Великобритании.'),
  ('ОАЭ и страны Залива', 'Отправляем экспресс-курьером. При получении могут взиматься местные пошлины и НДС.'),
  ('Россия', 'Сейчас не все международные курьеры доставляют в Россию. Мы проверяем, какие перевозчики работают с вашим городом, и предлагаем рабочие варианты и цены.'),
  ('США и Канада', 'Отправляем экспресс-курьером. Действуют местные таможенные правила; при получении могут взиматься пошлины.'),
  ('Другие страны', 'Напишите нам город и индекс — найдём перевозчика и сообщим цену до оплаты доставки.')],
 'Жёсткие панели (пенокартон, ПВХ) и фотоблоки за границу не отправляем. В Стамбуле заказ можно забрать в нашей мастерской в Кадыкёе.'),
'de': ('Versand in Ihr Land',
 'Wir drucken in unserer Werkstatt in Kadıköy, Istanbul, und versenden Ihre Bestellung sicher verpackt ins Ausland. Preise für das Ausland verstehen sich ohne türkische MwSt. Der Versand ist nicht enthalten: Nach Ihrer Bestellung vergleichen wir Versanddienste und nennen Ihnen den günstigsten Preis für Ihre Adresse. Einfuhrabgaben und Steuern in Ihrem Land zahlt der Empfänger.',
 [('Deutschland und EU', 'Die Türkei gehört nicht zur EU, daher fallen bei Ankunft Einfuhrumsatzsteuer und ggf. Zoll an.'),
  ('Vereinigtes Königreich', 'Bei Zustellung können britische Einfuhrumsatzsteuer und Zoll anfallen.'),
  ('VAE und Golfstaaten', 'Versand per Expresskurier. Bei Ankunft können lokale Zölle und MwSt. anfallen.'),
  ('Russland', 'Derzeit liefern nicht alle internationalen Kuriere nach Russland. Wir prüfen, welche Dienste Ihre Stadt erreichen, und nennen Ihnen Optionen und Preise.'),
  ('USA und Kanada', 'Versand per Expresskurier. Es gelten die lokalen Zollregeln; bei Zustellung können Abgaben anfallen.'),
  ('Andere Länder', 'Schreiben Sie uns Stadt und Postleitzahl; wir finden einen Versanddienst und nennen den Preis, bevor Sie den Versand bezahlen.')],
 'Feste Platten (Schaumplatte, PVC) und Fotoblöcke versenden wir nicht ins Ausland. In Istanbul können Sie Ihre Bestellung auch in unserer Werkstatt in Kadıköy abholen.'),
'fr': ('Livraison dans votre pays',
 'Nous imprimons dans notre atelier à Kadıköy, Istanbul, et expédions votre commande à l’étranger dans un emballage solide. Les prix pour l’étranger sont affichés hors TVA turque. La livraison n’est pas incluse : après votre commande, nous comparons les transporteurs et vous indiquons le prix le plus bas pour votre adresse. Les droits et taxes d’importation de votre pays sont à la charge du destinataire.',
 [('Allemagne et UE', 'La Turquie ne fait pas partie de l’UE : la TVA à l’importation et d’éventuels droits de douane sont perçus à l’arrivée.'),
  ('Royaume-Uni', 'La TVA britannique à l’importation et d’éventuels droits peuvent être perçus à la livraison.'),
  ('Émirats et Golfe', 'Envoi par coursier express. Des droits de douane et une TVA locale peuvent s’appliquer à l’arrivée.'),
  ('Russie', 'Tous les transporteurs internationaux ne livrent pas la Russie actuellement. Nous vérifions lesquels desservent votre ville et vous proposons les options et prix disponibles.'),
  ('États-Unis et Canada', 'Envoi par coursier express. Les règles douanières locales s’appliquent ; des droits peuvent être perçus à la livraison.'),
  ('Autres pays', 'Indiquez-nous votre ville et votre code postal ; nous trouvons un transporteur et vous donnons le prix avant le paiement de la livraison.')],
 'Les panneaux rigides (carton mousse, PVC) et les photoblocs ne sont pas expédiés à l’étranger. À Istanbul, vous pouvez aussi retirer votre commande dans notre atelier à Kadıköy.'),
'es': ('Envío a su país',
 'Imprimimos en nuestro taller de Kadıköy, Estambul, y enviamos su pedido al extranjero en un embalaje resistente. Los precios para el extranjero se muestran sin IVA turco. El envío no está incluido: tras su pedido comparamos transportistas y le indicamos el precio más barato para su dirección. Los aranceles e impuestos de importación de su país los paga el destinatario.',
 [('Alemania y la UE', 'Turquía no forma parte de la UE, así que el IVA de importación y los posibles aranceles se cobran a la llegada.'),
  ('Reino Unido', 'Pueden cobrarse el IVA de importación británico y aranceles en la entrega.'),
  ('EAU y el Golfo', 'Envío por mensajería urgente. A la llegada pueden aplicarse aranceles e IVA locales.'),
  ('Rusia', 'Actualmente no todos los mensajeros internacionales entregan en Rusia. Comprobamos qué transportistas llegan a su ciudad y le ofrecemos las opciones y precios disponibles.'),
  ('EE. UU. y Canadá', 'Envío por mensajería urgente. Se aplican las normas aduaneras locales; pueden cobrarse aranceles en la entrega.'),
  ('Otros países', 'Escríbanos su ciudad y código postal; buscamos transportista y le damos el precio antes de pagar el envío.')],
 'Los paneles rígidos (cartón pluma, PVC) y los fotobloques no se envían al extranjero. En Estambul también puede recoger su pedido en nuestro taller de Kadıköy.'),
'it': ('Spedizione nel vostro paese',
 'Stampiamo nel nostro laboratorio a Kadıköy, Istanbul, e spediamo l’ordine all’estero in un imballo robusto. I prezzi per l’estero sono indicati senza IVA turca. La spedizione non è inclusa: dopo l’ordine confrontiamo i corrieri e vi comunichiamo il prezzo più basso per il vostro indirizzo. Dazi e tasse di importazione del vostro paese sono a carico del destinatario.',
 [('Germania e UE', 'La Turchia non fa parte dell’UE: IVA all’importazione ed eventuali dazi vengono riscossi all’arrivo.'),
  ('Regno Unito', 'Alla consegna possono essere riscossi IVA britannica all’importazione e dazi.'),
  ('Emirati e Golfo', 'Spedizione con corriere espresso. All’arrivo possono applicarsi dazi e IVA locali.'),
  ('Russia', 'Al momento non tutti i corrieri internazionali consegnano in Russia. Verifichiamo quali servono la vostra città e vi proponiamo le opzioni e i prezzi disponibili.'),
  ('USA e Canada', 'Spedizione con corriere espresso. Valgono le regole doganali locali; alla consegna possono essere riscossi dazi.'),
  ('Altri paesi', 'Scriveteci città e CAP; troviamo un corriere e vi diamo il prezzo prima del pagamento della spedizione.')],
 'Pannelli rigidi (forex, PVC) e fotoblocchi non vengono spediti all’estero. A Istanbul potete anche ritirare l’ordine nel nostro laboratorio a Kadıköy.'),
'ar': ('الشحن إلى بلدك',
 'نطبع في ورشتنا في قاضي كوي بإسطنبول ونرسل طلبك إلى الخارج في تغليف متين. أسعار الطلبات إلى الخارج معروضة بدون ضريبة القيمة المضافة التركية. الشحن غير مشمول: بعد طلبك نقارن شركات الشحن ونخبرك بأرخص سعر لعنوانك. الرسوم الجمركية والضرائب في بلدك يدفعها المستلم.',
 [('ألمانيا والاتحاد الأوروبي', 'تركيا ليست ضمن الاتحاد الأوروبي، لذا تُحصَّل ضريبة الاستيراد وأي رسوم جمركية عند وصول الطرد.'),
  ('المملكة المتحدة', 'قد تُحصَّل ضريبة الاستيراد البريطانية والرسوم الجمركية عند التسليم.'),
  ('الإمارات ودول الخليج', 'نرسل عبر البريد السريع. قد تُطبَّق رسوم جمركية وضريبة قيمة مضافة محلية عند الوصول.'),
  ('روسيا', 'ليست كل شركات البريد السريع الدولية توصل إلى روسيا حاليًا. نتحقق من الشركات التي تخدم مدينتك ونعرض عليك الخيارات المتاحة وأسعارها.'),
  ('الولايات المتحدة وكندا', 'نرسل عبر البريد السريع. تُطبَّق القواعد الجمركية المحلية، وقد تُحصَّل رسوم عند التسليم.'),
  ('دول أخرى', 'اكتب لنا مدينتك والرمز البريدي؛ نجد شركة شحن ونخبرك بالسعر قبل دفع الشحن.')],
 'الألواح الصلبة (الفوم بورد، PVC) والفوتوبلوك لا تُشحن إلى الخارج. في إسطنبول يمكنك أيضًا استلام طلبك من ورشتنا في قاضي كوي.'),
'fa': ('ارسال به کشور شما',
 'ما در کارگاه خود در کادیکوی استانبول چاپ می‌کنیم و سفارش شما را با بسته‌بندی محکم به خارج می‌فرستیم. قیمت‌های خارج از ترکیه بدون مالیات بر ارزش افزوده ترکیه نمایش داده می‌شوند. هزینه ارسال در قیمت نیست: پس از سفارش، شرکت‌های حمل را مقایسه می‌کنیم و ارزان‌ترین قیمت برای نشانی شما را اعلام می‌کنیم. عوارض گمرکی و مالیات کشور شما با گیرنده است.',
 [('آلمان و اتحادیه اروپا', 'ترکیه عضو اتحادیه اروپا نیست، بنابراین مالیات واردات و عوارض گمرکی احتمالی هنگام رسیدن بسته دریافت می‌شود.'),
  ('بریتانیا', 'ممکن است مالیات واردات و عوارض گمرکی بریتانیا هنگام تحویل دریافت شود.'),
  ('امارات و کشورهای خلیج', 'با پست سریع ارسال می‌شود. ممکن است هنگام رسیدن عوارض گمرکی و مالیات محلی اعمال شود.'),
  ('روسیه', 'در حال حاضر همه شرکت‌های پست سریع بین‌المللی به روسیه ارسال نمی‌کنند. بررسی می‌کنیم کدام شرکت‌ها به شهر شما خدمات می‌دهند و گزینه‌ها و قیمت‌ها را اعلام می‌کنیم.'),
  ('آمریکا و کانادا', 'با پست سریع ارسال می‌شود. مقررات گمرکی محلی اعمال می‌شود و ممکن است هنگام تحویل عوارض دریافت شود.'),
  ('کشورهای دیگر', 'شهر و کد پستی خود را برای ما بنویسید؛ شرکت حمل را پیدا می‌کنیم و پیش از پرداخت هزینه ارسال قیمت را اعلام می‌کنیم.')],
 'صفحه‌های سخت (فوم‌برد، PVC) و فوتوبلوک به خارج ارسال نمی‌شوند. در استانبول می‌توانید سفارش را از کارگاه ما در کادیکوی هم تحویل بگیرید.'),
'ur': ('آپ کے ملک تک ترسیل',
 'ہم استنبول کے علاقے قادی کوئے میں اپنی ورکشاپ میں پرنٹ کرتے ہیں اور آپ کا آرڈر مضبوط پیکنگ میں بیرونِ ملک بھیجتے ہیں۔ بیرونِ ملک کی قیمتیں ترک ٹیکس (KDV) کے بغیر دکھائی جاتی ہیں۔ ترسیل شامل نہیں: آرڈر کے بعد ہم کوریئر کمپنیوں کا موازنہ کر کے آپ کے پتے کی سب سے سستی قیمت بتاتے ہیں۔ آپ کے ملک کی کسٹم ڈیوٹی اور ٹیکس وصول کنندہ ادا کرتا ہے۔',
 [('جرمنی اور یورپی یونین', 'ترکی یورپی یونین میں شامل نہیں، اس لیے پارسل پہنچنے پر درآمدی ٹیکس اور ممکنہ کسٹم ڈیوٹی لی جاتی ہے۔'),
  ('برطانیہ', 'ترسیل پر برطانوی درآمدی ٹیکس اور کسٹم ڈیوٹی لی جا سکتی ہے۔'),
  ('متحدہ عرب امارات اور خلیج', 'ایکسپریس کوریئر سے بھیجا جاتا ہے۔ پہنچنے پر مقامی کسٹم ڈیوٹی اور ٹیکس لاگو ہو سکتا ہے۔'),
  ('روس', 'اس وقت ہر بین الاقوامی کوریئر روس تک ترسیل نہیں کرتا۔ ہم دیکھتے ہیں کون سی کمپنیاں آپ کے شہر تک جاتی ہیں اور دستیاب اختیارات اور قیمتیں بتاتے ہیں۔'),
  ('امریکہ اور کینیڈا', 'ایکسپریس کوریئر سے بھیجا جاتا ہے۔ مقامی کسٹم قوانین لاگو ہوتے ہیں؛ ترسیل پر ڈیوٹی لی جا سکتی ہے۔'),
  ('دوسرے ممالک', 'اپنا شہر اور پوسٹ کوڈ لکھ بھیجیں؛ ہم کوریئر ڈھونڈ کر ترسیل کی ادائیگی سے پہلے قیمت بتا دیں گے۔')],
 'سخت بورڈ (فوم بورڈ، PVC) اور فوٹو بلاک بیرونِ ملک نہیں بھیجے جاتے۔ استنبول میں آپ اپنا آرڈر قادی کوئے میں ہماری ورکشاپ سے بھی لے سکتے ہیں۔'),
}

# İstanbul'u ziyaret edenler: (başlık, giriş, [(ürün, açıklama, panel)...])
TURIST = {
'en': ('Visiting Istanbul?',
 'Print it while you are here and pick it up at our workshop in Kadıköy, or we ship it home for you.',
 [('Event posters', 'Posters for concerts, exhibitions, launches and parties.', 'afis-baski'),
  ('Personalised stickers', 'Your own design or logo as stickers, in any shape and quantity.', 'sticker-etiket-baski'),
  ('Photo prints', 'Your holiday photos printed as posters to frame at home.', 'poster-baski'),
  ('Invitations', 'Wedding, birthday and event invitations with your own text.', 'davetiye-baski')]),
'ru': ('Вы в Стамбуле?',
 'Закажите печать, пока вы здесь, и заберите в нашей мастерской в Кадыкёе — или мы отправим заказ к вам домой.',
 [('Афиши мероприятий', 'Афиши для концертов, выставок, презентаций и вечеринок.', 'afis-baski'),
  ('Именные наклейки', 'Ваш дизайн или логотип в виде наклеек любой формы и количества.', 'sticker-etiket-baski'),
  ('Печать фотографий', 'Фото из поездки в виде постеров, чтобы повесить дома в рамке.', 'poster-baski'),
  ('Приглашения', 'Приглашения на свадьбу, день рождения и мероприятия с вашим текстом.', 'davetiye-baski')]),
}

FIYAT = {'en': 'Get a price', 'ru': 'Узнать цену'}

CSS = ('<style>.uk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-top:24px}'
       '.uk-k{border:1px solid var(--line);border-radius:12px;padding:18px}.uk-k h3{font-size:17px;margin:0 0 6px}'
       '.uk-k p{font-size:15px;margin:0}.uk-k a{display:inline-block;margin-top:10px}</style>')


def _esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def bolum(dil):
    h, giris, ul, alt = KARGO[dil]
    kart = ''.join('<div class="uk-k"><h3>%s</h3><p class="muted">%s</p></div>' % (_esc(a), _esc(b)) for a, b in ul)
    s = ('<section id="kargo-ulkeler" class="wrap sec" style="padding-bottom:64px"><h2 class="h2">%s</h2>'
         '<p class="muted" style="max-width:820px;margin-top:12px">%s</p><div class="uk-grid">%s</div>'
         '<p class="note" style="margin-top:18px">%s</p></section>') % (_esc(h), _esc(giris), kart, _esc(alt))
    if dil in TURIST:
        th, tg, ur = TURIST[dil]
        kart = ''.join('<div class="uk-k"><h3>%s</h3><p class="muted">%s</p><a class="btn sm" href="/%s/siparis/%s/">%s</a></div>'
                       % (_esc(a), _esc(b), dil, k, FIYAT[dil]) for a, b, k in ur)
        s = ('<section id="istanbul-ziyaret" class="wrap sec" style="padding-bottom:64px"><h2 class="h2">%s</h2>'
             '<p class="muted" style="max-width:820px;margin-top:12px">%s</p><div class="uk-grid">%s</div></section>') % (_esc(th), _esc(tg), kart) + s
    return s


def ekle(dist):
    n = 0
    for dil in KARGO:
        p = os.path.join(dist, dil, 'index.html')
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        if 'id="kargo-ulkeler"' in s:
            continue
        hedef = '<section id="projeler"'
        if hedef not in s:
            hedef = '<section class="wrap" id="sss"'
        s = s.replace(hedef, bolum(dil) + hedef, 1)
        s = s.replace('href="/teslimat-ve-kargo/"', 'href="#kargo-ulkeler"')
        s = s.replace('</head>', CSS + '</head>', 1)
        open(p, 'w', encoding='utf-8').write(s)
        n += 1
    return n
