/* A gate in front of the static site.
 *
 * Everything the site has ever served is still here, in web/public, and
 * nothing has been deleted. This decides which of it answers a request.
 * While OPEN is the Opsomming entrance, the other reports return 404 and
 * the root sends a visitor there instead.
 *
 * To put the whole site back: set OPEN to null (or delete `main` from
 * wrangler.toml, which takes this worker out of the path entirely).
 *
 * Note what this is and is not. It hides pages; it does not authenticate
 * anyone. The data files stay readable, because the Opsomming pages read
 * them -- map.json in particular is congregation-level. Cloudflare Access
 * in front of the project is what actually restricts who may look.
 */

// The section that is open. null means the whole site is open.
const OPEN = "opsomming";

// What the open section needs from the root: the shared code, the styles,
// the vendored libraries, the data, and the icon.
const SHARED = [
  /^\/(common|ring|kaart|kerkprofiel|predikante|predikanteprofiel)\.js$/,
  /^\/styles\.css$/,
  /^\/favicon\.svg$/,
  /^\/vendor\//,
  /^\/data\//,
];

export default {
  async fetch(request, env) {
    if (!OPEN) return env.ASSETS.fetch(request);

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "") {
      return Response.redirect(`${url.origin}/${OPEN}/`, 302);
    }
    if (path === `/${OPEN}` ) {
      return Response.redirect(`${url.origin}/${OPEN}/`, 302);
    }
    if (path.startsWith(`/${OPEN}/`) || SHARED.some((rule) => rule.test(path))) {
      return env.ASSETS.fetch(request);
    }
    return new Response(notHere(url.origin), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8",
                 "cache-control": "no-store" },
    });
  },
};

const notHere = (origin) => `<!doctype html>
<html lang="af"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nie beskikbaar nie · Kerkspieël</title>
<style>
  body { margin: 0; display: grid; place-items: center; min-height: 100vh;
         background: #f4f4f2; color: #0b0b0b;
         font: 15px/1.6 "Inter", -apple-system, system-ui, sans-serif; }
  main { max-width: 42ch; padding: 32px; text-align: center; }
  h1 { font-size: 19px; margin: 0 0 10px; }
  p { color: #52514e; margin: 0 0 18px; }
  a { color: #2a78d6; }
</style></head>
<body><main>
  <h1>Hierdie bladsy is tans toe</h1>
  <p>Net die opsomming van die Gemeente-opname 2026 is op die oomblik
     beskikbaar.</p>
  <p><a href="${origin}/${OPEN}/">Gaan na die opsomming</a></p>
</main></body></html>`;
