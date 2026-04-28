import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!TELEGRAM_API_KEY) {
    return new Response(JSON.stringify({ error: 'TELEGRAM_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');

    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      console.error('Auth error:', claimsErr?.message || 'No claims');
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = claimsData.claims.sub as string;
    const userEmail = (claimsData.claims.email as string) || '';

    const body = await req.json();
    const { session_id, content, telegram_chat_id, as_agent, attachment_url, attachment_type } = body;

    if (!session_id || !content) {
      return new Response(JSON.stringify({ error: 'session_id and content required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Server-side role verification: only admins or active CS agents can send as agent
    let isAuthorizedAgent = false;
    if (as_agent) {
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('role', 'admin')
        .limit(1);

      if (!roleRows || roleRows.length === 0) {
        const { data: csAgents } = await supabase
          .from('cs_agents')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(1);

        isAuthorizedAgent = !!(csAgents && csAgents.length > 0);
      } else {
        isAuthorizedAgent = true;
      }

      if (!isAuthorizedAgent) {
        console.warn(`User ${userId} attempted as_agent=true without proper role`);
      }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', userId)
      .single();

    const senderName = profile?.display_name || userEmail.split('@')[0] || 'User';
    const senderType = isAuthorizedAgent ? 'agent' : 'customer';

    // Save message to DB with attachment info
    const insertData: Record<string, unknown> = {
      session_id,
      sender_type: senderType,
      sender_name: senderName,
      content,
    };
    if (attachment_url) insertData.attachment_url = attachment_url;
    if (attachment_type) insertData.attachment_type = attachment_type;

    const { error: insertErr } = await supabase
      .from('customer_chat_messages')
      .insert(insertData);

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return new Response(JSON.stringify({ error: 'Failed to save message' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only forward customer messages to Telegram
    if (!isAuthorizedAgent) {
      let chatId = telegram_chat_id;
      if (!chatId) {
        const { data: session } = await supabase
          .from('customer_chat_sessions')
          .select('telegram_chat_id')
          .eq('id', session_id)
          .single();
        chatId = session?.telegram_chat_id;
      }

      if (chatId) {
        // If there's an image attachment, send it as a photo
        if (attachment_url && attachment_type === 'image') {
          const tgCaption = `💬 <b>${senderName}</b>`;
          const photoResp = await fetch(`${GATEWAY_URL}/sendPhoto`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': TELEGRAM_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: chatId,
              photo: attachment_url,
              caption: tgCaption,
              parse_mode: 'HTML',
            }),
          });
          if (!photoResp.ok) {
            console.error('Telegram sendPhoto error:', await photoResp.text());
          }
        } else if (attachment_url && attachment_type === 'file') {
          // Send as document
          const tgCaption = `💬 <b>${senderName}</b>`;
          const docResp = await fetch(`${GATEWAY_URL}/sendDocument`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': TELEGRAM_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: chatId,
              document: attachment_url,
              caption: tgCaption,
              parse_mode: 'HTML',
            }),
          });
          if (!docResp.ok) {
            console.error('Telegram sendDocument error:', await docResp.text());
          }
        }

        // Always send the text message too (unless it's just the auto label)
        if (!content.startsWith('[圖片]') && !content.startsWith('[檔案]')) {
          const telegramText = `💬 <b>${senderName}</b>:\n${content}`;
          const tgResponse = await fetch(`${GATEWAY_URL}/sendMessage`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': TELEGRAM_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chat_id: chatId,
              text: telegramText,
              parse_mode: 'HTML',
            }),
          });
          if (!tgResponse.ok) {
            console.error('Telegram send error:', await tgResponse.text());
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
