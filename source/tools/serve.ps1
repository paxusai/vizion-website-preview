# Minimal local preview server for the built site (.\site).
# Usage (from the project root):  .\tools\serve.ps1 [-Port 8080]
param([int]$Port = 8080)

$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'site'
$types = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'
    '.ico' = 'image/x-icon'; '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'
    '.xml' = 'application/xml'; '.txt' = 'text/plain; charset=utf-8'; '.pdf' = 'application/pdf'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"
try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
        if ($path.EndsWith('/')) { $path += 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
        $status = 200
        if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) {
            $file = Join-Path $root '404.html'
            $status = 404
        }
        try {
            $bytes = [IO.File]::ReadAllBytes($file)
            $ext = [IO.Path]::GetExtension($file).ToLower()
            $ctx.Response.StatusCode = $status
            $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
            $ctx.Response.Headers.Add('Cache-Control', 'no-store')
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            $ctx.Response.StatusCode = 500
        } finally {
            $ctx.Response.OutputStream.Close()
        }
    }
} finally {
    $listener.Stop()
}
