# FixerCtrl website

This repository contains the FixerCtrl public website, built as a static HTML page with its images in `assets/`.
The site uses X's blue accent and includes a pointer-reactive blue halftone ripple for mouse and touch input; it is disabled when reduced motion is preferred.

## Publish with GitHub Pages

1. In the repository settings, open **Pages** and set the build and deployment source to **GitHub Actions**.
2. Push changes to the `main` branch, or run **Deploy site to GitHub Pages** from the Actions tab.
3. After the workflow succeeds, visit the Pages URL shown in the deployment environment. For this repository, the default URL is `https://splendid905.github.io/fix/`.

The workflow publishes `fixerctrl-site.html` as the site homepage (`index.html`) and includes the files in `assets/`. No application server or database is required.
