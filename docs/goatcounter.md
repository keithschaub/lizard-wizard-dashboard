# Visitor counter (GoatCounter)

The site counts page views with [GoatCounter](https://www.goatcounter.com/), a privacy-friendly counter. It sets no cookies, stores no personal data, and needs no consent banner. `index.html` loads it asynchronously:

```html
<script data-goatcounter="https://lizard-wizard.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
```

There is no other tracker (no Google Analytics). The `noindex` robots meta tags are unchanged, so search engines still skip the site.

## One-time setup (Keith)

1. Sign up for free at <https://www.goatcounter.com/> and create a site with the code **`lizard-wizard`**. Your dashboard is then at <https://lizard-wizard.goatcounter.com/>.
2. In the site settings, add **`keithschaub.github.io`** as an allowed domain so that counts from the GitHub Pages site are accepted.
3. Open <https://keithschaub.github.io/lizard-wizard-dashboard/> on your phone, then check the dashboard. A visit to `/lizard-wizard-dashboard/` should appear within a minute.

Until the GoatCounter site exists, the script loads but nothing is recorded, and the game is unaffected. GoatCounter ignores `localhost`, so local development and the Playwright tests are never counted. The tests also answer `count.js` locally, so they never depend on gc.zgo.at.
