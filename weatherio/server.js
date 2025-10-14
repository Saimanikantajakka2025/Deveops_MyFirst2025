const http = require('http');
const fs   = require('fs');
const path = require('path');

/*
 * Simple HTTP server for the Weather.io demo application.
 *
 * This server exposes a very small REST API for storing and retrieving
 * user‑provided weather overrides.  It does not fetch live weather
 * information – the browser code talks directly to wttr.in for daily
 * forecasts.  You can run this server with `node server.js` from
 * the project root.  It listens on port 8000 by default and serves
 * static files from the `public` directory alongside the API routes.
 */

const DATA_DIR       = path.join(__dirname, 'data');
const OVERRIDES_FILE = path.join(DATA_DIR, 'overrides.json');

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load overrides from disk.  If the file doesn’t exist yet, an empty
// array will be returned.  The overrides structure is an array of
// objects with the following fields:
//   lat: String        – latitude (as passed from client)
//   lon: String        – longitude (as passed from client)
//   date: String       – ISO date (YYYY‑MM‑DD)
//   newValues: Object  – user provided values
//   updatedAt: String  – ISO timestamp
//   updatedBy: String  – session identifier (not used here)
//   version: Number    – monotonically increasing per (lat,lon,date)
//   active: Boolean    – whether this override is the current one
function readOverrides() {
  try {
    const raw = fs.readFileSync(OVERRIDES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // If the file is missing or invalid, return an empty list
    return [];
  }
}

function writeOverrides(list) {
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(list, null, 2));
}

// Find the latest active override for a given lat/lon/date.  Returns
// either an override object or null if none exist.
function getLatestOverride(lat, lon, date) {
  const all = readOverrides();
  const candidates = all.filter(o => o.active && o.lat === lat && o.lon === lon && o.date === date);
  if (candidates.length === 0) return null;
  // Select the override with the highest version number
  return candidates.reduce((a, b) => (a.version > b.version ? a : b));
}

// Insert a new override and deactivate previous ones for the same key
function addOverride(lat, lon, date, values) {
  const all = readOverrides();
  let maxVersion = 0;
  for (const o of all) {
    if (o.lat === lat && o.lon === lon && o.date === date) {
      maxVersion = Math.max(maxVersion, o.version);
      o.active = false;
    }
  }
  const newOverride = {
    lat,
    lon,
    date,
    newValues: values,
    updatedAt: new Date().toISOString(),
    updatedBy: 'anonymous',
    version: maxVersion + 1,
    active: true,
  };
  all.push(newOverride);
  writeOverrides(all);
  return newOverride;
}

// Deactivate the latest active override for a given key
function removeOverride(lat, lon, date) {
  const all = readOverrides();
  let removed = null;
  for (const o of all) {
    if (o.active && o.lat === lat && o.lon === lon && o.date === date) {
      o.active = false;
      removed = o;
    }
  }
  if (removed) {
    writeOverrides(all);
  }
  return removed;
}

// Determine the mime type for a given filename extension.  This is
// intentionally very simple and only covers the types we serve in this
// project.
const MIME_MAP = {
  '.html': 'text/html; charset=UTF-8',
  '.css':  'text/css; charset=UTF-8',
  '.js':   'text/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
};

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Support CORS for API routes
  if (pathname.startsWith('/override') || pathname === '/health') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      return;
    }
  }

  // Health endpoint
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // Override endpoints
  if (pathname === '/override') {
    const lat  = parsedUrl.searchParams.get('lat');
    const lon  = parsedUrl.searchParams.get('lon');
    const date = parsedUrl.searchParams.get('date');
    if (method === 'GET') {
      if (!lat || !lon || !date) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ error: 'Missing lat, lon or date parameter' }));
        return;
      }
      const override = getLatestOverride(lat, lon, date);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify(override || {}));
      return;
    } else if (method === 'POST') {
      // read body
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const { lat, lon, date, values } = data;
          if (!lat || !lon || !date || !values) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
            res.end(JSON.stringify({ error: 'lat, lon, date and values are required' }));
            return;
          }
          const override = addOverride(String(lat), String(lon), String(date), values);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify(override));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    } else if (method === 'DELETE') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const { lat, lon, date } = data;
          if (!lat || !lon || !date) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
            res.end(JSON.stringify({ error: 'lat, lon and date are required' }));
            return;
          }
          const removed = removeOverride(String(lat), String(lon), String(date));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ removed: !!removed }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }
    // Method not supported
    res.writeHead(405, { 'Content-Type': 'application/json; charset=UTF-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  // Static file handling
  // Normalize path to prevent directory traversal attacks
  let safePath = pathname;
  if (safePath.includes('..')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('Bad Request');
    return;
  }
  // Default to index.html for the root
  let filePath = path.join(__dirname, 'public', safePath === '/' ? 'index.html' : safePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // If file not found, return 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': getMime(filePath) });
    res.end(data);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Weather.io server running at http://localhost:${PORT}`);
});