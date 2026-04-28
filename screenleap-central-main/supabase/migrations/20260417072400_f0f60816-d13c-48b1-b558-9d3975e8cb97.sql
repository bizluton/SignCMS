-- Allow system admin to clear redeem attempts (manual unlock)
CREATE POLICY "System admin can delete redeem attempts"
ON public.license_redeem_attempts
FOR DELETE
TO authenticated
USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);