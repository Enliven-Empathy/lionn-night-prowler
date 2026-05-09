import { ExtractedGroup } from './types';

export function renderPreviewHtml(manifest: ExtractedGroup[], atlasUrl: string): string {
  const groupsJson = JSON.stringify(manifest, null, 2);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Sprite extract preview</title>
<style>
  :root { color-scheme: dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #07060c; color: #c8c0e0; margin: 0; padding: 32px;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 24px; color: #b89bff; letter-spacing: 0.04em; }
  .group {
    display: flex; gap: 24px; align-items: center;
    padding: 18px; margin-bottom: 16px;
    background: #110a1c; border: 1px solid #2c1f44; border-radius: 8px;
  }
  .group h2 { margin: 0 0 6px; font-size: 14px; color: #d8c9ff; }
  .group .meta { font-family: Menlo, monospace; font-size: 11px; color: #6b5c8c; }
  canvas {
    background:
      linear-gradient(45deg, #1a1226 25%, transparent 25%) 0 0/16px 16px,
      linear-gradient(-45deg, #1a1226 25%, transparent 25%) 0 8px/16px 16px,
      linear-gradient(45deg, transparent 75%, #1a1226 75%) 0 0/16px 16px,
      linear-gradient(-45deg, transparent 75%, #1a1226 75%) 0 8px/16px 16px,
      #0a0710;
    image-rendering: pixelated;
    border-radius: 4px;
  }
  .strip { display: flex; gap: 4px; margin-top: 12px; }
  .strip img { background: #0a0710; border: 1px solid #2c1f44; max-height: 120px; }
  label { font-size: 12px; color: #8a7cb8; }
  input[type=range] { vertical-align: middle; }
  .controls { display: flex; gap: 16px; align-items: center; }
</style>
</head>
<body>
<h1>Lionn — sprite extract preview</h1>
<div id="root"></div>
<script>
const groups = ${groupsJson};
const atlasUrl = ${JSON.stringify(atlasUrl)};

const atlas = new Image();
atlas.src = atlasUrl;
atlas.onload = () => init();

function init() {
  const root = document.getElementById('root');
  for (const g of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'group';

    const info = document.createElement('div');
    info.style.minWidth = '220px';
    info.innerHTML = '<h2>' + g.name + '</h2>' +
      '<div class="meta">' + g.frames.length + ' frames · ' + g.frameWidth + '×' + g.frameHeight + ' · anchor: ' + g.anchor + '</div>' +
      '<div class="controls" style="margin-top:10px">' +
        '<label>fps <span id="fpsv-' + g.name + '">' + g.frameRate + '</span></label>' +
        '<input type="range" min="1" max="24" value="' + g.frameRate + '" id="fps-' + g.name + '"/>' +
      '</div>';

    const canvas = document.createElement('canvas');
    canvas.width = g.frameWidth;
    canvas.height = g.frameHeight;
    const ctx = canvas.getContext('2d');

    const strip = document.createElement('div');
    strip.className = 'strip';
    for (const f of g.frames) {
      const sub = document.createElement('canvas');
      sub.width = f.width; sub.height = f.height;
      // We'll draw after atlas load below
      strip.appendChild(sub);
    }

    wrap.appendChild(info);
    wrap.appendChild(canvas);
    wrap.appendChild(strip);
    root.appendChild(wrap);

    // Draw strip thumbnails
    const subs = strip.querySelectorAll('canvas');
    g.frames.forEach((f, i) => {
      // Find the frame coords from the json — we need to fetch it
    });
    // Simpler: load atlas.json to map frame name → rect
    fetch(atlasUrl.replace(/\\.png$/, '.json'))
      .then(r => r.json())
      .then(meta => {
        g.frames.forEach((f, i) => {
          const rect = meta.frames[f.fileName].frame;
          const sub = subs[i];
          const sctx = sub.getContext('2d');
          sctx.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        });

        let frameIdx = 0;
        let lastTime = performance.now();
        let fps = g.frameRate;
        const range = document.getElementById('fps-' + g.name);
        const label = document.getElementById('fpsv-' + g.name);
        range.addEventListener('input', () => { fps = +range.value; label.textContent = fps; });
        function loop(now) {
          const dt = now - lastTime;
          if (dt >= 1000 / fps) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const f = g.frames[frameIdx];
            const rect = meta.frames[f.fileName].frame;
            ctx.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
            frameIdx = (frameIdx + 1) % g.frames.length;
            lastTime = now;
          }
          requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
      });
  }
}
</script>
</body>
</html>
`;
}
