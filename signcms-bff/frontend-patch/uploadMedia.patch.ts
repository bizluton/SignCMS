/**
 * frontend-patch/uploadMedia.patch.ts
 *
 * 這是「前端需要修改的地方」的說明文件，不是 BFF 程式碼。
 *
 * 原檔：screenleap-central-main/src/lib/uploadMedia.ts
 *
 * 修改方式：只需更改 API 呼叫目標，其餘 UI 邏輯完全不動。
 *
 * ─────────────────────────────────────────────────────────────
 *
 * STEP 1: 在 .env 加入
 *   VITE_BFF_URL=http://localhost:3001
 *   (Production: VITE_BFF_URL=https://api.your-domain.com)
 *
 * STEP 2: 找到 uploadMedia.ts 中呼叫 supabase.functions.invoke 的地方
 *   原本：
 *     const { data, error } = await supabase.functions.invoke('upload-media', {
 *       body: formData,
 *     })
 *
 *   改成：
 *     const session = await supabase.auth.getSession()
 *     const accessToken = session.data.session?.access_token
 *     const res = await fetch(`${import.meta.env.VITE_BFF_URL}/api/media/upload`, {
 *       method: 'POST',
 *       headers: {
 *         Authorization: `Bearer ${accessToken}`,
 *       },
 *       body: formData,
 *     })
 *     const result = await res.json()
 *     if (!result.ok) throw new Error(result.error)
 *     const data = result.data
 *
 * ─────────────────────────────────────────────────────────────
 *
 * STEP 3: License redeem（找到呼叫 redeem_license_code RPC 的地方）
 *   原本：
 *     await supabase.rpc('redeem_license_code', { _org_id, _code, _user_id })
 *
 *   改成：
 *     await fetch(`${import.meta.env.VITE_BFF_URL}/api/license/redeem`, {
 *       method: 'POST',
 *       headers: {
 *         Authorization: `Bearer ${accessToken}`,
 *         'Content-Type': 'application/json',
 *       },
 *       body: JSON.stringify({ org_id: _org_id, code: _code }),
 *     })
 *
 * ─────────────────────────────────────────────────────────────
 *
 * 其他所有 Supabase client 查詢（SELECT）保持不動，不需要改！
 */

export {}
