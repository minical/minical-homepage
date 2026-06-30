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

Confirmed Pages settings:

| Setting            | Value                                   |
| ------------------ | --------------------------------------- |
| Project name       | `minical-homepage`                      |
| Production branch  | `master`                                |
| Source             | **Direct Upload** (no Git integration)  |
| Build step         | none (static)                           |

> Because the project is **direct upload**, merging to GitHub `master` does
> **not** auto-deploy. Every deploy is a manual `wrangler pages deploy`.

### ⚠️ Never deploy the raw working directory

`wrangler pages deploy <dir>` uploads **every** file in `<dir>` as a public
asset. Deploying the repo root directly would publish `.env` (your API token!)
to `https://www.minical.io/.env`. **Always deploy from a clean export of
tracked files only.**

```bash
# load CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
set -a; source .env; set +a

# 1. export ONLY tracked files (no .env, no .git, no stray files) to a temp dir
rm -rf /tmp/minical-pub && mkdir -p /tmp/minical-pub
git archive --format=tar master | tar -x -C /tmp/minical-pub

# 2. deploy that clean dir to PRODUCTION (www.minical.io)
npx wrangler pages deploy /tmp/minical-pub \
  --project-name=minical-homepage \
  --branch=master
```

Notes:

- **`--branch=master`** matches the production branch, so this updates
  `www.minical.io`. Use **any other branch name** (e.g. `--branch=preview`) to
  get a throwaway **preview** deployment on a `*.pages.dev` URL to test before
  going live — same clean-export step applies.
- Swap `master` in the `git archive` line for any ref/branch you want to ship.
- Roll back instantly from the dashboard: **Workers & Pages → minical-homepage →
  Deployments → (older deployment) → Rollback**.
