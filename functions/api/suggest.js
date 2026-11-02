// Cloudflare Pages Function: turns a plain-language description into animation settings using Claude.
// Needs the ANTHROPIC_API_KEY secret set in the Cloudflare Pages project settings.

const SYSTEM = `You are the motion designer inside "Animation Studio", a tool for elegant animated text and symbol titles that sit over social media videos (transparent background). The user describes the feel they want; you return animation settings as JSON only.

Timeline: the animation has three sections: intro (things animate in), mid (a hold, which the video editor may trim to any length), outro (things animate out). Times are in seconds.

Each layer has anim = { in, mid, out }.
in / out = { preset, start, duration, stagger, by, dir, ease, from?, to? }
- start: seconds after the start of the section (intro for "in", outro for "out")
- duration: seconds each unit takes
- stagger: seconds between units starting
- by: "all" | "line" | "word" | "letter" (what moves as one unit; images and lights are always "all")
- dir: "forward" | "reverse" | "center" | "edges" | "random" (stagger order)
- ease: "" (preset default) or one of outCubic, outQuart, outExpo, inOutSine, inOutCubic, inOutExpo, outBack, outElastic, outBounce, linear, inCubic, inQuart, inExpo, inBack
Presets (in name / out name):
none; fade (Fade in / Fade out); rise (Rise / Lift away); fall (Fall in / Sink away); fromLeft; fromRight; focus (soft blur focus); grow (Grow / Shrink); settle (from larger + blur); wipe (soft left-to-right wipe); wipeUp (reveal upward); radial (circular reveal from centre, lovely for symbols); gather (letters gather together / spread); typewriter; pop; bounce (drop & bounce); flip; cascade (letter cascade); wave; spin; sweep; scatter (gather from / scatter to random positions); smoke (out of / into smoke); wind (blown in / blown away); particles (assemble from / dissolve into particles); birds (birds gather into the text / the text turns into birds that fly away — use for outro); custom.
For preset "custom", give "from" (in: the hidden starting state) or "to" (out: the end state) with any of: o (opacity 0-1), x, y (px offset; 1080px wide frame), s (scale), sx, sy, r (degrees), b (blur px), sk (skew degrees), spread (letters spread from centre, 0-1).
mid = { preset, amount, period, color } with preset: none (still — cleanest when the editor trims the mid section), pulse (gentle scale + glow), breathe, float, sway, wave (letter wave), glow, shimmer (light sweep), flicker (candle), rotate (slow turn, period = seconds per turn). amount 0.2–2 (1 = default subtlety), period seconds per cycle (0 = default), color hex for glow/pulse/shimmer.

Layers may also have lights behind them: lights = { orb: {on, color, intensity 0-1.5, size (radius px), core 0-1}, rays: {on, color, intensity 0-1.5, count, spread (degrees, 360 = full burst, smaller = fan), direction (degrees, 0 = up), length px, width 0.05-1, softness px, turn (degrees per second)} }. Only include lights if the description asks for light, glow, rays, sun, divine, radiance or similar.

Style: refined, calm, premium, never cheesy. Durations usually 0.6–1.6 s per unit; letter staggers 0.02–0.06 s; word staggers 0.06–0.14 s. Keep everything inside its section: the intro must finish within the intro length. Suggest section lengths if helpful.

Reply with ONLY a JSON object, no prose outside it:
{"sections": {"intro": n, "mid": n, "outro": n} (optional), "layers": [{"id": "<layer id>", "anim": {...}, "lights": {...optional}, "lines": [{"delayIn": n, "delayOut": n}] (optional, per text line, to bring lines in at different times)}], "note": "one short sentence describing what you made"}
Only include layers you are changing. Partial objects are merged into the existing settings.`;

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'The Suggest feature needs an Anthropic API key. Add ANTHROPIC_API_KEY in the Cloudflare Pages settings (Settings → Variables and Secrets).' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const user = `Description: ${body.prompt}\n\nApply to: ${body.target === 'all' ? 'all layers' : 'the selected layer only (id ' + body.selectedId + ')'}\n\nCurrent project:\n${JSON.stringify(body.project).slice(0, 12000)}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) return json({ error: 'Claude could not be reached (' + r.status + '): ' + (await r.text()).slice(0, 300) }, 502);
  const data = await r.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return json({ error: 'No suggestion came back. Try describing it differently.' }, 502);
  try { return json(JSON.parse(m[0])); } catch { return json({ error: 'The suggestion was not readable. Try again.' }, 502); }
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
