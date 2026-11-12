import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  url && key && !url.includes("YOUR_") && !key.includes("YOUR_"),
);
const clients = new Map();
const authenticating = new Map();
export async function connect(identity = "default") {
  if (!configured)
    throw Error(
      "Add your Supabase settings to .env.local to connect a live room.",
    );
  const scope = identity === "v3-guest" ? "v3-guest" : "default";
  if (!clients.has(scope)) {
    // Keep the existing host/V1/V2 session; V3 guests get an independent identity.
    const options = scope === "v3-guest"
      ? { auth: { storageKey: `sb-${new URL(url).hostname.split('.')[0]}-plouf-v3-guest`, detectSessionInUrl: false } }
      : undefined;
    clients.set(scope, createClient(url, key, options));
  }
  const client = clients.get(scope);
  if (!authenticating.has(scope)) {
    authenticating.set(scope, (async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        const result = await client.auth.signInAnonymously();
        if (result.error) throw result.error;
      }
    })().finally(() => authenticating.delete(scope)));
  }
  await authenticating.get(scope);
  return client;
}

export async function rpc(name, args, identity = "default") {
  const c = await connect(identity);
  const start = Date.now();
  const { data, error } = await c.rpc(name, args);
  if (error) throw Error(error.message);
  return {
    data,
    offset: data?.server_time
      ? new Date(data.server_time).getTime() - (start + Date.now()) / 2
      : 0,
  };
}
