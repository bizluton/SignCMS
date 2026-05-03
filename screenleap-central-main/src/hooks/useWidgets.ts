import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import { useLanguage } from "@/contexts/LanguageContext";

export type WidgetScope = "system" | "app" | "user";

export interface WidgetRow {
  id: string;
  scope: WidgetScope;
  name: string;
  name_i18n: Record<string, string>;
  widget_type: string;
  config: Record<string, unknown>;
  thumbnail: string;
  app_id: string | null;
  org_id: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CatalogWidget {
  id: string;
  scope: WidgetScope;
  widget_type: string;
  name: string;
  config: Record<string, unknown>;
  thumbnail: string;
  app_id: string | null;
  org_id: string | null;
  created_at: string;
}

const SYSTEM_CREATED_AT = "2000-01-01T00:00:00.000Z";

function pickName(row: WidgetRow, lang: string): string {
  const i18n = row.name_i18n || {};
  return (i18n[lang] as string) || (i18n.en as string) || (i18n.zh as string) || row.name;
}

export function useWidgets(installedApps?: Set<string>) {
  const { activeOrgId } = useActiveOrg();
  const { language } = useLanguage();
  const [widgets, setWidgets] = useState<CatalogWidget[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    // RLS already filters: system + app are visible to all; user-scope only own org
    const [widgetRes, exclusionRes] = await Promise.all([
      supabase
        .from("widgets")
        .select("id, scope, name, name_i18n, widget_type, config, thumbnail, app_id, org_id, sort_order, created_at, updated_at, created_by")
        .order("scope", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      activeOrgId
        ? supabase.from("widget_org_exclusions").select("widget_id").eq("org_id", activeOrgId)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (widgetRes.error) {
      setWidgets([]);
      setLoading(false);
      return;
    }

    const hiddenIds = new Set(
      ((exclusionRes.data || []) as Array<{ widget_id: string }>).map((e) => e.widget_id)
    );

    const mapped: CatalogWidget[] = ((widgetRes.data || []) as WidgetRow[])
      .filter((r) => !hiddenIds.has(r.id))
      // Hide app-scope widgets when that app is not installed for this org
      .filter((r) => !r.app_id || !installedApps || installedApps.has(r.app_id))
      .map((r) => ({
        id: r.id,
        scope: r.scope,
        widget_type: r.widget_type,
        name: pickName(r, language),
        config: r.config || {},
        thumbnail: r.thumbnail || "",
        app_id: r.app_id,
        org_id: r.org_id,
        created_at: r.scope === "system" ? SYSTEM_CREATED_AT : r.created_at,
      }));
    setWidgets(mapped);
    setLoading(false);
  }, [language, activeOrgId, installedApps]);

  useEffect(() => { reload(); }, [reload]);

  // Real-time: reload whenever widgets or org exclusions change so all hook
  // instances (MediaPage, ContentStudioPage, etc.) stay in sync automatically.
  useEffect(() => {
    const channel = supabase
      .channel("useWidgets-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "widgets" }, () => { void reload(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "widget_org_exclusions" }, () => { void reload(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  return { widgets, loading, reload };
}

/** Build virtual media_items rows for MediaPage from catalog widgets. */
export function widgetsToMediaRows(widgets: CatalogWidget[], orgId: string | null | undefined) {
  return widgets.map((w) => ({
    id: `cat-widget-${w.id}`,
    name: w.name,
    original_name: null as string | null,
    type: "widget" as const,
    url: "widget://" + JSON.stringify({ widgetType: w.widget_type, ...Object.fromEntries(Object.entries(w.config || {}).filter(([k]) => k !== "widgetType")), _catalogType: w.widget_type }),
    thumbnail: w.thumbnail || "",
    size: "",
    size_bytes: 0,
    dimensions: "",
    width: null as number | null,
    height: null as number | null,
    duration: null as string | null,
    duration_seconds: null as number | null,
    created_at: w.created_at,
    design_project_id: null as string | null,
    is_system: w.scope === "system",
    catalog_scope: w.scope,
    catalog_app_id: w.app_id,
    org_id: orgId || "",
    md5: null as string | null,
    mime_type: "application/x-widget",
    uploaded_by: null as string | null,
  }));
}

/** Build studio dbWidgets rows from catalog widgets. */
export function widgetsToStudioRows(widgets: CatalogWidget[]) {
  return widgets.map((w) => ({
    id: `cat-widget-${w.id}`,
    name: w.name,
    url: JSON.stringify({ widgetType: w.widget_type, ...Object.fromEntries(Object.entries(w.config || {}).filter(([k]) => k !== "widgetType")), _catalogType: w.widget_type }),
    created_at: w.created_at,
  }));
}

export function isCatalogWidgetId(id: string | null | undefined) {
  return !!id && id.startsWith("cat-widget-");
}
