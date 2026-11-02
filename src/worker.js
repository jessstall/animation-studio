// Cloudflare Worker: serves the studio from /public and answers /api/suggest.
import { suggest } from './suggest.js';
import { create } from './create.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/suggest') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return suggest(request, env);
    }
    if (url.pathname === '/api/create') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      return create(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
