// Serve the built renderer (dist/mainview) so it can be opened in a browser
// for visual verification. The renderer connects to the running main-process
// server at 127.0.0.1:19030 (its default) to load real subtitle data.
const PORT = 18080;
const ROOT = import.meta.dir + "/../dist/mainview";

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const f = Bun.file(`${ROOT}${rel}`);
    if (await f.exists()) {
      const type = rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".css") ? "text/css" : "text/html";
      return new Response(f, { headers: { "Content-Type": type, "Access-Control-Allow-Origin": "*" } });
    }
    return new Response("nf", { status: 404 });
  },
});

console.log(`renderer up on http://127.0.0.1:${server.port}`);
