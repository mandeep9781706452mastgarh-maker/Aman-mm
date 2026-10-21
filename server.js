// Prompt + photos -> real AI video, using Google's Gemini Omni Flash video model.
// No dependencies: just Node 18+. Your API key stays on the server (GEMINI_API_KEY).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY = process.env.GEMINI_API_KEY;
const BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com';
const MODEL = process.env.VIDEO_MODEL || 'gemini-omni-1.1-flash';
const PASSWORD = process.env.APP_PASSWORD || '';
const PORT = process.env.PORT || 3000;

const outDir = path.join(os.tmpdir(), 'prompt-to-video');
fs.mkdirSync(outDir, { recursive: true });
const jobs = new Map();

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function findVideo(o) {
  if (!o || typeof o !== 'object') return null;
  if (typeof o.mime_type === 'string' && o.mime_type.startsWith('video/') && (typeof o.data === 'string' || typeof o.uri === 'string')) return o;
  for (const v of Object.values(o)) {
    const r = findVideo(v);
    if (r) return r;
  }
  return null;
}

async function run(id, { prompt, images, aspect, resolution }) {
  const job = jobs.get(id);
  try {
    const input = images.map((d) => {
      const m = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(String(d));
      if (!m) throw new Error('One of the photos could not be read.');
      return { type: 'image', data: m[2], mime_type: m[1] };
    });
    input.push({ type: 'text', text: prompt });

    const r = await fetch(`${BASE}/v1beta/interactions`, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input,
        response_format: { type: 'video', aspect_ratio: aspect, resolution }
      }),
      signal: AbortSignal.timeout(10 * 60 * 1000)
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || text.slice(0, 300);
      throw new Error(`Video service error (${r.status}): ${msg}`);
    }
    const video = findVideo(data);
    if (!video) throw new Error('The service answered, but no video came back. It may have blocked the prompt or photo. Try different wording.');
    let buf;
    if (video.data) {
      buf = Buffer.from(video.data, 'base64');
    } else {
      const f = await fetch(video.uri, { headers: { 'x-goog-api-key': KEY } });
      if (!f.ok) throw new Error('Could not download the finished video.');
      buf = Buffer.from(await f.arrayBuffer());
    }
    const file = path.join(outDir, id + '.mp4');
    fs.writeFileSync(file, buf);
    job.status = 'done';
    job.file = file;
  } catch (e) {
    job.status = 'error';
    job.error = e && e.message ? e.message : 'Something went wrong.';
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Too big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveVideo(req, res, file, download) {
  const size = fs.statSync(file).size;
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  if (download) headers['Content-Disposition'] = 'attachment; filename="my-video.mp4"';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (!m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
    end = Math.min(end, size - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (p === '/api/config') return send(res, 200, { needsPassword: !!PASSWORD, hasKey: !!KEY });

    if (p.startsWith('/api/')) {
      if (PASSWORD) {
        const given = req.headers['x-app-password'] || url.searchParams.get('p') || '';
        if (given !== PASSWORD) return send(res, 401, { error: 'Wrong or missing password.' });
      }
      if (p === '/api/generate' && req.method === 'POST') {
        if (!KEY) return send(res, 500, { error: 'The server has no GEMINI_API_KEY set.' });
        let body;
        try { body = JSON.parse(await readBody(req, 30 * 1024 * 1024)); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
        const { prompt, images, aspect, resolution } = body || {};
        if (typeof prompt !== 'string' || !prompt.trim()) return send(res, 400, { error: 'Write a prompt first.' });
        const id = crypto.randomBytes(8).toString('hex');
        jobs.set(id, { status: 'working', started: Date.now() });
        run(id, {
          prompt: prompt.trim().slice(0, 4000),
          images: Array.isArray(images) ? images.slice(0, 3) : [],
          aspect: aspect === '16:9' ? '16:9' : '9:16',
          resolution: ['360p', '720p', '1080p'].includes(resolution) ? resolution : '720p'
        });
        return send(res, 200, { id });
      }
      let m = /^\/api\/jobs\/([a-f0-9]+)$/.exec(p);
      if (m) {
        const j = jobs.get(m[1]);
        if (!j) return send(res, 404, { error: 'Unknown job.' });
        return send(res, 200, { status: j.status, error: j.error || null, seconds: Math.round((Date.now() - j.started) / 1000) });
      }
      m = /^\/api\/video\/([a-f0-9]+)$/.exec(p);
      if (m) {
        const j = jobs.get(m[1]);
        if (!j || j.status !== 'done') { res.writeHead(404); return res.end(); }
        return serveVideo(req, res, j.file, url.searchParams.get('download'));
      }
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    try { send(res, 500, { error: 'Server error.' }); } catch (x) {}
  }
});
server.listen(PORT, () => console.log(`Prompt-to-video running on port ${PORT}`));
