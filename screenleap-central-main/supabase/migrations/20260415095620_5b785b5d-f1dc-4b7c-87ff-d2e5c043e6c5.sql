
CREATE TABLE public.quick_reply_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.quick_reply_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view templates"
ON public.quick_reply_templates FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert templates"
ON public.quick_reply_templates FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update templates"
ON public.quick_reply_templates FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete templates"
ON public.quick_reply_templates FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_quick_reply_templates_updated_at
BEFORE UPDATE ON public.quick_reply_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default templates
INSERT INTO public.quick_reply_templates (label, text, sort_order, created_by) VALUES
('歡迎', '您好！歡迎聯繫客服，請問有什麼可以幫您的？', 0, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('稍候', '請稍等，我正在為您查詢相關資訊。', 1, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('已處理', '您的問題已處理完畢，如有其他需求請隨時聯繫。', 2, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
('感謝', '感謝您的耐心等待，祝您有美好的一天！', 3, '3fbb2f97-7268-4cac-a511-7cff6654a8f7');
