# Builds the static website into .\site from the sources in .\src
#
#   src\layout.html      shared <head>, header, menus and footer
#   src\partials\*.html  reusable snippets, inserted with {{> name}}
#   src\pages\*.html     one file per page; starts with a front-matter block:
#                          ---
#                          title: Page title
#                          description: Search/social description
#                          path: page.html          (canonical path, blank for home)
#                          nav: claims              (highlights the matching menu link)
#                          section: about           (highlights a dropdown parent)
#                          ---
#   src\assets, src\*.*  copied as-is
#
# Usage (from this folder):  .\build.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$out = Join-Path $root 'site'
$utf8 = New-Object System.Text.UTF8Encoding $false

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory $out | Out-Null
Copy-Item (Join-Path $src 'assets') -Destination (Join-Path $out 'assets') -Recurse
Get-ChildItem $src -File | Where-Object { $_.Name -ne 'layout.html' } | Copy-Item -Destination $out

$layout = [IO.File]::ReadAllText((Join-Path $src 'layout.html'), $utf8)

# Content-Security-Policy hash for the small inline script in the layout <head>.
$headersFile = Join-Path $out '_headers'
if (Test-Path $headersFile) {
    $inline = [regex]::Match($layout, '<script>(.*?)</script>', 'Singleline').Groups[1].Value
    $sha = [Security.Cryptography.SHA256]::Create().ComputeHash($utf8.GetBytes($inline))
    $hash = 'sha256-' + [Convert]::ToBase64String($sha)
    [IO.File]::WriteAllText($headersFile, [IO.File]::ReadAllText($headersFile, $utf8).Replace('INLINE_SCRIPT_HASH', $hash), $utf8)
}
$partials = @{}
Get-ChildItem (Join-Path $src 'partials') -Filter *.html -ErrorAction SilentlyContinue | ForEach-Object {
    $partials[$_.BaseName] = [IO.File]::ReadAllText($_.FullName, $utf8).TrimEnd()
}
$defaults = @{ base = ''; head = ''; robots = 'index, follow'; bodyclass = ''; path = ''; nav = ''; section = '' }

$built = 0
foreach ($page in Get-ChildItem (Join-Path $src 'pages') -Filter *.html) {
    $raw = [IO.File]::ReadAllText($page.FullName, $utf8)
    if ($raw -notmatch '(?s)^---\r?\n(.*?)\r?\n---\r?\n(.*)$') { throw "Missing front matter in $($page.Name)" }
    $front = $Matches[1]
    $body = $Matches[2]

    $meta = @{} + $defaults
    foreach ($line in $front -split '\r?\n') {
        if ($line -match '^\s*([\w-]+)\s*:\s*(.*)$') { $meta[$Matches[1]] = $Matches[2].Trim() }
    }

    $html = $layout.Replace('{{content}}', $body.TrimEnd())
    for ($i = 0; $i -lt 3; $i++) {
        $html = [regex]::Replace($html, '\{\{>\s*([\w-]+)\s*\}\}', {
            param($m)
            $name = $m.Groups[1].Value
            if (-not $partials.ContainsKey($name)) { throw "Unknown partial '$name' in $($page.Name)" }
            $partials[$name]
        })
    }
    foreach ($key in $meta.Keys) { $html = $html.Replace("{{$key}}", $meta[$key]) }
    if ($meta.nav) { $html = $html.Replace("data-nav=`"$($meta.nav)`"", "data-nav=`"$($meta.nav)`" aria-current=`"page`"") }
    if ($meta.section) { $html = $html.Replace("data-section=`"$($meta.section)`"", "data-section=`"$($meta.section)`" data-active") }

    $left = [regex]::Matches($html, '\{\{[^}]+\}\}') | ForEach-Object { $_.Value } | Select-Object -Unique
    if ($left) { throw "Unfilled placeholders in $($page.Name): $($left -join ', ')" }

    [IO.File]::WriteAllText((Join-Path $out $page.Name), $html, $utf8)
    $built++
}
"Built $built pages into $out"
