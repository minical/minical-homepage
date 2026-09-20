# Analytics & user tracking

All tracking on this site is one file: [`assets/js/analytics.js`](assets/js/analytics.js).
Every page loads it from `<head>`:

```html
<link rel="preconnect" href="https://www.googletagmanager.com">
<script src="assets/js/analytics.js"></script>
```

It replaces the inline GA4 snippet that used to be copy-pasted into each page.
It loads **synchronously** on purpose: the visitor and session ids have to exist
before GA4 fires its first `page_view`, otherwise the most important pageview of
each visit is the one with no user attached to it.

## What it does

| | |
| --- | --- |
| **Visitor id** | A UUID in `localStorage` **and** an `mc_vid` cookie on `.minical.io`, so the same person is one visitor across pages, tabs, and the hop to `web.minical.io` / `demo.minical.io`. Either store rehydrates the other. |
| **Session** | 30-minute rolling window, kept in `localStorage` (not `sessionStorage`) so a second tab is the same visit. Sessions are numbered per visitor. |
| **Attribution** | First touch (`utm_*`, `gclid`, `fbclid`, referrer, landing page) is stored once and never overwritten. Last touch advances only on a real new campaign or external referrer, so internal navigation cannot rewrite it. |
| **Identity** | `mc_uid` cookie / `?mc_uid=` URL param / `mcAnalytics.identify()` set the GA4 `user_id`. |
| **GA4** | Boots `G-5JMCT393M0` and attaches the fields above as event parameters **and** user properties on every event. |

Because the ids are config parameters, every GA4 event — including the automatic
`page_view` — carries `visitor_id`, `mc_session_id`, `session_number`,
`visitor_type`, `first_touch_source/medium/campaign`, `last_touch_source/medium`
and `page_group`.

### Cross-domain stitching

`mc_vid` is set on `.minical.io`, so `web.minical.io` and `demo.minical.io` can
read it as-is and join a signup back to the marketing visit that produced it.
Nothing needs to be appended to links. When the app knows who someone is, it can
set `mc_uid` on the same domain (or link back with `?mc_uid=<id>`) and this site
will report that person under the same GA4 `user_id` on their next visit.

## Events

Sent automatically:

| Event | Fires on | Key params |
| --- | --- | --- |
| `page_view` | every page (GA4 automatic, enriched) | all base params |
| `cta_click` | any link/button click | `cta_label`, `cta_location`, `link_type`, `link_url`, `link_domain` |
| `app_handoff` | clicks through to `web.`/`demo.minical.io` | `destination`, `cta_label` |
| `calendly_open` | the Calendly popup is opened | `cta_label`, `calendly_url` |
| `calendly_profile_page_viewed`, `calendly_date_and_time_selected`, `calendly_event_scheduled` | Calendly's own funnel, via `postMessage` | `cta_label` |
| `generate_lead` | a call is actually booked — **mark this as the key event/conversion in GA4** | `lead_source`, `cta_label` |
| `ext_tab_select` | extension tabs on `features.html` | `tab_name` |
| `faq_toggle` | an FAQ item opens/closes | `faq_question`, `faq_state` |
| `scroll_depth` | 25 / 50 / 75 / 90 % | `percent_scrolled` |
| `section_view` | a `<section id>` becomes 40 % visible | `section_id` |
| `page_engagement` | page hidden or unloaded | `engaged_seconds`, `time_on_page_seconds`, `max_scroll_percent` |

`link_type` is one of `internal`, `outbound`, `app`, `email`, `phone`, `anchor`,
`calendly`, `button`, `tab`.

### Naming a CTA

`cta_label` defaults to the link's text, which changes whenever marketing copy
changes and breaks the report. Key CTAs therefore carry an explicit, stable
label:

```html
<a data-mc-cta="hero_book_call" href="" onclick="openCalendly(); return false;">Become a partner</a>
```

Add `data-mc-cta` to any new CTA worth reporting on. `data-mc-section` overrides
the auto-detected location, and `data-mc-ignore` suppresses tracking for an
element.

## Using it from page code

```js
mcAnalytics.track('demo_requested', { property_count: 12 });
mcAnalytics.identify('acct_991', { plan: 'partner' });
mcAnalytics.context();   // { visitorId, sessionId, sessionNumber, userId, firstTouch, … }
```

`window.mc` is an alias for `window.mcAnalytics` when nothing else claims it.

## Sending the same events somewhere else (e.g. a RunHQ SDK)

There is **no RunHQ tracking SDK wired up** — none exists in this repo, none is
on the live site, and `runhq.com` publishes no SDK or docs today. Rather than
guess at an endpoint, the tracking layer is built so a second destination is a
few lines whenever that SDK (or Segment, PostHog, a warehouse pixel, …) is ready.

Register an adapter — it receives every event, including ones that already fired
before it was registered:

```html
<script src="https://cdn.runhq.example/sdk.js"></script>
<script>
  mcAnalytics.use({
    name: 'runhq',
    init: function (ctx) { RunHQ.init({ key: 'pk_live_…', anonymousId: ctx.visitorId }); },
    track: function (name, params) { RunHQ.track(name, params); },
    identify: function (userId, traits) { RunHQ.identify(userId, traits); }
  });
</script>
```

To register before `analytics.js` loads, push onto `window.MC_ANALYTICS_ADAPTERS`
(an array before boot, a drain queue afterwards — both work):

```js
window.MC_ANALYTICS_ADAPTERS = [myAdapter];
```

An adapter that throws is caught and skipped; it cannot take GA4 down with it.

## Privacy

- First-party cookies only (`mc_vid`, `mc_uid`), `SameSite=Lax`, `Secure` on HTTPS.
- No PII is collected. `user_id` is whatever opaque id the app supplies.
- `mcAnalytics.optOut()` or `?mc_optout=1` stops everything — GA4 is never even
  loaded. `mcAnalytics.optIn()` / `?mc_optout=0` reverses it,
  `mcAnalytics.reset()` clears the stored ids.
- `CONFIG.respectGpc` in `analytics.js` is `false`. Flip it to `true` to opt out
  browsers that send Global Privacy Control.

## Verifying a change

1. Load any page with `?mc_debug=1` and watch the console: `[mc] booted {…}`
   followed by an `[mc] event …` line per event.
2. GA4 → **Admin → DebugView**, or the Network tab filtered to
   `google-analytics.com/g/collect` — check `en=` (event name) and the
   `ep.visitor_id` / `ep.mc_session_id` parameters.
3. `mcAnalytics.context()` in the console shows the current visitor, session and
   attribution.

## GA4 setup still to do in the console

The site now sends these fields, but GA4 only reports on what it has been told
about:

- Register **custom dimensions** (Admin → Custom definitions) for the event
  params `visitor_id`, `mc_session_id`, `session_number`, `visitor_type`,
  `cta_label`, `cta_location`, `link_type`, `page_group`, and the user
  properties `visitor_id`, `visitor_type`, `first_touch_source`,
  `first_touch_medium`, `first_touch_campaign`.
- Mark **`generate_lead` as a key event** so booked calls count as conversions.
- Turn on **User-ID reporting** so identified visitors merge across devices.
