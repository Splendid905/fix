# FixerCtrl website

This repository contains the FixerCtrl public website, built as a static HTML page with its images in `assets/`. It also contains a Client Desk frontend and Supabase backend foundation for private project tracking, scheduled invoice emails, and hosted payments.
The site uses X's blue accent and includes a pointer-reactive blue halftone ripple for mouse and touch input; it is disabled when reduced motion is preferred.

## Publish with GitHub Pages

1. In the repository settings, open **Pages** and set the build and deployment source to **GitHub Actions**.
2. Push changes to the `main` branch, or run **Deploy site to GitHub Pages** from the Actions tab.
3. After the workflow succeeds, visit the Pages URL shown in the deployment environment. For this repository, the default URL is `https://splendid905.github.io/fix/`.

The workflow publishes `fixerctrl-site.html` as the site homepage (`index.html`) and includes the files in `assets/` plus the Client Desk frontend files. The public marketing site remains static. The Client Desk requires a configured Supabase project and deployed Edge Functions before customers can sign in or submit private requests; payment and invoice email functions also require external providers and secrets.

See [CLIENT-DESK-PLAN.md](CLIENT-DESK-PLAN.md) for the feature intent and current prices, and [supabase/SETUP.md](supabase/SETUP.md) for backend, email, scheduled invoice, payment provider, and production security setup. Do not enable live customer payments until the production readiness checks in that guide pass.
