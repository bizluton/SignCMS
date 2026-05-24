-- Phase A.1: Add 'agent' to app_role enum.
-- Must be in its own migration (PostgreSQL restricts ALTER TYPE ADD VALUE
-- from being used in the same transaction as code that references the new value).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'agent';
