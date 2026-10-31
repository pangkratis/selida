// Book tag enrichment — picks mood, themes, setting, reading experience … for each synced book
// from the fixed vocabulary in `tags` (see sql/migration_32_book_tags.sql).
//
// Called by pg_cron every 30 minutes, never by the app. Each call does one of:
//   - a batch is open      → ask Anthropic if it has ended; if so, save the answers
//   - no batch, none today → submit the next books (synced, not yet enriched) as a
//                            Message Batch (half price, results within hours)
// Validation (unknown slugs, per-facet limits, fiction-only facets) happens in
// fn_enrich_save, so a bad answer can never write a tag outside the list.
//
// Auth: a shared secret in the `x-cron-secret` header (deployed with
// --no-verify-jwt, so this check is the only gate).
//
// Secrets: ANTHROPIC_API_KEY, ENRICH_CRON_SECRET. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Test run:  curl -X POST <url> -H "x-cron-secret: ..." -d '{"wait":true}'

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://api.anthropic.com/v1/messages/batches';
const API_HEADERS = (key: string) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
});
const MAX_DESCRIPTION_CHARS = 3000;
const SAVE_CHUNK = 100;

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Facet = { slug: string; label_en: string; max_picks: number; fiction_only: boolean; hint: string | null };
type Tag = { facet: string; slug: string; label_en: string; hint: string | null };
type QueuedBook = {
  id: string;
  title: string;
  authors: string[] | null;
  description: string;
  subcategories: string[] | null;
  genres: string[] | null;
  pageCount: number | null;
};

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildSystemPrompt(facets: Facet[], tags: Tag[]): string {
  const lines: string[] = [
    'You classify books for a Greek book app. For each book you get its title, author, page count,',
    'genres, Biblionet subject headings (Greek) and description (usually Greek). Pick tags ONLY from',
    'the list below, by slug.',
    '',
    'Rules:',
    '- Evidence order: subject headings decide setting and period; the description decides mood,',
    '  themes and reading experience; genres are background only — do not tag a mood just',
    '  because of the genre (a crime novel is not automatically "tense").',
    '- If you clearly know this exact work (title + author), you may use that knowledge. Never guess',
    '  from the title alone.',
    '- Leaving a facet empty is correct when the evidence does not support it. Do not fill facets',
    '  to be complete.',
    '- Within each facet list tags strongest first, up to the facet maximum.',
    '- strength "clear" = stated or unmistakable; "implied" = a reasonable reading.',
    '- Facets marked fiction-only stay empty for non-fiction.',
    '- setting-period is when the story takes place, not when the book was published.',
    '- fiction: true for novels, stories, poetry, drama, children\'s fiction. true_story: the book',
    '  tells the story of a real life or real events as a narrative — memoirs, biographies,',
    '  testimonies, novels based on a true story. NOT for history books, essays, studies or',
    '  textbooks, even though their subject is real.',
    '- evidence: "rich" if the description says enough about the book (or you know the work),',
    '  "thin" if it is a one-liner, a list of contents or pure marketing.',
    '',
    'Vocabulary (facet — max picks):',
  ];
  for (const f of facets) {
    if (f.slug === 'flag') continue;
    lines.push('');
    lines.push(`${f.slug} — max ${f.max_picks}${f.fiction_only ? ', fiction-only' : ''}${f.hint ? ` — ${f.hint}` : ''}`);
    for (const t of tags.filter(t => t.facet === f.slug)) {
      lines.push(`  ${t.slug}${t.hint ? ` (${t.hint})` : ''}`);
    }
  }

  return lines.join('\n');
}

// Tags as objects with an enum of the slugs. A compact ["dark", "tense?"] list was
// tried (2026-10-31): ~20% cheaper, but the model picked fewer tags (4.5 vs 6.6 per
// book), almost stopped marking "implied", and invented slugs. Not worth it.
function buildTool(tags: Tag[]) {
  return {
    name: 'record_tags',
    description: 'Record the tags chosen for this book.',
    input_schema: {
      type: 'object',
      properties: {
        fiction: { type: 'boolean' },
        true_story: { type: 'boolean' },
        evidence: { type: 'string', enum: ['rich', 'thin'] },
        tags: {
          type: 'array',
          description: 'Chosen tags, grouped by facet, strongest first within each facet.',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', enum: tags.filter(t => t.facet !== 'flag').map(t => t.slug) },
              strength: { type: 'string', enum: ['clear', 'implied'] },
            },
            required: ['slug', 'strength'],
          },
        },
      },
      required: ['fiction', 'true_story', 'evidence', 'tags'],
    },
  };
}

function bookMessage(b: QueuedBook): string {
  const description = b.description.length > MAX_DESCRIPTION_CHARS
    ? `${b.description.slice(0, MAX_DESCRIPTION_CHARS)}…`
    : b.description;
  return [
    `Title: ${b.title}`,
    `Author: ${(b.authors ?? []).join(', ') || 'unknown'}`,
    `Pages: ${b.pageCount ?? 'unknown'}`,
    `Genres: ${(b.genres ?? []).join(', ') || 'none'}`,
    `Subject headings: ${(b.subcategories ?? []).join('; ') || 'none'}`,
    '',
    'Description:',
    description,
  ].join('\n');
}

// ── Steps ───────────────────────────────────────────────────────────────────
async function submit(admin: SupabaseClient, key: string, state: any): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  // The first call of the day can hit the 8 s API timeout on a cold cache; the
  // retry runs warm (~0.2 s).
  let { data: books, error } = await admin.rpc('fn_enrich_next_batch', { p_limit: state.daily_limit });
  if (error?.code === '57014') {
    ({ data: books, error } = await admin.rpc('fn_enrich_next_batch', { p_limit: state.daily_limit }));
  }
  if (error) throw error;
  const queue = (books ?? []) as QueuedBook[];
  if (queue.length === 0) {
    await admin.from('enrich_state').update({ last_submit_day: today }).eq('id', 1);
    return 'nothing to enrich';
  }

  const [{ data: facets, error: fe }, { data: tags, error: te }] = await Promise.all([
    admin.from('tag_facets').select('slug,label_en,max_picks,fiction_only,hint').order('sort'),
    admin.from('tags').select('facet,slug,label_en,hint').eq('active', true).order('sort'),
  ]);
  if (fe) throw fe;
  if (te) throw te;

  const system = [{ type: 'text', text: buildSystemPrompt(facets as Facet[], tags as Tag[]) }];
  // No prompt caching: tried with worked examples (2026-10-31) and batch requests
  // all wrote the cache in parallel instead of reading it — 4x the cost.
  const requests = queue.map(b => ({
    custom_id: b.id,
    params: {
      model: state.model,
      max_tokens: 600,
      system,
      tools: [buildTool(tags as Tag[])],
      tool_choice: { type: 'tool', name: 'record_tags' },
      messages: [{ role: 'user', content: bookMessage(b) }],
    },
  }));

  const res = await fetch(API, { method: 'POST', headers: API_HEADERS(key), body: JSON.stringify({ requests }) });
  const body = await res.json();
  if (!res.ok) {
    // Out of credits: try again tomorrow instead of every 30 minutes. Other errors
    // (overloaded, network) retry on the next cron run.
    if (/credit balance/i.test(JSON.stringify(body))) {
      await admin.from('enrich_state').update({ last_submit_day: today }).eq('id', 1);
      throw new Error(`out of Anthropic credits, retrying tomorrow: ${JSON.stringify(body).slice(0, 200)}`);
    }
    throw new Error(`batch submit failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }

  const { error: pe } = await admin.rpc('fn_enrich_mark_pending', { p_book_ids: queue.map(b => b.id) });
  if (pe) throw pe;
  await admin.from('enrich_state')
    .update({ open_batch_id: body.id, open_batch_at: new Date().toISOString(), last_submit_day: today })
    .eq('id', 1);
  return `submitted ${queue.length} books as ${body.id}`;
}

async function collect(admin: SupabaseClient, key: string, state: any): Promise<string> {
  const res = await fetch(`${API}/${state.open_batch_id}`, { headers: API_HEADERS(key) });
  const batch = await res.json();
  if (!res.ok) throw new Error(`batch status failed: HTTP ${res.status} ${JSON.stringify(batch).slice(0, 300)}`);
  if (batch.processing_status !== 'ended') {
    return `batch ${state.open_batch_id} still ${batch.processing_status}`;
  }

  const out = await fetch(batch.results_url, { headers: API_HEADERS(key) });
  if (!out.ok) throw new Error(`batch results failed: HTTP ${out.status}`);
  const lines = (await out.text()).split('\n').filter(Boolean);

  const items: unknown[] = [];
  let failed = 0;
  // Token totals for the batch, so the cost shows up in enrich_state.last_result.
  // Per-book usage is kept in book_enrichment.raw.
  const tokens = { input: 0, output: 0 };
  for (const line of lines) {
    const row = JSON.parse(line);
    const usage = row.result?.message?.usage;
    if (usage) {
      tokens.input += usage.input_tokens ?? 0;
      tokens.output += usage.output_tokens ?? 0;
    }
    const input = row.result?.type === 'succeeded'
      ? row.result.message?.content?.find((c: any) => c.type === 'tool_use')?.input
      : null;
    if (input) {
      items.push({ book_id: row.custom_id, ...input, usage });
    } else {
      failed++;
      const why = row.result?.type === 'errored'
        ? `errored: ${JSON.stringify(row.result.error).slice(0, 300)}`
        : `result ${row.result?.type ?? 'missing'}`;
      await admin.rpc('fn_enrich_fail', { p_book_id: row.custom_id, p_error: why });
    }
  }

  let saved = 0;
  for (let i = 0; i < items.length; i += SAVE_CHUNK) {
    const { data, error } = await admin.rpc('fn_enrich_save', {
      p_items: items.slice(i, i + SAVE_CHUNK),
      p_model: state.model,
    });
    if (error) throw error;
    saved += data ?? 0;
  }

  await admin.from('enrich_state').update({ open_batch_id: null, open_batch_at: null }).eq('id', 1);
  return `batch ${state.open_batch_id}: saved ${saved}, failed ${failed};` +
    ` tokens in ${tokens.input} out ${tokens.output}`;
}

async function run(): Promise<string> {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return 'ANTHROPIC_API_KEY not set';

  const { data: state, error } = await admin.from('enrich_state').select('*').eq('id', 1).single();
  if (error) throw error;
  if (!state.enabled) return 'disabled';

  let note: string;
  try {
    note = state.open_batch_id ? await collect(admin, key, state) : await submit(admin, key, state);
  } catch (e) {
    // Supabase errors are plain objects ({ code, message, … }), not Error instances.
    note = `error: ${e instanceof Error ? e.message : JSON.stringify(e)}`;
    console.error('[enrich-books]', e);
  }
  await admin.from('enrich_state')
    .update({ last_run_at: new Date().toISOString(), last_result: note.slice(0, 300) })
    .eq('id', 1);
  return note;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const secret = Deno.env.get('ENRICH_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { wait?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  const job = run().catch(e => {
    console.error('[enrich-books] run failed', e);
    return 'run failed';
  });

  // Cron calls get an immediate 202 and the work continues in the background.
  if (!body.wait && typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(job);
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  }
  return new Response(JSON.stringify({ result: await job }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
