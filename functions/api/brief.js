/**
 * Cloudflare Pages Function: Fetches brief.md from R2 and parses it via Claude API.
 * Returns structured JSON for the Slate News frontend component.
 *
 * Query:
 *   ?date=YYYY-MM-DD  (defaults to today UTC)
 *
 * Env (Pages project settings):
 *   ANTHROPIC_API_KEY   // Anthropic API key
 *   DATA_BASE_URL       // optional R2 base URL (defaults to public CDN)
 */

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are a data-extraction assistant for an NBA daily fantasy sports analytics platform. Your sole job is to parse a pre-slate brief written in markdown and return a single valid JSON object — no commentary, no markdown fences, no extra keys. Follow the output schema exactly.

Output schema (return exactly this structure):
{
  "slate_date": "YYYY-MM-DD extracted from H1 heading",
  "generated_at": "ISO-8601 timestamp or null if unavailable",
  "last_updated_at": "time string from most recent update heading, or null",
  "update_count": <integer count of update blocks>,
  "sections": [
    {
      "id": "<category id>",
      "label": "<category label>",
      "icon": "<emoji>",
      "content": "<verbatim markdown text of this section>",
      "summary": "<1-2 sentence plain-text summary, no markdown>",
      "order": <0-based integer>
    }
  ],
  "updates": [
    {
      "timestamp": "<time string from update heading e.g. 14:32 PST>",
      "category": "<category id>",
      "label": "<category label>",
      "icon": "<emoji>",
      "severity": "<high|medium|low|none>",
      "headline": "<single short headline max 12 words>",
      "content": "<verbatim markdown text of the update block>"
    }
  ],
  "player_mentions": [
    {
      "player_name": "<full or common name>",
      "team_abbr": "<team abbreviation or null>",
      "context": "<one sentence why this player is mentioned>",
      "section_id": "<category id where mentioned>",
      "in_update": <boolean>
    }
  ],
  "meta": {
    "section_count": <integer>,
    "update_count": <integer>,
    "player_mention_count": <integer>,
    "high_severity_count": <integer number of high-severity updates>,
    "has_updates": <boolean>
  }
}

Section classification — assign each initial-block sub-section to exactly one category by dominant keywords:
- injuries  (🩹 "Injury Report"):          out, questionable, doubtful, GTD, injury, inactive, ruled out, upgraded, cleared, DNP, health
- referees  (🦺 "Officials"):              referee, crew, foul, pace, officiating, FTA, rate, calls, whistles
- coaches   (📋 "Rotations"):              coach, rotation, bench, starter, minutes, substitution, depth, lineup, blowout
- totals    (📊 "Game Environment"):       total, over/under, O/U, pace, spread, line, odds, implied, points, Vegas
- exposure  (🎯 "Exposure Recommendations"): exposure, fade, target, leverage, stack, ownership, GPP, overweight, underweight, differentiator, boom, bust, HVM, salary, ceiling
  IMPORTANT: Parse the exposure section as a SINGLE UNIT — do not split into sub-sections. Preserve all five subsections (Increase Exposure, Reduce Exposure, Ownership Leverage, Injury / Late News, Game Stack) verbatim inside the content field.
- overview  (📰 "Overview"):               fallback — use when no other category matches

Update blocks begin after each "---" horizontal rule, headed by "### 🔄 Update — {time} PST".

Update severity rules:
- high:   contains "ruled out", "out tonight", "scratched", or "will not play"
- medium: contains "questionable", "GTD", "upgraded", or "downgraded"
- low:    contains "probable", "listed", "expected", or "trending"
- none:   everything else`;

export const onRequest = async ({ request, env }) => {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Fetch brief.md from R2
    const baseUrl = (env.DATA_BASE_URL || DEFAULT_DATA_BASE_URL).replace(/\/$/, '');
    const briefUrl = `${baseUrl}/${date}/brief.md`;

    const briefResp = await fetch(briefUrl, { cache: 'no-cache' });
    if (!briefResp.ok) {
      return new Response(
        JSON.stringify({ error: briefResp.status === 404 ? 'No brief for this date' : 'Brief unavailable', date }),
        { status: briefResp.status === 404 ? 404 : 502, headers: corsHeaders }
      );
    }

    const briefMd = await briefResp.text();
    if (!briefMd.trim()) {
      return new Response(JSON.stringify({ error: 'Brief is empty', date }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Call Claude API
    const claudeResp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Parse the following NBA DFS pre-slate brief and return JSON only.\n\n${briefMd}`,
          },
        ],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text().catch(() => '');
      console.error('Claude API error', claudeResp.status, errText.slice(0, 300));
      return new Response(JSON.stringify({ error: 'Parser service error' }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const claudeData = await claudeResp.json();
    const rawText = claudeData?.content?.[0]?.text ?? '';

    // Strip accidental markdown fences
    const clean = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON parse error', e?.message, rawText.slice(0, 400));
      return new Response(
        JSON.stringify({ error: 'Parser returned invalid JSON', preview: rawText.slice(0, 200) }),
        { status: 500, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error('Brief API error', err?.message);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
};
