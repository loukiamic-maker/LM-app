# Eneres custom website address

The owner has selected **eneresbeauty.com** as the future website address. The
visible brand and floral logo remain **Eneres**. The active website is still
https://loukiamic-maker.github.io/LM-app/.

The [authoritative Verisign registry lookup](https://rdap.verisign.com/com/v1/domain/eneresbeauty.com)
returned HTTP 404 (no registration record found) on 24 October 2026. This is not a
reservation or a guarantee of registrar availability or pricing. The domain has
not been purchased or connected by this project. Do not claim it in GitHub Pages,
publish a `CNAME`, or switch Supabase's primary address until ownership is
confirmed.

`eneres.com` is already registered to another party. Trademark clearance has not
been established; EUIPO's search page returned HTTP 403 and a reachable TMview
landing page alone does not establish trademark status.

## Choose and verify the domain

1. Register `eneresbeauty.com` in the website owner's own registrar account after checking the final price and availability. Domain registration is separate from GitHub Pages hosting; it has not been purchased from this chat.
2. In the GitHub account's **Settings → Pages**, use **Add a domain** to verify ownership. GitHub supplies a TXT record containing the actual verification name and value. Add exactly those values at the DNS provider, then complete verification in GitHub.
3. Keep the verification TXT record after verification. Preserve unrelated MX, TXT and other records, including email settings.
4. Only after ownership is established, set the repository's **Settings → Pages → Custom domain** to the chosen address. Use `eneresbeauty.com` as the primary address after the owner has registered it.

The selected address is `eneresbeauty.com`; the instructions below take effect only after ownership is established. Keep the existing `/LM-app/` deployment and Supabase callback working until the domain migration is ready.

## DNS for GitHub Pages

For an apex primary address, add these four separate records:

| Type | Name | Target |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `loukiamic-maker.github.io` |

The `www` target is a hostname only: **`loukiamic-maker.github.io`**, without `https://`, `/LM-app/`, or any other path. Point `www` directly to GitHub's hostname rather than to the apex address. Remove only conflicting records for the same website hostnames; keep other services' records.

If the DNS provider supports an apex ALIAS/ANAME record, GitHub also documents that alternative. Use the provider's supported method consistently rather than adding an ordinary apex CNAME that conflicts with other records. IPv6 AAAA records are optional; use the current values in GitHub's documentation if enabling IPv6.

These A records and the CNAME target format were checked against the [official GitHub Pages custom-domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) and its [GitHub-maintained source](https://github.com/github/docs/blob/main/content/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site.md) on 24 October 2026. Recheck that documentation before a later DNS migration.

## Build for the custom domain root

The existing project-address deployment uses `/LM-app/` as its Vite build base. A primary custom domain serves this website at `/`, so produce a new root build:

```sh
cd /workspace/LM-app
npm ci
npm run build -- --base=/
```

Publish the contents of `dist/` using the existing Pages deployment process. Do not continue deploying a `/LM-app/` build at the custom domain root: scripts, styles, photos and authentication redirects would otherwise point at the wrong path.

For the current **Deploy from a branch** method, the published `gh-pages` branch root must retain a `CNAME` file containing only the chosen owned hostname, such as `eneresbeauty.com`, followed by a newline. Configure the repository's Custom domain setting first and preserve its generated file during subsequent uploads. After ownership and the hostname are confirmed, a matching `public/CNAME` can make Vite include that file in future builds. Do not add a speculative domain to either location now.

If migrating to a custom GitHub Actions Pages workflow later, use the Pages settings for the custom domain; GitHub's documentation says that workflow-based publishing does not require a `CNAME` file and ignores an existing one.

## HTTPS and final checks

1. Wait for GitHub's Pages DNS check to pass and its HTTPS certificate to become available.
2. Enable **Enforce HTTPS** in the repository's Pages settings when available.
3. Open both `https://eneresbeauty.com/` and `https://www.eneresbeauty.com/`; confirm the secondary hostname redirects to the chosen primary hostname and the certificate is valid.
4. Check page reloads, service photos, city filtering, account links and the booking flow on the final hostname. A successful DNS lookup alone does not verify the website.
5. Test new-account confirmation, password recovery and sign-in redirects after updating the backend settings below.

## Supabase authentication URLs

When a real Supabase project is connected, update **Authentication → URL Configuration** to match the final primary address:

- **Site URL:** `https://eneresbeauty.com/` if that is the chosen primary hostname.
- **Redirect URLs:** permit the exact root callback `https://eneresbeauty.com/` used by this app. Add `https://www.eneresbeauty.com/` only if it remains a supported callback origin. Keep a staging or local redirect only while that environment is intentionally in use.
- Retest email confirmation and password recovery from the production website. The app derives its authentication callback from the current origin and Vite base, which is another reason to build the custom-domain release with `--base=/`.

Changing the domain does not require a service-role key in the browser. Public Supabase project settings remain public configuration; privileged database and email credentials stay in the backend.

The custom URL is complete only after domain ownership, DNS, Pages configuration, the root build, HTTPS and production authentication redirects have all been verified. These instructions prepare that work; they do not claim the address is registered or live.
