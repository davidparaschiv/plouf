// A small deployable function; game operations execute as transactional database RPCs.
Deno.serve((request: Request) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers });
  return Response.json({ app: "Plouf", status: "ok" }, { headers });
});
