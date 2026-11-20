# -*- coding: utf-8 -*-
"""Çerez onay bandı + Google Consent Mode v2 + PostHog'un yalnızca onayla çalışması.

Derleme sırasında her sayfaya eklenir (yönetim sayfaları hariç):
  - BAŞ: <head> içinde Google etiketinden ÖNCE çalışır. Varsayılan: bütün izinler kapalı.
    Daha önce verilmiş ve süresi dolmamış bir seçim varsa onu hemen uygular.
  - PostHog: yalnızca "Analiz" izni verildiyse başlatılır; izin yoksa hiçbir veri göndermez.
  - BANT: </body> öncesinde; sağ alt köşede kutu (mobilde alttaki sabit butonların üstünde).
Seçim yalnızca tarayıcıda (localStorage) 6 ay saklanır; her alan adının kendi seçimi vardır.
"""
import json

SURE_GUN = 182  # 6 ay

METIN = {
    'tr': dict(t='Çerez tercihleri', b='Siteyi geliştirmek ve reklamlarımızın etkisini ölçmek için, onay verirseniz analiz ve reklam çerezleri kullanırız. Seçiminizi istediğiniz zaman değiştirebilirsiniz.',
               p='Çerez Politikası', no='Reddet', yes='Kabul et', pref='Tercihler', save='Seçimi kaydet',
               nec='Zorunlu (her zaman açık)', an='Analiz: site kullanımı ve oturum kaydı', ad='Reklam: Google Ads ölçümü', foot='Çerez tercihleri'),
    'en': dict(t='Cookie preferences', b='With your consent, we use analytics and advertising cookies to improve this site and measure our ads. You can change your choice at any time.',
               p='Cookie Policy', no='Reject', yes='Accept', pref='Preferences', save='Save choices',
               nec='Necessary (always on)', an='Analytics: site usage and session replay', ad='Advertising: Google Ads measurement', foot='Cookie preferences'),
    'de': dict(t='Cookie-Einstellungen', b='Mit Ihrer Einwilligung verwenden wir Analyse- und Werbe-Cookies, um die Website zu verbessern und unsere Anzeigen zu messen. Sie können Ihre Wahl jederzeit ändern.',
               p='Datenschutz', no='Ablehnen', yes='Akzeptieren', pref='Einstellungen', save='Auswahl speichern',
               nec='Notwendig (immer aktiv)', an='Analyse: Nutzung der Website und Sitzungsaufzeichnung', ad='Werbung: Google-Ads-Messung', foot='Cookie-Einstellungen'),
    'fr': dict(t='Préférences cookies', b='Avec votre accord, nous utilisons des cookies d’analyse et de publicité pour améliorer le site et mesurer nos annonces. Vous pouvez modifier votre choix à tout moment.',
               p='Confidentialité', no='Refuser', yes='Accepter', pref='Préférences', save='Enregistrer',
               nec='Nécessaires (toujours actifs)', an='Analyse : utilisation du site et enregistrement de session', ad='Publicité : mesure Google Ads', foot='Préférences cookies'),
    'it': dict(t='Preferenze cookie', b='Con il tuo consenso utilizziamo cookie di analisi e pubblicitari per migliorare il sito e misurare i nostri annunci. Puoi modificare la scelta in qualsiasi momento.',
               p='Privacy', no='Rifiuta', yes='Accetta', pref='Preferenze', save='Salva scelte',
               nec='Necessari (sempre attivi)', an='Analisi: utilizzo del sito e registrazione della sessione', ad='Pubblicità: misurazione Google Ads', foot='Preferenze cookie'),
    'es': dict(t='Preferencias de cookies', b='Con su consentimiento, usamos cookies analíticas y publicitarias para mejorar el sitio y medir nuestros anuncios. Puede cambiar su elección en cualquier momento.',
               p='Privacidad', no='Rechazar', yes='Aceptar', pref='Preferencias', save='Guardar selección',
               nec='Necesarias (siempre activas)', an='Analítica: uso del sitio y grabación de sesión', ad='Publicidad: medición de Google Ads', foot='Preferencias de cookies'),
    'nl': dict(t='Cookievoorkeuren', b='Met uw toestemming gebruiken we analytische en advertentiecookies om de website te verbeteren en onze advertenties te meten. U kunt uw keuze altijd wijzigen.',
               p='Privacy', no='Weigeren', yes='Accepteren', pref='Voorkeuren', save='Keuze opslaan',
               nec='Noodzakelijk (altijd aan)', an='Analyse: websitegebruik en sessie-opname', ad='Advertenties: Google Ads-meting', foot='Cookievoorkeuren'),
}

# <head> başında, Google etiketinden önce
BAS = '''<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
(function(){var K='%(anahtar)s',S=%(sure)d*864e5,c=null;try{c=JSON.parse(localStorage.getItem(K)||'null')}catch(e){}
if(!c||!c.t||Date.now()-c.t>S||c.v!==1)c=null;window.__cmp=c;
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});
gtag('set','ads_data_redaction',true);
if(c){var a=c.a?'granted':'denied',r=c.r?'granted':'denied';gtag('consent','update',{analytics_storage:a,ad_storage:r,ad_user_data:r,ad_personalization:r});}})();
</script>
'''

# PostHog yükleyicisi ve olay köprüsü — yalnızca analiz izniyle başlatılır
POSTHOG = '''<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify alias people.set people.set_once set_config reset opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_distinct_id get_property getFeatureFlag isFeatureEnabled onFeatureFlags startSessionRecording stopSessionRecording".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
window.__phBasla=function(){if(window.__phOK)return;window.__phOK=1;posthog.init('%(posthog)s',{api_host:'https://eu.i.posthog.com',defaults:'2025-05-24',person_profiles:'identified_only',session_recording:{maskAllInputs:true}});};
if(window.__cmp&&window.__cmp.a)__phBasla();
function __phOlay(n,p){if(window.__phOK)try{posthog.capture(n,p)}catch(x){}}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';var t=/^tel:/.test(h)?'phone_click':/wa\\.me|whatsapp/i.test(h)?'whatsapp_click':/^mailto:/.test(h)?'email_click':null;if(t)__phOlay(t,{metin:(a.textContent||'').trim().slice(0,60),sayfa:location.pathname});},true);
(function(){var g=window.gtag;if(typeof g!=='function')return;var atla={phone_click:1,whatsapp_click:1,email_click:1,page_view:1};window.gtag=function(){try{if(arguments[0]==='event'&&!atla[arguments[1]])__phOlay(arguments[1],Object.assign({sayfa:location.pathname},arguments[2]||{}));}catch(x){}return g.apply(this,arguments);};})();
</script>
'''

# </body> öncesi — bant
BANT = '''<style>
#cmpx{position:fixed;right:20px;bottom:20px;z-index:65;width:360px;max-width:calc(100vw - 24px);box-sizing:border-box;background:%(zemin)s;color:%(yazi)s;border:1px solid %(cizgi)s;border-radius:12px;padding:16px 16px 14px;box-shadow:0 18px 44px -14px rgba(0,0,0,.45);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-align:left}
#cmpx[hidden]{display:none}
#cmpx h2{margin:0 0 6px;font-size:15px;font-weight:700;color:inherit;letter-spacing:0;text-transform:none;font-family:inherit;line-height:1.3}
#cmpx p{margin:0 0 12px;color:inherit;opacity:.88;font-size:13.5px}
#cmpx a{color:inherit;text-decoration:underline}
#cmpx .cmpx-b{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#cmpx button{appearance:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px;line-height:1.1;border-radius:8px;padding:11px 10px;min-height:42px;border:1px solid %(vurgu)s;background:%(vurgu)s;color:%(vurgu_yazi)s}
#cmpx .cmpx-l{grid-column:1/-1;background:transparent;border:0;color:inherit;text-decoration:underline;min-height:0;padding:6px 0 0;font-weight:500;font-size:13px}
#cmpx .cmpx-p{display:none;margin:0 0 12px;padding:10px 0 0;border-top:1px solid %(cizgi)s}
#cmpx.acik .cmpx-p{display:block}
#cmpx label{display:flex;gap:10px;align-items:flex-start;margin:6px 0;font-size:13.5px;cursor:pointer}
#cmpx input{width:18px;height:18px;margin:1px 0 0;flex:none;accent-color:%(vurgu)s}
#cmpx .cmpx-s{display:none}#cmpx.acik .cmpx-s{display:block;grid-column:1/-1}
#cmpx button:focus-visible{outline:2px solid %(vurgu)s;outline-offset:2px}
.cmpx-ac{background:none;border:0;padding:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}
@media (max-width:640px){#cmpx{left:12px;right:12px;width:auto;max-width:none;max-height:42vh;overflow:auto;padding:14px 14px 12px}#cmpx p{font-size:13px}}
</style>
<div id="cmpx" role="dialog" aria-live="polite" aria-labelledby="cmpx-t" hidden></div>
<script>
(function(){var K='%(anahtar)s',M=%(metin)s,P=%(politika)s,L=(document.documentElement.lang||'tr').slice(0,2),T=M[L]||M.%(yedek)s,u=P[L]||P.%(yedek)s;
var b=document.getElementById('cmpx');if(!b)return;
function e(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
b.innerHTML='<h2 id="cmpx-t">'+e(T.t)+'</h2><p>'+e(T.b)+' <a href="'+u+'">'+e(T.p)+'</a></p>'+
 '<div class="cmpx-p"><label><input type="checkbox" checked disabled> '+e(T.nec)+'</label><label><input type="checkbox" id="cmpx-a"> '+e(T.an)+'</label><label><input type="checkbox" id="cmpx-r"> '+e(T.ad)+'</label></div>'+
 '<div class="cmpx-b"><button type="button" data-k="no">'+e(T.no)+'</button><button type="button" data-k="yes">'+e(T.yes)+'</button><button type="button" class="cmpx-s" data-k="save">'+e(T.save)+'</button><button type="button" class="cmpx-l" data-k="pref" aria-expanded="false">'+e(T.pref)+'</button></div>';
function alt(){var m=0;if(window.innerWidth>640)return 20;document.querySelectorAll('body *').forEach(function(x){if(x===b||b.contains(x))return;var s=getComputedStyle(x);if(s.position!=='fixed'||s.display==='none'||s.visibility==='hidden')return;var r=x.getBoundingClientRect();if(r.height>0&&r.height<160&&r.bottom>=window.innerHeight-2&&r.width>window.innerWidth*.5)m=Math.max(m,r.height)});return m+10}
function yerlestir(){b.style.bottom=alt()+'px'}
function ac(){var c=window.__cmp;document.getElementById('cmpx-a').checked=!!(c&&c.a);document.getElementById('cmpx-r').checked=!!(c&&c.r);b.hidden=false;yerlestir();setTimeout(yerlestir,1500)}
function temizle(){try{for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i);if(/^ph_/.test(k))localStorage.removeItem(k)}}catch(x){}document.cookie.split(';').forEach(function(c){var n=c.split('=')[0].trim();if(/^ph_/.test(n)){var h=location.hostname.replace(/^www\\./,'');['',';domain=.'+h,';domain='+location.hostname].forEach(function(d){document.cookie=n+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'+d})}})}
function kaydet(a,r){var o=window.__cmp,c={v:1,a:!!a,r:!!r,t:Date.now()};try{localStorage.setItem(K,JSON.stringify(c))}catch(x){}window.__cmp=c;
 var A=a?'granted':'denied',R=r?'granted':'denied';gtag('consent','update',{analytics_storage:A,ad_storage:R,ad_user_data:R,ad_personalization:R});
 if(a&&window.__phBasla)__phBasla();
 if(!a&&o&&o.a){try{posthog.stopSessionRecording();posthog.opt_out_capturing()}catch(x){}temizle();location.reload();return}
 b.hidden=true;b.classList.remove('acik')}
b.addEventListener('click',function(ev){var k=ev.target&&ev.target.getAttribute&&ev.target.getAttribute('data-k');if(!k)return;
 if(k==='yes')kaydet(1,1);else if(k==='no')kaydet(0,0);else if(k==='save')kaydet(document.getElementById('cmpx-a').checked,document.getElementById('cmpx-r').checked);
 else if(k==='pref'){var o=b.classList.toggle('acik');ev.target.setAttribute('aria-expanded',o?'true':'false')}});
document.addEventListener('click',function(ev){if(ev.target.closest&&ev.target.closest('[data-cmp-ac]')){ev.preventDefault();b.classList.add('acik');ac()}});
var f=document.querySelectorAll('footer');f=f[f.length-1];if(f&&!f.querySelector('[data-cmp-ac]')){var d=document.createElement('div');d.style.cssText='margin-top:10px;font-size:13px;opacity:.8';d.innerHTML='<button type="button" class="cmpx-ac" data-cmp-ac>'+e(T.foot)+'</button>';f.appendChild(d)}
window.addEventListener('resize',function(){if(!b.hidden)yerlestir()});
if(!window.__cmp){if(document.readyState==='complete')ac();else window.addEventListener('load',ac)}
})();
</script>
'''


def uygula(s, ayar):
    """ayar: anahtar, posthog, politika{lang:url}, yedek dil, renkler. Google etiketinden önce BAS eklenir."""
    if 'id="cmpx"' in s or '</head>' not in s or '</body>' not in s:
        return s
    bas = BAS % {'anahtar': ayar['anahtar'], 'sure': SURE_GUN}
    # Google etiketinden önce gelmeli: ilk <script> etiketinin önüne, yoksa </head> önüne
    i = s.find('<script', s.find('<head'))
    j = s.find('</head>')
    if 0 <= i < j:
        s = s[:i] + bas + s[i:]
    else:
        s = s.replace('</head>', bas + '</head>', 1)
    s = s.replace('</head>', POSTHOG % {'posthog': ayar['posthog']} + '</head>', 1)
    metin = {k: METIN[k] for k in ayar['diller']}
    bant = BANT % dict(ayar['renk'], anahtar=ayar['anahtar'], yedek=ayar['yedek'],
                       metin=json.dumps(metin, ensure_ascii=False), politika=json.dumps(ayar['politika']))
    k = s.rfind('</body>')
    return s[:k] + bant + s[k:]
