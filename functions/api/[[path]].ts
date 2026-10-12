// Forwards /api/* to the Worker over a service binding (see wrangler.toml).
//
// This used to fetch() the Worker's public workers.dev hostname. A subrequest
// from a Pages Function to another Cloudflare hostname arrives with
// CF-Connecting-IP set to the Workers egress address (2a06:98c0:3600::103),
// so every user shared one IP: the IP-keyed limiters on login, MFA verify and
// passkey login became global buckets that ten requests could exhaust for
// everyone, and session/audit records lost the real client address. It also
// required the Worker to stay publicly reachable on workers.dev.
//
// A service binding delivers the request as-is, so CF-Connecting-IP is the
// value the edge set for the real client when it reached this Function.
interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  return env.API.fetch(request);
};
