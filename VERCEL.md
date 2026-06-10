# Deploy on Vercel

Static landing page lives in **`docs/`**. No build step.

## One-time setup (GitHub import)

1. Open [vercel.com/new](https://vercel.com/new)
2. Import **`poulsbopete/digital-chief-of-staff-releases`**
3. Framework preset: **Other** (Vercel reads `vercel.json`)
4. Deploy

Default URL: **https://digital-chief-of-staff-releases.vercel.app/**

`vercel.json` sets `outputDirectory: "docs"` so the site root serves `docs/index.html`.

## CLI deploy

```bash
cd releases-public   # or clone the public repo
npx vercel link      # once
npx vercel --prod
```

## Custom domain (optional)

Vercel project → **Settings → Domains** → add e.g. `dcos.elastic.co` or keep the `.vercel.app` subdomain.

## GitHub Pages

GitHub Pages (gh-pages branch) can stay enabled in parallel. Prefer the Vercel URL for field sharing if DNS/SSL is simpler.

When the private repo tags a release, CI syncs `releases-public/` to this repo; Vercel auto-redeploys on push to `main`.
