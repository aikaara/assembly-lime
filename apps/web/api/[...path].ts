const BACKEND = "https://assembly-line-ukroi.ondigitalocean.app";

export default async function handler(req: Request) {
  const url = new URL(req.url);
  // Strip the /api prefix to get the backend path
  const backendPath = url.pathname.replace(/^\/api/, "") + url.search;
  const target = `${BACKEND}${backendPath}`;

  const headers = new Headers(req.headers);
  // Remove host/origin headers that would confuse the backend
  headers.delete("host");

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  // Forward body for non-GET/HEAD requests
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    // @ts-expect-error — needed for streaming body passthrough
    init.duplex = "half";
  }

  const resp = await fetch(target, init);

  // Forward response back to client
  const respHeaders = new Headers(resp.headers);
  // Remove headers that Vercel will set itself
  respHeaders.delete("content-encoding");
  respHeaders.delete("transfer-encoding");

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders,
  });
}

export const config = {
  runtime: "edge",
};
