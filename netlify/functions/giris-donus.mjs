// GitHub girişinden dönüş: kodu anahtara çevirir, yalnızca site sahibine izin verir, uygulamaya geri yollar.
const SAHIP = (process.env.YONETIM_SAHIBI || 'karanerdogan34').toLowerCase();

function geri(mesaj) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/yonetim/#hata=' + encodeURIComponent(mesaj),
      'Set-Cookie': 'yonetim_state=; Path=/.netlify/functions/; Max-Age=0',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  const cerez = (req.headers.get('cookie') || '').match(/(?:^|;\s*)yonetim_state=([a-f0-9]+)/);
  if (!code || !state || !cerez || cerez[1] !== state) return geri('Giriş doğrulanamadı, lütfen tekrar deneyin.');

  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) return geri('GitHub girişi tamamlanamadı.');

  const kim = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + j.access_token, 'User-Agent': 'yonetim' },
  }).then((x) => x.json()).catch(() => ({}));
  if ((kim.login || '').toLowerCase() !== SAHIP) return geri('Bu hesap bu siteyi yönetemez.');

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/yonetim/#anahtar=' + encodeURIComponent(j.access_token),
      'Set-Cookie': 'yonetim_state=; Path=/.netlify/functions/; Max-Age=0',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
};

