import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  url && key && !url.includes("YOUR_") && !key.includes("YOUR_"),
);
let client;
export async function connect() {
  if (!configured)
    throw Error(
      "Add your Supabase settings to .env.local to connect a live room.",
    );
  client ??= createClient(url, key);
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    const result = await client.auth.signInAnonymously();
    if (result.error) throw result.error;
  }
  return client;
}
export async function rpc(name, args) {
  const c = await connect();
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
