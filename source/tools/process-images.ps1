# Prepares web-ready images from the original photos in /source-files.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File tools\process-images.ps1
# Output goes to src\assets\img. Re-run whenever a source photo is replaced.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root 'source-files'
$outDir = Join-Path $root 'src\assets\img'
New-Item -ItemType Directory -Force $outDir | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;

public static class VizImg
{
    static ImageCodecInfo JpegCodec()
    {
        foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") return c;
        throw new Exception("No JPEG encoder");
    }

    public static void SaveJpeg(Bitmap b, string path, long quality)
    {
        var ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        b.Save(path, JpegCodec(), ep);
    }

    static void ApplyExifOrientation(Image img)
    {
        const int OrientationId = 0x0112;
        if (Array.IndexOf(img.PropertyIdList, OrientationId) < 0) return;
        int o = img.GetPropertyItem(OrientationId).Value[0];
        RotateFlipType t = RotateFlipType.RotateNoneFlipNone;
        if (o == 3) t = RotateFlipType.Rotate180FlipNone;
        else if (o == 6) t = RotateFlipType.Rotate90FlipNone;
        else if (o == 8) t = RotateFlipType.Rotate270FlipNone;
        if (t != RotateFlipType.RotateNoneFlipNone) img.RotateFlip(t);
        img.RemovePropertyItem(OrientationId);
    }

    public static Bitmap Resize(Image src, int w, int h, bool alpha)
    {
        var b = new Bitmap(w, h, alpha ? PixelFormat.Format32bppArgb : PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(b))
        using (var wrap = new ImageAttributes())
        {
            g.CompositingMode = CompositingMode.SourceCopy;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            wrap.SetWrapMode(WrapMode.TileFlipXY);
            g.DrawImage(src, new Rectangle(0, 0, w, h), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, wrap);
        }
        return b;
    }

    // Resize to a target width, optionally cropping first (cx, cy, cw, ch in source pixels; cw = 0 means no crop).
    public static string ResizeJpeg(string src, string dst, int width, long quality, int cx, int cy, int cw, int ch)
    {
        using (var s = Image.FromFile(src))
        {
            ApplyExifOrientation(s);
            Image work = s;
            Bitmap cropped = null;
            if (cw > 0)
            {
                cropped = new Bitmap(cw, ch, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(cropped))
                    g.DrawImage(s, new Rectangle(0, 0, cw, ch), cx, cy, cw, ch, GraphicsUnit.Pixel);
                work = cropped;
            }
            int w = Math.Min(width, work.Width);
            int h = (int)Math.Round(work.Height * (double)w / work.Width);
            using (var b = Resize(work, w, h, false)) SaveJpeg(b, dst, quality);
            if (cropped != null) cropped.Dispose();
            return w + "x" + h;
        }
    }

    // Removes the flat white studio background from the group photo.
    // Writes a JPEG composited onto `bg` (fallback) and a PNG alpha mask used with CSS mask-image.
    public static void GroupCutout(string src, string jpgOut, string maskOut, int outW, int bgR, int bgG, int bgB, long quality)
    {
        using (var s = new Bitmap(src))
        {
            int W = s.Width, H = s.Height;
            var rect = new Rectangle(0, 0, W, H);
            var data = s.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            var px = new byte[stride * H];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            s.UnlockBits(data);

            var mn = new byte[W * H];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    int i = y * stride + x * 4;
                    mn[y * W + x] = Math.Min(px[i], Math.Min(px[i + 1], px[i + 2]));
                }

            const int T = 242;
            var isBg = new bool[W * H];
            var q = new Queue<int>();
            Action<int> seed = p => { if (!isBg[p] && mn[p] >= T) { isBg[p] = true; q.Enqueue(p); } };
            for (int x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
            for (int y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
            while (q.Count > 0)
            {
                int p = q.Dequeue();
                int x = p % W, y = p / W;
                if (x > 0) seed(p - 1);
                if (x < W - 1) seed(p + 1);
                if (y > 0) seed(p - W);
                if (y < H - 1) seed(p + W);
            }

            var a = new float[W * H];
            for (int p = 0; p < W * H; p++) a[p] = isBg[p] ? 0f : 1f;
            // Soften the halo: light pixels touching the background become partly transparent.
            for (int y = 1; y < H - 1; y++)
                for (int x = 1; x < W - 1; x++)
                {
                    int p = y * W + x;
                    if (isBg[p]) continue;
                    bool edge = isBg[p - 1] || isBg[p + 1] || isBg[p - W] || isBg[p + W] ||
                                isBg[p - W - 1] || isBg[p - W + 1] || isBg[p + W - 1] || isBg[p + W + 1];
                    if (edge) a[p] = Math.Max(0f, Math.Min(1f, (255f - mn[p]) / 85f));
                }
            var blurred = new float[W * H];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    float sum = 0; int n = 0;
                    for (int dy = -1; dy <= 1; dy++)
                        for (int dx = -1; dx <= 1; dx++)
                        {
                            int xx = x + dx, yy = y + dy;
                            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                            sum += a[yy * W + xx]; n++;
                        }
                    blurred[y * W + x] = sum / n;
                }

            var comp = new byte[stride * H];
            var mask = new byte[stride * H];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    int p = y * W + x, i = y * stride + x * 4;
                    float al = blurred[p];
                    comp[i] = (byte)(px[i] * al + bgB * (1 - al));
                    comp[i + 1] = (byte)(px[i + 1] * al + bgG * (1 - al));
                    comp[i + 2] = (byte)(px[i + 2] * al + bgR * (1 - al));
                    comp[i + 3] = 255;
                    mask[i] = 0; mask[i + 1] = 0; mask[i + 2] = 0;
                    mask[i + 3] = (byte)Math.Round(al * 255);
                }

            using (var compBmp = new Bitmap(W, H, PixelFormat.Format32bppArgb))
            using (var maskBmp = new Bitmap(W, H, PixelFormat.Format32bppArgb))
            {
                var cd = compBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                Marshal.Copy(comp, 0, cd.Scan0, comp.Length); compBmp.UnlockBits(cd);
                var md = maskBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                Marshal.Copy(mask, 0, md.Scan0, mask.Length); maskBmp.UnlockBits(md);

                int oh = (int)Math.Round(H * (double)outW / W);
                using (var c2 = Resize(compBmp, outW, oh, false)) SaveJpeg(c2, jpgOut, quality);
                using (var m2 = Resize(maskBmp, outW, oh, true)) m2.Save(maskOut, ImageFormat.Png);
            }
        }
    }

    // 1200x630 social sharing card.
    public static void OgImage(string groupJpg, string groupMask, string dst)
    {
        const int W = 1200, H = 630;
        var paper = Color.FromArgb(247, 246, 241);
        using (var b = new Bitmap(W, H, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(b))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(paper);

            // Green panel with the logo's arc motif behind the team.
            var panel = new Rectangle(560, 40, 600, 590);
            using (var path = RoundedTop(panel, 36))
            using (var brush = new LinearGradientBrush(panel, Color.FromArgb(226, 239, 229), Color.FromArgb(205, 228, 211), 90f))
                g.FillPath(brush, path);
            using (var pen = new Pen(Color.FromArgb(60, 30, 138, 69), 34f))
                g.DrawArc(pen, 620, 70, 480, 480, 150, 250);
            using (var pen = new Pen(Color.FromArgb(46, 165, 82), 6f))
                g.DrawArc(pen, 600, 50, 520, 520, 160, 230);

            // Team photo, masked.
            using (var photo = new Bitmap(groupJpg))
            using (var mask = new Bitmap(groupMask))
            using (var cut = new Bitmap(photo.Width, photo.Height, PixelFormat.Format32bppArgb))
            {
                var r = new Rectangle(0, 0, photo.Width, photo.Height);
                var pd = photo.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var md = mask.LockBits(r, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var cd = cut.LockBits(r, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                int n = pd.Stride * photo.Height;
                var pp = new byte[n]; var mm = new byte[n];
                Marshal.Copy(pd.Scan0, pp, 0, n); Marshal.Copy(md.Scan0, mm, 0, n);
                for (int i = 0; i < n; i += 4) pp[i + 3] = mm[i + 3];
                Marshal.Copy(pp, 0, cd.Scan0, n);
                photo.UnlockBits(pd); mask.UnlockBits(md); cut.UnlockBits(cd);
                int pw = 600, ph = (int)Math.Round(photo.Height * 600.0 / photo.Width);
                g.SetClip(panel);
                g.DrawImage(cut, new Rectangle(560, H - ph, pw, ph));
                g.ResetClip();
            }

            var ink = Color.FromArgb(31, 34, 36);
            var green = Color.FromArgb(23, 117, 58);
            using (var f = new Font("Segoe UI Semibold", 17f, GraphicsUnit.Pixel))
            using (var br = new SolidBrush(green))
                g.DrawString("VIZION INSURANCE COMPANY, LTD.", f, br, 64, 92);
            using (var f = new Font("Georgia", 60f, GraphicsUnit.Pixel))
            using (var br = new SolidBrush(ink))
                g.DrawString("Going further\nto serve you\nbetter.", f, br, new RectangleF(58, 140, 500, 300));
            using (var f = new Font("Segoe UI", 22f, GraphicsUnit.Pixel))
            using (var br = new SolidBrush(Color.FromArgb(70, 76, 80)))
                g.DrawString("Non-life insurance and bonds\nSaipan, CNMI  " + (char)183 + "  (670) 233-7251", f, br, 64, 470);

            SaveJpeg(b.Clone(new Rectangle(0, 0, W, H), PixelFormat.Format24bppRgb), dst, 86);
        }
    }

    static GraphicsPath RoundedTop(Rectangle r, int rad)
    {
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, rad * 2, rad * 2, 180, 90);
        p.AddArc(r.Right - rad * 2, r.Y, rad * 2, rad * 2, 270, 90);
        p.AddLine(r.Right, r.Bottom, r.X, r.Bottom);
        p.CloseFigure();
        return p;
    }

    // Square app icon drawn from the same geometry as favicon.svg (64-unit grid).
    public static void AppIcon(string dst, int size)
    {
        using (var b = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(b))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.White);
            float k = size / 64f * 0.78f, o = size * 0.11f;
            g.TranslateTransform(o, o);
            g.ScaleTransform(k, k);
            using (var swoosh = new GraphicsPath())
            {
                swoosh.AddArc(4.5f, 4.4f, 54f, 54f, 136.4f, 212.1f);
                swoosh.AddArc(9f, 12f, 52f, 52f, 332.4f, -180f);
                swoosh.CloseFigure();
                using (var br = new LinearGradientBrush(new RectangleF(0, 0, 64, 64), Color.FromArgb(27, 133, 64), Color.FromArgb(73, 186, 98), 45f))
                    g.FillPath(br, swoosh);
            }
            using (var leaf = new GraphicsPath())
            {
                leaf.AddArc(5f, 7f, 52f, 52f, 2.2f, 90f);
                leaf.AddArc(-55.3f, -55.4f, 120f, 120f, 65.1f, -35.7f);
                leaf.CloseFigure();
                using (var br = new SolidBrush(Color.FromArgb(46, 165, 82))) g.FillPath(br, leaf);
            }
            var st = g.Save();
            g.TranslateTransform(32.5f, 34f);
            g.RotateTransform(-25f);
            using (var br = new LinearGradientBrush(new RectangleF(-12.5f, -11f, 25f, 22f), Color.FromArgb(160, 143, 103), Color.FromArgb(92, 80, 52), 60f))
                g.FillEllipse(br, -12.5f, -11f, 25f, 22f);
            g.Restore(st);
            using (var pen = new Pen(Color.FromArgb(225, 214, 182), 2.2f))
            {
                pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
                g.DrawArc(pen, 24f, 25f, 15f, 15f, 150f, 120f);
            }
            b.Save(dst, ImageFormat.Png);
        }
    }
}
'@

function Out-Img($name) { Join-Path $outDir $name }
function In-Img($name) { Join-Path $srcDir $name }

# Team portraits (3:4 originals). Two widths for srcset.
$portraits = @{ 'Sir John.jpg' = 'team-john'; 'Aimee.jpg' = 'team-aimee'; 'LJ.jpg' = 'team-lj'; 'Owee.jpg' = 'team-owee'; 'Rasem.jpg' = 'team-rasem' }
foreach ($k in $portraits.Keys) {
    $base = $portraits[$k]
    # Crop to 4:5 from the lower part of the frame so faces sit in the upper third.
    $a = [VizImg]::ResizeJpeg((In-Img $k), (Out-Img "$base-800.jpg"), 800, 80, 0, 100, 1200, 1500)
    $b = [VizImg]::ResizeJpeg((In-Img $k), (Out-Img "$base-480.jpg"), 480, 78, 0, 100, 1200, 1500)
    "$base  $a / $b"
}

# Office photos.
"office-counter  " + [VizImg]::ResizeJpeg((In-Img 'Photo 2.jpg'), (Out-Img 'office-counter-1184.jpg'), 1184, 80, 0, 0, 0, 0)
"office-counter  " + [VizImg]::ResizeJpeg((In-Img 'Photo 2.jpg'), (Out-Img 'office-counter-720.jpg'), 720, 78, 0, 0, 0, 0)
"office-desk     " + [VizImg]::ResizeJpeg((In-Img 'Photo 1.jpg'), (Out-Img 'office-desk-900.jpg'), 900, 80, 0, 0, 0, 0)
"office-desk     " + [VizImg]::ResizeJpeg((In-Img 'Photo 1.jpg'), (Out-Img 'office-desk-540.jpg'), 540, 78, 0, 0, 0, 0)

# Group photo: cut out from the white background.
[VizImg]::GroupCutout((In-Img 'Group Photo.png'), (Out-Img 'team-group-1400.jpg'), (Out-Img 'team-group-mask.png'), 1400, 226, 238, 229, 82)
[VizImg]::GroupCutout((In-Img 'Group Photo.png'), (Out-Img 'team-group-800.jpg'), (Out-Img 'team-group-mask-800.png'), 800, 226, 238, 229, 80)
Remove-Item (Out-Img 'team-group-mask-800.png')
"team-group done"

[VizImg]::OgImage((Out-Img 'team-group-1400.jpg'), (Out-Img 'team-group-mask.png'), (Out-Img 'og-image.jpg'))
[VizImg]::AppIcon((Join-Path $root 'src\apple-touch-icon.png'), 180)
[VizImg]::AppIcon((Join-Path $root 'src\icon-512.png'), 512)
"og-image + icons done"

Get-ChildItem $outDir | Select-Object Name, @{n='KB';e={[math]::Round($_.Length/1KB)}} | Format-Table -AutoSize | Out-String
