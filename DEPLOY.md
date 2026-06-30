# Deploying minical-homepage

This is a **static** site (plain HTML/CSS/JS — no build step). It is served by
**Cloudflare Pages**.

## Hosting overview

| Hostname              | Served by                      | Notes                                          |
| --------------------- | ------------------------------ | ---------------------------------------------- |
| `www.minical.io`      | **Cloudflare Pages**           | Production. This repo is the source.           |
| `minical.io` (apex)   | Framer                         | 308-redirects to `www.minical.io`.             |
| `minical.github.io`   | GitHub Pages (legacy)          | Still enabled; 301-redirects to `www`. The `CNAME` file is a leftover from the old GitHub Pages setup — Cloudflare Pages ignores it. |

> The Cloudflare Pages project lives in the **minical** Cloudflare account
> (not the same account as other RunHQ sites such as roomsy). Deploys require an
> API token scoped to **that** account.

## Prerequisites

1. **Node / npx** (Wrangler is run via `npx`, nothing to install globally).
2. A `.env` file in the repo root (gitignored — never commit it) containing
   credentials for the minical Cloudflare account:

   ```dotenv
   CLOUDFLARE_API_TOKEN=<token scoped to the minical account>
   CLOUDFLARE_ACCOUNT_ID=<minical account id>
   ```

### Creating the API token

Cloudflare dashboard → **My Profile → API Tokens**
(<https://dash.cloudflare.com/profile/api-tokens>) → **Create Token → Custom Token**:

- **Permissions:** `Account` · `Cloudflare Pages` · `Edit`
- **Account Resources:** Include → *the minical account* (not "All accounts")
- Zone resources: not required for Pages deploys.

Find the **Account ID** in the dashboard URL
(`https://dash.cloudflare.com/<account-id>/...`) or under
**Workers & Pages → Account ID**.

## Deploy

From the repo root:

```bash
# load CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
set -a; source .env; set +a

# confirm the exact Pages project name first
npx wrangler pages project list

# deploy the whole repo (static root) to production
npx wrangler pages deploy . \
  --project-name=<minical-pages-project> \
  --branch=main
```

Notes:

- **`.`** is the publish directory — the site is served straight from the repo
  root (`index.html`, `partners.html`, `assets/`, …). Wrangler skips `.git`.
- **`--branch`** must match the project's **production branch** to publish to
  `www.minical.io`. Any other branch name creates a **preview** deployment on a
  `*.pages.dev` URL instead (handy for testing before going live).
- The project name is shown by `wrangler pages project list`; fill it into the
  command above (and consider pinning it here once confirmed).

## Auto-deploy on push (if Git integration is enabled)

If the Pages project is connected to the GitHub repo
(`minical/minical-homepage`) via Cloudflare's Git integration, then **merging to
the production branch (`master`) auto-deploys** — no manual `wrangler` command
needed. Use the manual `wrangler pages deploy` above for out-of-band or
local-content deploys.
