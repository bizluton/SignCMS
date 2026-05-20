import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;
const ATTACHMENT_BUCKET = 'chat-attachments';

function telegramApi(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

function telegramFileUrl(botToken: string, filePath: string): string {
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
}

Deno.serve(async () => {
  const startTime = Date.now();

  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const uploadTelegramFile = async (fileId: string, kind: 'image' | 'file') => {
    const fileResponse = await fetch(telegramApi(TELEGRAM_BOT_TOKEN, 'getFile'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });

    const fileData = await fileResponse.json();
    if (!fileResponse.ok || !fileData?.result?.file_path) {
      throw new Error(`getFile failed: ${JSON.stringify(fileData)}`);
    }

    const filePath = fileData.result.file_path as string;
    const downloadResponse = await fetch(telegramFileUrl(TELEGRAM_BOT_TOKEN, filePath));

    if (!downloadResponse.ok) {
      throw new Error(`File download failed [${downloadResponse.status}]`);
    }

    const fileBytes = await downloadResponse.arrayBuffer();
    const pathParts = filePath.split('/');
    const originalName = pathParts[pathParts.length - 1] || `${fileId}.${kind === 'image' ? 'jpg' : 'bin'}`;
    const storagePath = `telegram/${Date.now()}-${originalName}`;
    const contentType = downloadResponse.headers.get('content-type') || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream');

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, fileBytes, { contentType, upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  };

  let totalProcessed = 0;

  // Single-runner gate: refuse to start if another invocation is already
  // pulling updates. The RPC's 5-minute stale window auto-reclaims locks
  // left behind by a crashed prior run.
  const { data: claimed } = await supabase.rpc('claim_telegram_poll_run');
  if (claimed !== true) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'another_invocation_running' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { data: state, error: stateErr } = await supabase
    .from('telegram_bot_state')
    .select('update_offset')
    .eq('id', 1)
    .single();

  if (stateErr) {
    await supabase.rpc('release_telegram_poll_run').catch(() => {});
    return new Response(JSON.stringify({ error: stateErr.message }), { status: 500 });
  }

  let currentOffset = state.update_offset;

  while (true) {
    const elapsed = Date.now() - startTime;
    const remainingMs = MAX_RUNTIME_MS - elapsed;
    if (remainingMs < MIN_REMAINING_MS) break;

    const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 5);
    if (timeout < 1) break;

    const response = await fetch(telegramApi(TELEGRAM_BOT_TOKEN, 'getUpdates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: currentOffset,
        timeout,
        allowed_updates: ['message'],
      }),
    });

    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('Non-JSON response from Telegram:', responseText.substring(0, 200));
      continue;
    }
    if (!response.ok) {
      console.error('Telegram API error:', response.status, responseText.substring(0, 200));
      continue;
    }

    const updates = data.result ?? [];
    if (updates.length === 0) continue;

    for (const update of updates) {
      const msg = update.message;
      if (!msg) continue;

      const chatId = msg.chat?.id;
      if (!chatId) continue;

      const senderName = msg.from?.first_name || msg.from?.username || 'Agent';
      const text = msg.text || msg.caption || '';
      let attachmentUrl: string | null = null;
      let attachmentType: 'image' | 'file' | null = null;

      try {
        if (Array.isArray(msg.photo) && msg.photo.length > 0) {
          const photo = msg.photo[msg.photo.length - 1];
          attachmentUrl = await uploadTelegramFile(photo.file_id, 'image');
          attachmentType = 'image';
        } else if (msg.document?.file_id) {
          attachmentUrl = await uploadTelegramFile(msg.document.file_id, 'file');
          attachmentType = 'file';
        }
      } catch (error) {
        console.error('Failed to process Telegram attachment:', error);
      }

      if (!text && !attachmentUrl) continue;

      const { data: sessions } = await supabase
        .from('customer_chat_sessions')
        .select('id')
        .eq('telegram_chat_id', chatId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (sessions && sessions.length > 0) {
        const payload: Record<string, unknown> = {
          session_id: sessions[0].id,
          sender_type: 'agent',
          sender_name: senderName,
          content: text || (attachmentType === 'image' ? '[圖片]' : '[檔案]'),
        };

        if (attachmentUrl) payload.attachment_url = attachmentUrl;
        if (attachmentType) payload.attachment_type = attachmentType;

        await supabase.from('customer_chat_messages').insert(payload);
        totalProcessed++;
      }
    }

    const newOffset = Math.max(...updates.map((u: any) => u.update_id)) + 1;
    await supabase
      .from('telegram_bot_state')
      .update({ update_offset: newOffset, updated_at: new Date().toISOString() })
      .eq('id', 1);

    currentOffset = newOffset;
  }

  await supabase.rpc('release_telegram_poll_run').catch(() => {});
  return new Response(JSON.stringify({ ok: true, processed: totalProcessed, finalOffset: currentOffset }));
});
