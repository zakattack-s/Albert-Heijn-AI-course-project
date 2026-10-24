const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.CHAT_APP_PORT || process.env.PORT || 3000);
const apiProxy = process.env.API_PROXY || "http://localhost:8000/invocations";
const publicDir = path.join(__dirname, "public");

// Databricks' chat proxy reliably forwards the document request but some
// deployments do not forward root-relative asset requests to the UI port.
// Inline the local CSS and JavaScript so the complete interface arrives in
// one response, while keeping the source files separate for maintainability.
const indexTemplate = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const inlineStyles = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
const inlineScript = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const bundledIndex = indexTemplate
  .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${inlineStyles}</style>`)
  .replace('<script src="/app.js" defer></script>', `<script>${inlineScript}</script>`);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function proxyChat(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  try {
    const upstream = await fetch(apiProxy, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.concat(chunks),
    });

    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    sendJson(res, 502, {
      error: "The assistant service could not be reached.",
      detail: error.message,
    });
  }
}

function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];

  if (requestedPath === "/index.html") {
    res.writeHead(200, {
      "Content-Type": mimeTypes[".html"],
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") return res.end();
    return res.end(bundledIndex);
  }

  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: "Forbidden" });

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (path.extname(filePath)) return sendJson(res, 404, { error: "Not found" });
      return fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) return sendJson(res, 500, { error: "Interface unavailable" });
        res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
        res.end(fallback);
      });
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return proxyChat(req, res);
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on http://localhost:${port}`);
});
