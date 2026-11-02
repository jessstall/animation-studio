# Animation Studio — notes for Claude

Owner: Jess (Will and the Way). Very particular about typography and the look of things.

- Static site in `public/` (no build step), served by a Cloudflare Worker (`wrangler.jsonc`, `src/worker.js`) that also handles `/api/suggest`. Pushing to main deploys (`npx wrangler deploy`). Plain ES modules, no framework.
- Rendering is deterministic: `renderFrame(ctx, project, t, {scale})` draws any time `t`; export renders every frame through it. Keep it that way so preview = export.
- Units in project pixels (1080 wide portrait by default). Canvas `shadowBlur`/`filter` blur are not affected by transforms, so they are multiplied by the render scale manually.
- Default text drop shadow: soft and centred, subtle (black, 0.4, blur 30, no offset). Keep this default.
- Timeline = intro + mid + outro. Intro animations should finish inside the intro; the mid section may be trimmed by the video editor, so "Still" is the safe mid default.
- WebM export uses VP8 with alpha (`libvpx`), because VP9 crashes ffmpeg.wasm. MOV uses ProRes 4444 (`prores_ks`).
- ffmpeg core loads from jsDelivr by direct URL (blob URLs broke the ESM core). `?ffcore=<url>` overrides the base for testing.
- When a new Will and the Way course symbol is made, add it to `public/symbols/` and `public/symbols/manifest.json`.
- Studio Pocket (her business partner's phone video editor, https://studiotheprize.netlify.app/) is where these animations get used; a shared library between the two apps is planned.
