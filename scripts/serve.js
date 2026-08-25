// Minimal static file server for the harness.
//
// ES modules cannot be loaded over file://, so the page needs to be served over
// HTTP. Node ships no static server, and pulling one in would be a dependency
// for something that is thirty lines - so this is thirty lines.
//
//   npm run serve   ->  http://localhost:8080

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = normalize(requested === "/" ? "/index.html" : requested).replace(/^(\.\.[/\\])+/, "");
  const path = join(ROOT, relative);

  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => {
  console.log(`FlowLab harness on http://localhost:${PORT}`);
});
