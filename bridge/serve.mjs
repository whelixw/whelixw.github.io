import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const host = "prohunterdogkeeper.dk";
const expiredPin = "7F:4C:C9:2E:E8:DD:3B:EA:94:6F:4B:9B:04:C9:3D:0A:F7:90:CD:15:9E:4C:11:04:8D:18:0D:AE:E7:B9:3D:7A";
const allowExpired = process.argv.includes("--allow-pinned-expired-cert");
const webOrigin = process.env.DECKEDITOR_WEB_ORIGIN;
if (webOrigin) {
  const url = new URL(webOrigin);
  if (url.protocol !== "https:" || url.origin !== webOrigin) {
    throw new Error("DECKEDITOR_WEB_ORIGIN must be a single HTTPS origin without a trailing slash");
  }
}
const port = Number((webOrigin && process.env.PORT) || process.env.DECKEDITOR_PORT || 41975);
const localHost = `127.0.0.1:${port}`;
const localOrigin = `http://${localHost}`;
const origin = webOrigin || localOrigin;
const agent = new https.Agent();
const contentTypes = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", jpg: "image/jpeg" };

if (allowExpired) {
  agent.createConnection = (options, done) => {
    const socket = tls.connect({ ...options, servername: host, rejectUnauthorized: false });
    const fail = (error) => done(error);
    socket.once("error", fail);
    socket.setTimeout(10000, () => socket.destroy(new Error("TLS handshake timed out")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const pinned = socket.authorizationError === "CERT_HAS_EXPIRED"
        && certificate.fingerprint256 === expiredPin
        && !tls.checkServerIdentity(host, certificate);
      if (!socket.authorized && !pinned) {
        socket.destroy(new Error("Cubeapp certificate failed validation and did not match the expired certificate pin"));
        return;
      }
      socket.setTimeout(0);
      socket.removeListener("error", fail);
      done(null, socket);
    });
  };
}

function apiRoute(path, method) {
  if (method === "GET") return /^\/api\/(?:db-info|auth\/user|limited\/sessions(?:\/\d+)?|limited\/pools\/\d+|images\/[\w-]+|search|cube-releases\/\d+)\/$/.test(path);
  return method === "POST" && /^\/api\/(?:auth\/login|limited\/pools\/\d+)\/$/.test(path);
}

function reply(response, status, message) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ detail: message }));
}

const server = http.createServer(async (request, response) => {
  if (!webOrigin && (request.headers.host !== localHost || (request.headers.origin && request.headers.origin !== origin))) {
    reply(response, 403, "Open the workbench at its loopback address");
    return;
  }
  if (!request.url.startsWith("/") || /^[\/\\]{2}/.test(request.url)) {
    return reply(response, 400, "Invalid request target");
  }
  const url = new URL(request.url, localOrigin);
  if (webOrigin && request.method === "GET" && url.pathname === "/healthz") {
    return reply(response, 200, "Bridge is running");
  }
  if (url.pathname.startsWith("/cubeapp/")) {
    const path = url.pathname.slice("/cubeapp".length);
    if (webOrigin) {
      response.setHeader("Vary", "Origin");
      if (request.headers.origin === origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
      } else {
        // A cross-origin image element can load public card art without an Origin header.
        const publicImage = !request.headers.origin && request.method === "GET"
          && /^\/api\/images\/[\w-]+\/$/.test(path) && !request.headers.authorization;
        if (!publicImage) return reply(response, 403, "Unexpected Workbench origin");
      }
      if (request.method === "OPTIONS") {
        const method = request.headers["access-control-request-method"];
        if (!apiRoute(path, method)) return reply(response, 404, "Unsupported Cubeapp route");
        response.writeHead(204, {
          "Access-Control-Allow-Methods": method,
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          Vary: "Origin, Access-Control-Request-Method",
        }).end();
        return;
      }
    }
    if (!apiRoute(path, request.method)) return reply(response, 404, "Unsupported Cubeapp route");
    if (request.method === "POST" && request.headers.origin !== origin) return reply(response, 403, "Unexpected Workbench origin");
    const headers = {};
    for (const key of ["authorization", "content-type", "content-length", "accept"]) {
      if (request.headers[key]) headers[key] = request.headers[key];
    }
    const upstream = https.request({ hostname: host, path: path + url.search, method: request.method, agent, headers }, (result) => {
      response.writeHead(result.statusCode, {
        "Content-Type": result.headers["content-type"] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      result.pipe(response);
    });
    upstream.setTimeout(12000, () => upstream.destroy(new Error("Cubeapp timed out")));
    upstream.on("error", (error) => {
      if (response.headersSent) response.destroy();
      else reply(response, 502, error.message);
    });
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
    return;
  }

  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  if (webOrigin || request.method !== "GET" || !/^\/(?:[\w-]+\.(?:html|js|css)|cards\/[\w-]+\.jpg)$/.test(path)) {
    return reply(response, 404, "File not found");
  }
  try {
    const file = fileURLToPath(new URL(`./dist${path}`, import.meta.url));
    const info = await stat(file);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.split(".").at(-1)],
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(response);
  } catch {
    reply(response, 404, "File not found");
  }
});

server.on("upgrade", (request, browser, head) => {
  if ((!webOrigin && request.headers.host !== localHost) || request.headers.origin !== origin
    || !/^\/cubeapp\/ws\/(?:lobbies|draft\/[a-f0-9-]+)\/$/.test(request.url)
    || request.headers.upgrade?.toLowerCase() !== "websocket"
    || request.headers["sec-websocket-version"] !== "13"
    || !/^[A-Za-z0-9+/]{22}==$/.test(request.headers["sec-websocket-key"] || "")) {
    browser.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = https.request({
    hostname: host, path: request.url.slice("/cubeapp".length), agent,
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": request.headers["sec-websocket-version"],
      "Sec-WebSocket-Key": request.headers["sec-websocket-key"],
      Origin: `https://${host}`,
    },
  });
  browser.on("error", () => upstream.destroy());
  browser.on("close", () => upstream.destroy());
  upstream.setTimeout(12000, () => upstream.destroy());
  upstream.on("error", () => browser.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"));
  upstream.on("response", (response) => {
    response.resume();
    browser.end(`HTTP/1.1 ${response.statusCode} Upstream Rejected\r\nConnection: close\r\n\r\n`);
  });
  upstream.on("upgrade", (response, remote, remainder) => {
    remote.setTimeout(0);
    browser.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${response.headers["sec-websocket-accept"]}\r\n\r\n`);
    if (remainder.length) browser.write(remainder);
    if (head.length) remote.write(head);
    browser.on("close", () => remote.destroy());
    remote.on("error", () => browser.destroy());
    remote.on("close", () => browser.destroy());
    browser.pipe(remote).pipe(browser);
  });
  upstream.end();
});

server.listen(port, webOrigin ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(webOrigin ? `Deckeditor bridge · port ${port} · ${origin}` : `Deckeditor workbench · ${localOrigin}`);
});
