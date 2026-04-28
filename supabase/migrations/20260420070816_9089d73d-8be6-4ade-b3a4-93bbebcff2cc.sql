
CREATE OR REPLACE FUNCTION public.safe_text_to_jsonb(_input text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF _input IS NULL OR _input = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_result := _input::jsonb;
    IF jsonb_typeof(v_result) IN ('object', 'array') THEN
      RETURN v_result;
    ELSE
      RETURN jsonb_build_object('text', _input);
    END IF;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('text', _input);
  END;
END;
$$;
