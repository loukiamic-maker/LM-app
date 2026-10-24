# Eneres custom website address

The public brand is **Eneres**. `eneres.com` is a candidate address, not a registered or configured domain for this project. Its availability could not be established: the authoritative `.com` registry RDAP lookup was blocked by this environment's network proxy on 24 October 2026. No domain was purchased, no DNS records were changed, and no custom-domain claim was added to the website.

An owned `eneres.gr` or `eneres.cy` could also be used. Their availability and registration eligibility have not been checked. Keep the existing GitHub Pages address until the owner chooses and controls the final domain.

## Choose and verify the domain

1. Check the desired address with a domain registrar. Purchase or use a domain controlled by the website owner; domain registration is separate from GitHub Pages hosting.
2. In the GitHub account's **Settings → Pages**, use **Add a domain** to verify ownership. GitHub supplies a TXT record containing the actual verification name and value. Add exactly those values at the DNS provider, then complete verification in GitHub.
3. Keep the verification TXT record after verification. Preserve unrelated MX, TXT and other records, including email settings.
4. Only after ownership is established, set the repository's **Settings → Pages → Custom domain** to the chosen address. For example, use `eneres.com` if the owner has acquired it and wants the apex address as the primary website.

The examples below assume the owner has chosen and controls `eneres.com`. Substitute the actual owned domain throughout if a different address is selected.

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

For the current **Deploy from a branch** method, the published `gh-pages` branch root must retain a `CNAME` file containing only the chosen owned hostname, such as `eneres.com`, followed by a newline. Configure the repository's Custom domain setting first and preserve its generated file during subsequent uploads. After ownership and the hostname are confirmed, a matching `public/CNAME` can make Vite include that file in future builds. Do not add a speculative domain to either location now.

If migrating to a custom GitHub Actions Pages workflow later, use the Pages settings for the custom domain; GitHub's documentation says that workflow-based publishing does not require a `CNAME` file and ignores an existing one.

## HTTPS and final checks

1. Wait for GitHub's Pages DNS check to pass and its HTTPS certificate to become available.
2. Enable **Enforce HTTPS** in the repository's Pages settings when available.
3. Open both `https://eneres.com/` and `https://www.eneres.com/`; confirm the secondary hostname redirects to the chosen primary hostname and the certificate is valid.
4. Check page reloads, service photos, city filtering, account links and the booking flow on the final hostname. A successful DNS lookup alone does not verify the website.
5. Test new-account confirmation, password recovery and sign-in redirects after updating the backend settings below.

## Supabase authentication URLs

When a real Supabase project is connected, update **Authentication → URL Configuration** to match the final primary address:

- **Site URL:** `https://eneres.com/` if that is the chosen primary hostname.
- **Redirect URLs:** permit the exact root callback `https://eneres.com/` used by this app. Add `https://www.eneres.com/` only if it remains a supported callback origin. Keep a staging or local redirect only while that environment is intentionally in use.
- Retest email confirmation and password recovery from the production website. The app derives its authentication callback from the current origin and Vite base, which is another reason to build the custom-domain release with `--base=/`.

Changing the domain does not require a service-role key in the browser. Public Supabase project settings remain public configuration; privileged database and email credentials stay in the backend.

The custom URL is complete only after domain ownership, DNS, Pages configuration, the root build, HTTPS and production authentication redirects have all been verified. These instructions prepare that work; they do not claim the address is registered or live.
