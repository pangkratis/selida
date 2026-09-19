// Deletes the CALLING user's own account — required for App Store / Play
// Store compliance (apps with account creation must let users delete
// their account and data from within the app).
//
// Deleting the auth.users row cascades automatically through:
//   auth.users -> public.users -> readingList / readingSessions / userActivity
// (all verified as ON DELETE CASCADE), so no manual per-table cleanup is
// needed here — deleting the auth user is enough.
//
// The caller's identity is verified server-side from their own JWT — this
// endpoint NEVER trusts a client-supplied user id, so a user can only ever
// delete themselves, never someone else's account.
//
// Actually deleting an auth user requires the service_role key, which is
// why this can't be done directly from the client. SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are auto-injected into
// every Edge Function's environment — no manual `supabase secrets set`
// needed for this one, unlike biblionet-proxy.

import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Verify the caller's identity from their own JWT.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401 });
  }

  // Deleting an auth user is an admin-only operation.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[delete-account] Failed to delete user', user.id, deleteError);
    return new Response(JSON.stringify({ error: 'Failed to delete account' }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
