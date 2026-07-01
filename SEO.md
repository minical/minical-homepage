# SEO

This site is a static marketing site served at `https://www.minical.io` (see `CNAME`).
This doc records the SEO setup and the manual steps that must be done in external tools.

## What's implemented in the repo

**Per-page metadata** (`index.html`, `features.html`, `partners.html`, `faq.html`)
- Keyword-focused `<title>` and unique `<meta name="description">`
- `<link rel="canonical">` (absolute, `https://www.minical.io/…`)
- `<meta name="robots" content="index, follow">` and `<meta name="theme-color">`
- Open Graph + Twitter Card tags (title, description, url, image 1200×630, image alt)
- `apple-touch-icon`

**Structured data (JSON-LD)**
- Homepage: `Organization`, `WebSite`, `SoftwareApplication`
- `faq.html`: `FAQPage` — answer text is kept **verbatim** identical to the visible copy
  (a Google requirement). If you edit a visible FAQ answer, update the JSON-LD block too.

**Crawl / discovery**
- `robots.txt` — allows all, points at the sitemap
- `sitemap.xml` — lists all four pages; update it when you add/remove a page

**Social share image**
- `assets/img/og-image.png` (1200×630). Regeneration instructions below.

**Performance**
- Calendly is lazy-loaded on first CTA click (`window.openCalendly`) instead of on every
  page load — its `widget.js`/`widget.css` only download when a user actually books.

**Content**
- `faq.html` targets question-style searches, grounded in existing site claims.
- Extension count is consistent at **70+** across all pages (was mismatched 50+/70+).

## Manual steps (do these in external tools — cannot be done from the repo)

### 1. Google Search Console (recommended after each deploy of new pages)
1. Go to https://search.google.com/search-console and select the `minical.io` property
   (or add it and verify via the existing DNS / GA4 tag `G-5JMCT393M0`).
2. **Sitemaps** → submit `https://www.minical.io/sitemap.xml`.
3. **URL Inspection** → paste each page URL → **Request indexing** (fastest for new pages
   like `faq.html`).
4. Validate structured data with https://search.google.com/test/rich-results
   (check `/` for Organization/SoftwareApplication and `/faq.html` for FAQPage).
5. Preview social cards with the LinkedIn Post Inspector and X Card Validator; if a card
   looks stale, use their "scrape again" option to bust the cache.

### 2. Bing Webmaster Tools (optional)
Submit the same sitemap at https://www.bing.com/webmasters (can import from GSC).

## Regenerating the OG image

`assets/img/og-image.png` was produced from an SVG with `rsvg-convert`. To change it:

```bash
# edit the SVG source, then:
rsvg-convert -w 1200 -h 630 og-image.svg -o assets/img/og-image.png
```

Keep it 1200×630 (the dimensions declared in the `og:image:width/height` tags).

## Backlog — needs product/marketing input (not yet done)

These are the higher-effort SEO levers that need real, vetted copy rather than
auto-generated content (thin/fabricated pages hurt rankings):

- **Keyword landing pages / blog** targeting high-intent terms surfaced by the product,
  e.g. "white-label hotel PMS", "hotel channel manager", "PMS for hotel chains",
  "vacation rental PMS". Each should be a genuine, substantial page and get linked from
  the nav/footer + added to `sitemap.xml`.
- **A purpose-built OG image** designed in the brand font (Space Grotesk). The current one
  uses FreeSans because Space Grotesk isn't available in the build environment.
- **Fix the "Live demo" link** — `demo.minical.io` did not resolve during this work; verify
  the subdomain is live (the footer links to `https://demo.minical.io`).
