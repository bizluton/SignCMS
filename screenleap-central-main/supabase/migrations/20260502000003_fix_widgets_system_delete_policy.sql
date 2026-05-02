-- The original "System admin can delete system/app widgets" policy used a
-- hardcoded UUID.  Replace it with has_role() so any system admin account works.
DROP POLICY IF EXISTS "System admin can delete system/app widgets" ON public.widgets;

CREATE POLICY "System admin can delete system/app widgets"
  ON public.widgets FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    AND scope IN ('system', 'app')
  );
