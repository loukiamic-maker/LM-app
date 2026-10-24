# meraki

A Greek-language beauty and wellness booking website for **Greece and Cyprus**, inspired by the supplied mobile references. Includes a responsive customer marketplace and a separate business calendar.

## Run

Requires Node.js 20.19+ or 22.12+ (tested with Node.js 24).

```sh
cd /workspace/LM-app
npm ci
npm run dev
```

Vite serves the app on port 5173. For a production build, run `npm run build`; the static website is written to `dist/`. `npm run preview` serves that build for local validation. Deploy `dist/` to a static hosting service to obtain a public URL.

### GitHub Pages

For this repository's GitHub Pages path, build with `npm run build -- --base=/LM-app/`. The generated CSS, fonts, photos and HTML use that base. A Pages-ready static release is uploaded separately to the `gh-pages` branch; source code is on `codex/meraki-website`.

The repository owner must enable Pages in **Settings → Pages**, select **Deploy from a branch**, then **gh-pages / (root)** and save. Once GitHub finishes its deployment, the expected address is `https://loukiamic-maker.github.io/LM-app/`. This address is not proof that hosting has been activated. The local coding environment could upload through Git but could not access GitHub's Pages API or verify a public deployment because the network proxy blocked those destinations.

The site uses hash navigation, so customer and business screens also work on static hosting without server rewrite rules. It remains a demo after publication.

## Included

- Greek interface, service categories, city and country filtering, and sorting.
- Eight example businesses across Athens, Thessaloniki, Patras, Nicosia, Limassol, and Larnaca.
- Favorites and a local profile, retained on the current browser.
- Booking flow: service → professional, date and time → contact details and payment choice → confirmation.
- Local appointment history and cancellation, with overlapping bookings blocked for the same professional.
- Business demo: date navigation, day calendar, totals, manual appointment creation and cancellation. The example calendar belongs to Atelier Hair Studio and includes customer bookings for that salon.
- Greece/Cyprus local booking dates and euro prices.
- Self-hosted Greek/Latin fonts and generated photography inspired by the reference screenshots.

## Demo boundaries

This is an interactive frontend prototype. All businesses, reviews, prices and availability are illustrative. Bookings, profiles, favorites and manual business appointments stay in browser local storage; they do not synchronize across users or devices or contact a business. The profile includes an action to delete locally stored customer information. Business demo state is stored separately.

Pay-at-venue is the only enabled demo payment method. Card and Apple Pay are visibly unavailable. No payment credentials are collected, and nothing is charged. Business login and signup explain that authentication is not connected, and do not store passwords.

A public production launch still needs a backend with authenticated customer/business accounts, a real business directory and availability, server-side booking conflicts and notifications, a connected payment provider if accepting online payments, and production privacy/terms. No secrets are required for the local demo.

## Browser tests

```sh
npm test
```

Tests use system Chromium at `/usr/bin/chromium` (override using `CHROMIUM_PATH` if available in the test configuration) and start/reuse the development server. They exercise filtering, favorites persistence, booking and cancellation, disabled online payments, business calendar interactions and mobile layout. See `playwright.config.js` for runner configuration.

## Main files

- `src/App.jsx`: marketplace, navigation, profile, local customer storage.
- `src/Booking.jsx`: booking and confirmation flow.
- `src/Business.jsx`: business entry and calendar.
- `src/data.js`: replaceable demo listing and service content.
- `src/styles.css`, `src/booking.css`, `src/business.css`: responsive design.
- `public/images/beauty-grid.png`: 4×3 photo sheet used by service tiles and business cards. Each tile is an equal 362px square.

Use the existing checkout for subsequent tasks; this cloud workspace is already isolated.
