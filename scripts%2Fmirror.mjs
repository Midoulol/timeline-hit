// Local mirror for the Electrobun/Hutch release + toolchain. Serves files from
// .mirror/ and logs every requested path. Used to discover the exact artifact
// URLs Hutch needs, then serve them locally so Hutch never touches GitHub.
import { file, write } from "bun";

const ROOT = import.meta.dir + "/../.mirror";
const PORT = 19100;
const LOG = import.meta.dir + "/../.mirror/requests.log";

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\//, "");
    await write(LOG, `${new Date().toISOString()} ${req.method} ${url.pathname}\n`, { append: true });
    const f = file(`${ROOT}/${rel}`);
    if (await f.exists()) {
      return new Response(f);
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`mirror up on http://127.0.0.1:${server.port}`);
