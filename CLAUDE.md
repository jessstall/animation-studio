# Animation Studio — notes for Claude

Owner: Jess (Will and the Way). Very particular about typography and the look of things.

- Static site in `public/` (no build step), served by a Cloudflare Worker (`wrangler.jsonc`, `src/worker.js`) that also handles `/api/suggest`. Pushing to main deploys (`npx wrangler deploy`). Plain ES modules, no framework.
- Rendering is deterministic: `renderFrame(ctx, project, t, {scale})` draws any time `t`; export renders every frame through it. Keep it that way so preview = export.
- Units in project pixels (1080 wide portrait by default). Canvas `shadowBlur`/`filter` blur are not affected by transforms, so they are multiplied by the render scale manually.
- Default text drop shadow: soft and centred, subtle (black, 0.4, blur 30, no offset). Keep this default.
- Timeline = intro + mid + outro. Intro animations should finish inside the intro; the mid section may be trimmed by the video editor, so "Still" is the safe mid default.
- WebM export uses VP8 with alpha (`libvpx`), because VP9 crashes ffmpeg.wasm. MOV uses ProRes 4444 (`prores_ks`).
- ffmpeg core loads from jsDelivr by direct URL (blob URLs broke the ESM core). `?ffcore=<url>` overrides the base for testing.
- Will and the Way symbols live in `public/symbols/gold|white|black/` (gold #B8892A, white, black #111111), listed in `public/symbols/manifest.json` with a `colour`. When a new course symbol is made, add all three colours and the manifest entries. (Files in the `public/symbols/` root are kept only so older saved animations still load.)
- Studio Pocket (her business partner's phone video editor, https://studiotheprize.netlify.app/) is where these animations get used; a shared library between the two apps is planned.
- Phone layout (≤760px): the preview + play bar + tabs (`.viewer`) stick to the top; Layers / Symbols / Edit / Timing tabs below (`body[data-m]`). Inputs are 16px there so iPhone doesn't zoom.
- Safari has no canvas `filter`, so `withBlur()` in render.js falls back to a scaled-down/up blur. Add `?safariblur` to the URL to test that fallback in Chrome.
- Custom effects (layer type `code`): Claude writes the body of `function (ctx, t, lib)` via `/api/create` (`src/create.js`, streams plain text with `<meta>` and `<code>` blocks; model `claude-opus-5-5`, override with `ANTHROPIC_CODE_MODEL`). The toolkit is `public/js/codelib.js` (text, symbols, shapes incl. heart, glow, rays, burst, shatter, points/morph/disperse, sparkles, gold text). Effects must be pure functions of `t`. The studio test-runs new code and asks Claude to fix it once if it errors. Refining = select the effect layer, "Selected layer", describe the change.
