-- #74 P1-NEW-1: Fix auto_assign_chat_session trigger
--
-- Root cause: The trigger queried user_roles WHERE role='admin' to find
-- agents to assign. That table stores legacy org-founder 'admin' rows, not
-- CS agents. CS agents are tracked in the cs_agents table (status='active').
-- Migration 20260520000010 further changed has_role(uid,'admin') to mean
-- system_admin, making the old query semantically wrong in two ways.
--
-- Fix: Rewrite the trigger body to query cs_agents directly, preserving
-- the existing load-balancing logic (least open sessions, skip busy agents).

CREATE OR REPLACE FUNCTION public.auto_assign_chat_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _agent_id uuid;
BEGIN
  IF NEW.assigned_to IS NOT NULL OR NEW.status != 'open' THEN
    RETURN NEW;
  END IF;

  SELECT ca.user_id INTO _agent_id
  FROM public.cs_agents ca
  WHERE ca.status = 'active'
    AND ca.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_status ast
      WHERE ast.user_id = ca.user_id AND ast.status = 'busy'
    )
  ORDER BY (
    SELECT count(*)
    FROM public.customer_chat_sessions s
    WHERE s.assigned_to = ca.user_id AND s.status = 'open'
  ) ASC
  LIMIT 1;

  IF _agent_id IS NOT NULL THEN
    NEW.assigned_to := _agent_id;
  END IF;

  RETURN NEW;
END;
$$;
