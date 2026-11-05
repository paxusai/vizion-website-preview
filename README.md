# Vizion Insurance Company, Ltd. - website (preview)

The company website for Vizion Insurance Company, Ltd., a non-life insurance company in
Saipan, Commonwealth of the Northern Mariana Islands. It is a static site: plain HTML, CSS
and JavaScript, with no server or database.

The homepage opens with an interactive 3D scene (WebGL). Browsers that can't show it, and
visitors who prefer reduced motion, see a still image instead.

## View it

- On a computer: open `index.html` in Chrome, Edge, Safari or Firefox.
- As a free web link with GitHub Pages: in this repository go to **Settings > Pages**, set
  **Source** to *Deploy from a branch*, choose branch **main** and folder **/ (root)**, then
  **Save**. After a minute or two the site appears at
  `https://<your-username>.github.io/<repository-name>/`.
  GitHub Pages is free for public repositories.

This preview is set to stay out of search engines (`noindex` and `robots.txt`). It is not
the official vizioninsurance.net website.

## What's here

| Path | Contents |
|---|---|
| `index.html` and the other `.html` files | The pages of the finished website |
| `assets/` | Styles, scripts (including the 3D hero) and web-ready images |
| `.nojekyll` | Tells GitHub Pages to publish the files exactly as they are. Keep it. |
| `_headers` | Security headers for hosts such as Netlify (GitHub Pages ignores it) |
| `source/` | The editable project: page sources, shared layout, build and preview scripts |

## Editing the site

1. Edit the files in `source/src` (`pages/` for page content, `layout.html` for the header
   and footer, `assets/` for styles, scripts and images).
2. In PowerShell, from the `source` folder, run `.\tools\package.ps1 -GitHub`. It rebuilds
   everything into `source\share\Vizion-Website-for-GitHub.zip`.
3. Replace the repository files with the contents of that zip.

To preview while editing, run `.\build.ps1`, then `node tools\serve.js` (or
`.\tools\serve.ps1`), and open http://localhost:8080.

The original, full-size photos are not included. The web-ready images are in
`source/src/assets/img`.