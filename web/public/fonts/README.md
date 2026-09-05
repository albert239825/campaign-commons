# Landing-page font sources

These are the WOFF2 subsets referenced by Bayshore's public stylesheet, retrieved September 5, 2026 for the landing-page design experiment.

| Local file | Family / weight | Source |
| --- | --- | --- |
| `scto-grotesk-a-regular.woff2` | Scto Grotesk A / 400 | [Bayshore CDN](https://cdn.prod.website-files.com/6a11a5d11aa4840419a12c89/6a1405df322b9384edbeb053_subset-SctoGroteskA-Regular.woff2) |
| `scto-grotesk-a-medium.woff2` | Scto Grotesk A / 500 | [Bayshore CDN](https://cdn.prod.website-files.com/6a11a5d11aa4840419a12c89/6a1405df02114f7adcf2ed71_subset-SctoGroteskA-Medium.woff2) |
| `cinzel-regular.woff2` | Cinzel / 400 | [Bayshore CDN](https://cdn.prod.website-files.com/6a11a5d11aa4840419a12c89/6a1405df5934d9755f056a24_subset-Cinzel-Regular.woff2) |

The landing page uses Scto Grotesk A for headings, body copy, and controls, and Cinzel for small section labels. Other routes retain the existing system font stack. Font definitions live in `web/src/app/globals.css` and use `font-display: swap`.
