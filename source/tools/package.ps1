# Packages the website as a zip for sharing.
# Usage (from the project root):
#   .\tools\package.ps1         share\Vizion-Insurance-Website.zip   - co-workers open it straight from a folder
#   .\tools\package.ps1 -Web    share\Vizion-Website-for-Netlify.zip - upload to a free host for a preview link
#                               (hidden from search engines so it can't compete with the real site)
#   .\tools\package.ps1 -GitHub share\Vizion-Website-for-GitHub.zip  - repository contents: the site at the top
#                               (ready for GitHub Pages, also hidden from search engines) plus editable source
param([switch]$Web, [switch]$GitHub, [string]$GitHubBase = '/vizion-website-preview/')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding $false
$shareDir = Join-Path $root 'share'
$name = $(if ($GitHub) { 'Vizion-Website-for-GitHub' } elseif ($Web) { 'Vizion-Website-for-Netlify' } else { 'Vizion-Insurance-Website' })

# Keeps a hosted preview out of search results until the real site launches.
function Set-NoIndex([string]$dir) {
    Get-ChildItem $dir -Filter *.html | ForEach-Object {
        $html = [IO.File]::ReadAllText($_.FullName, $utf8)
        $html = $html.Replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, nofollow">')
        [IO.File]::WriteAllText($_.FullName, $html, $utf8)
    }
    [IO.File]::WriteAllText((Join-Path $dir 'robots.txt'), "User-agent: *`nDisallow: /`n", $utf8)
    $headers = Join-Path $dir '_headers'
    $text = [IO.File]::ReadAllText($headers, $utf8).Replace("`n/*`n", "`n/*`n  X-Robots-Tag: noindex, nofollow`n")
    [IO.File]::WriteAllText($headers, $text, $utf8)
}
# Short staging folder keeps paths under the Windows 260-character limit.
# Files sit at the zip root; "Extract All" creates a folder named after the zip.
$stage = Join-Path $shareDir 's'
$zip = Join-Path $shareDir "$name.zip"

& (Join-Path $root 'build.ps1') | Out-Null

New-Item -ItemType Directory -Force $shareDir | Out-Null
foreach ($old in @($stage, $zip)) { if (Test-Path $old) { Remove-Item -Recurse -Force $old } }
New-Item -ItemType Directory -Force $stage | Out-Null

if ($GitHub) {
    # Repository layout: the finished site at the top (GitHub Pages serves it from the root),
    # the editable project in "source". Company documents, original photos and internal notes stay out.
    Copy-Item (Join-Path $root 'site\*') $stage -Recurse
    Set-NoIndex $stage
    # GitHub Pages serves a project site one level down (/<repository>/), so the 404 page's
    # root-relative links need that prefix. Pass -GitHubBase '/' for a user site or custom domain.
    $notFound = Join-Path $stage '404.html'
    $html = [IO.File]::ReadAllText($notFound, $utf8).Replace('href="/', "href=""$GitHubBase").Replace('src="/', "src=""$GitHubBase")
    [IO.File]::WriteAllText($notFound, $html, $utf8)
    # Without this file GitHub Pages runs Jekyll, which would try to process the source templates.
    # (A line break rather than empty: GitHub's web uploader can skip empty files.)
    [IO.File]::WriteAllText((Join-Path $stage '.nojekyll'), "`n", $utf8)
    $sourceDir = Join-Path $stage 'source'
    New-Item -ItemType Directory -Force $sourceDir | Out-Null
    Copy-Item (Join-Path $root 'src') $sourceDir -Recurse
    Copy-Item (Join-Path $root 'tools') $sourceDir -Recurse
    Copy-Item (Join-Path $root 'build.ps1') $sourceDir
    [IO.File]::WriteAllText((Join-Path $stage '.gitignore'), "source/site/`nsource/share/`n", $utf8)

    $readme = @'
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
'@
    [IO.File]::WriteAllText((Join-Path $stage 'README.md'), $readme.Replace("`r`n", "`n"), $utf8)
} elseif ($Web) {
    # The site goes in its own "website" folder (the one to upload); instructions sit beside it.
    $siteDir = Join-Path $stage 'website'
    New-Item -ItemType Directory -Force $siteDir | Out-Null
    Copy-Item (Join-Path $root 'site\*') $siteDir -Recurse
    Set-NoIndex $siteDir

    $readme = @'
VIZION INSURANCE WEBSITE - PREVIEW FOR NETLIFY
==============================================

The folder named "website" is the complete site, ready to upload to Netlify's
free hosting so co-workers can open it from a single web link.

1. Extract this zip (right-click > Extract All).
2. Go to  https://app.netlify.com/drop  and sign up or log in (free).
   Without an account, Netlify deletes the site after about an hour.
3. Drag the folder named "website" (not this text file) onto the page.
   After a few seconds Netlify shows a link such as
   https://random-name-123.netlify.app
4. Optional: Site configuration > Change site name, e.g. vizion-preview,
   to get https://vizion-preview.netlify.app
5. Share the link. To update later, open the site in Netlify > Deploys and
   drag the new "website" folder onto it.

Please note
- The link is unlisted and hidden from Google, but anyone who has the link
  can open it. Don't post it publicly.
- This is a preview, not the official vizioninsurance.net website.
'@
    [IO.File]::WriteAllText((Join-Path $stage 'HOW-TO-PUBLISH.txt'), $readme.Replace("`n", "`r`n"), $utf8)
} else {
    Copy-Item (Join-Path $root 'site\*') $stage -Recurse
    Remove-Item (Join-Path $stage '_headers')   # host configuration, not needed for a local preview

    # Pages opened from disk can't load CSS mask images from separate files,
    # so the team photo mask is embedded in the stylesheet for this copy only.
    $css = Join-Path $stage 'assets\css\styles.css'
    $maskRef = 'url("../img/team-group-mask.png")'
    $text = [IO.File]::ReadAllText($css, $utf8)
    $count = ([regex]::Matches($text, [regex]::Escape($maskRef))).Count
    if ($count -ne 2) { throw "Expected 2 mask references in styles.css, found $count" }
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $stage 'assets\img\team-group-mask.png')))
    $text = $text.Replace($maskRef, 'var(--team-mask)') + "`n:root { --team-mask: url(""data:image/png;base64,$b64""); }`n"
    [IO.File]::WriteAllText($css, $text, $utf8)

    $readme = @'
VIZION INSURANCE WEBSITE - PREVIEW
==================================

How to open it
1. Right-click the zip file and choose "Extract All...", then click Extract.
   (Opening index.html from inside the zip without extracting will not work.)
2. Open the extracted folder and double-click  index.html
   Chrome or Edge recommended. An internet connection is needed for the fonts
   and the optional map on the Contact page.

Please note
- This is a preview for internal review, not the live website.
- The logo is a redrawn placeholder until the official logo file is supplied.
- Items still to be confirmed are listed in PROJECT-NOTES.md (ask the web team).
'@
    [IO.File]::WriteAllText((Join-Path $stage 'HOW-TO-OPEN.txt'), $readme.Replace("`n", "`r`n"), $utf8)
}

# Written with System.IO.Compression rather than Compress-Archive, which stores "\" in
# entry names on Windows PowerShell 5.1 and breaks extraction on macOS and other tools.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
    Get-ChildItem $stage -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, 'Optimal')
    }
} finally {
    $archive.Dispose()
}
Remove-Item -Recurse -Force $stage
"Created $zip ({0:N0} KB)" -f ((Get-Item $zip).Length / 1KB)
