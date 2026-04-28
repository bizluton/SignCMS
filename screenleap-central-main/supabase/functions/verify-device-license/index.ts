import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ valid: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ valid: false, error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const device_model = String(body?.device_model ?? "").trim();
  const device_serial = String(body?.device_serial ?? "").trim();
  const code = String(body?.code ?? "").trim();

  if (!device_model || !device_serial || !/^[0-9]{6}$/.test(code)) {
    return new Response(
      JSON.stringify({ valid: false, error: "invalid_arguments" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.rpc("verify_device_license", {
    _device_model: device_model,
    _device_serial: device_serial,
    _code: code,
  });

  if (error) {
    return new Response(JSON.stringify({ valid: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result = data as Record<string, unknown>;
  const valid = !!result?.valid;
  return new Response(JSON.stringify(result), {
    status: valid ? 200 : 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
