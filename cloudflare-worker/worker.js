/**
 * SignCMS API Proxy — Cloudflare Worker
 *
 * Proxies all requests to the Supabase project while presenting
 * a clean custom URL (e.g. https://signcms-api.<you>.workers.dev).
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler deploy
 */

const SUPABASE_HOST = 'narhbpojjtnalyfiwxue.supabase.co';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = SUPABASE_HOST;
    url.protocol = 'https:';

    const proxied = new Request(url.toString(), {
      method:  request.method,
      headers: request.headers,
      body:    request.method !== 'GET' && request.method !== 'HEAD'
                 ? request.body
                 : undefined,
      redirect: 'follow',
    });

    return fetch(proxied);
  },
};
