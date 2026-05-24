import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLogger";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Loader2, LogOut, KeyRound } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import logoImg from "@/assets/logo.png";
import logoLightImg from "@/assets/logo-light.png";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { extractToken, validateTokenShape } from "@/lib/inviteToken";

export default function OnboardingPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const currentLogo = resolvedTheme === "dark" ? logoLightImg : logoImg;
  const [orgName, setOrgName] = useState("");
  const [orgNameError, setOrgNameError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  // Validate token shape; return localized error string or null when OK.
  const validateToken = (raw: string): string | null => {
    const key = validateTokenShape(raw);
    return key ? t(key) : null;
  };

  // Safety re-check: if user already has an org, leave the page. Per
  // SIGNCMS組織權限規則, agents (代理商) don't sit in team_members — they
  // join via agent_org_assignments + the 'agent' role — so we have to look
  // for either signal before deciding the user still needs onboarding.
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    (async () => {
      const [{ data: teamRows }, { data: roleRows }, { data: agentRows }, { data: csRows }, { data: sysRows }] = await Promise.all([
        supabase.from("team_members").select("team_id").eq("user_id", user.id).limit(1),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("agent_org_assignments").select("id").eq("agent_user_id", user.id).limit(1),
        supabase.from("cs_agents").select("id").eq("user_id", user.id).eq("status", "active").limit(1),
        supabase.from("system_admins").select("user_id").eq("user_id", user.id).limit(1),
      ]);
      if (cancelled) return;
      const onboarded =
        (teamRows && teamRows.length > 0) ||
        (agentRows && agentRows.length > 0) ||
        (csRows && csRows.length > 0) ||
        (sysRows && sysRows.length > 0) ||
        ((roleRows || []).some((r) => ["agent", "admin", "org_admin"].includes(r.role as string)));
      if (onboarded) {
        navigate("/", { replace: true });
      } else {
        setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = orgName.trim();
    if (!name) {
      setOrgNameError(t("onboardingNameRequired"));
      toast.error(t("onboardingNameRequired"));
      return;
    }
    if (name.length > 100) {
      setOrgNameError(t("onboardingNameTooLong"));
      toast.error(t("onboardingNameTooLong"));
      return;
    }
    setOrgNameError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("bootstrap_user_organization", { _org_name: name });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result?.success) {
        const map: Record<string, string> = {
          unauthenticated: t("authFailed"),
          invalid_name: t("onboardingNameRequired"),
          name_too_long: t("onboardingNameTooLong"),
          already_in_org: t("onboardingAlreadyInOrg"),
          name_taken: t("onboardingNameTaken"),
        };
        toast.error(map[result?.error || ""] || t("onboardingFailed"));
        // Log failure (skip 'unauthenticated' — RLS requires authenticated user)
        if (result?.error && result.error !== "unauthenticated") {
          void logActivity({
            action: "onboarding_create_failed",
            category: "auth",
            targetType: "organization",
            targetName: name,
            detail: `error=${result.error}`,
          });
        }
        if (result?.error === "already_in_org") navigate("/", { replace: true });
        return;
      }
      void logActivity({
        action: "onboarding_create_success",
        category: "auth",
        targetType: "organization",
        targetName: name,
      });
      toast.success(t("onboardingSuccess"));
      navigate("/", { replace: true });
    } catch (err: unknown) {
      void logActivity({
        action: "onboarding_create_failed",
        category: "auth",
        targetType: "organization",
        targetName: name,
        detail: `exception=${(err instanceof Error ? err.message : "unknown").slice(0, 200)}`,
      });
      toast.error(err instanceof Error ? err.message : t("onboardingFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErr = validateToken(token);
    if (validationErr) {
      setTokenError(validationErr);
      toast.error(validationErr);
      return;
    }
    setTokenError(null);
    const raw = extractToken(token);
    // Last 6 chars only — never log full token
    const tokenHint = raw.length > 6 ? `…${raw.slice(-6)}` : raw;
    setJoinLoading(true);
    try {
      const { data, error } = await supabase.rpc("redeem_invitation_token", { _token: raw });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result?.success) {
        const map: Record<string, string> = {
          unauthenticated: t("authFailed"),
          invalid_token: t("onboardingErrInvalidToken"),
          token_used: t("onboardingErrTokenUsed"),
          token_expired: t("onboardingErrTokenExpired"),
          email_mismatch: t("onboardingErrEmailMismatch"),
          already_in_org: t("onboardingAlreadyInOrg"),
        };
        toast.error(map[result?.error || ""] || t("onboardingFailed"));
        if (result?.error && result.error !== "unauthenticated") {
          void logActivity({
            action: "onboarding_join_failed",
            category: "auth",
            targetType: "invitation",
            detail: `error=${result.error}; token=${tokenHint}`,
          });
        }
        if (result?.error === "already_in_org") navigate("/", { replace: true });
        return;
      }
      void logActivity({
        action: "onboarding_join_success",
        category: "auth",
        targetType: "invitation",
        detail: `token=${tokenHint}`,
      });
      toast.success(t("onboardingJoinSuccess"));
      navigate("/", { replace: true });
    } catch (err: unknown) {
      void logActivity({
        action: "onboarding_join_failed",
        category: "auth",
        targetType: "invitation",
        detail: `exception=${(err instanceof Error ? err.message : "unknown").slice(0, 200)}; token=${tokenHint}`,
      });
      toast.error(err instanceof Error ? err.message : t("onboardingFailed"));
    } finally {
      setJoinLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-3 py-6 sm:p-4 relative">
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-6 sm:mb-8">
          <img src={currentLogo} alt="SignCMS" className="h-10 sm:h-14 object-contain" />
        </div>
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{t("onboardingTitle")}</CardTitle>
            <CardDescription>{t("onboardingDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="create" className="w-full">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="create">{t("onboardingTabCreate")}</TabsTrigger>
                <TabsTrigger value="join">{t("onboardingTabJoin")}</TabsTrigger>
              </TabsList>

              <TabsContent value="create" className="mt-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="orgName">{t("onboardingOrgName")}</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="orgName"
                        className={`pl-9 ${orgNameError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        placeholder={t("onboardingOrgPlaceholder")}
                        value={orgName}
                        onChange={(e) => {
                          setOrgName(e.target.value);
                          if (orgNameError) setOrgNameError(null);
                        }}
                        onBlur={() => {
                          const trimmed = orgName.trim();
                          if (!trimmed) setOrgNameError(t("onboardingNameRequired"));
                          else if (trimmed.length > 100) setOrgNameError(t("onboardingNameTooLong"));
                          else setOrgNameError(null);
                        }}
                        autoFocus
                        maxLength={100}
                        aria-invalid={orgNameError ? true : undefined}
                        aria-describedby={orgNameError ? "orgName-error" : "orgName-hint"}
                      />
                    </div>
                    {orgNameError ? (
                      <p id="orgName-error" className="text-[11px] text-destructive leading-relaxed">
                        {orgNameError}
                      </p>
                    ) : (
                      <p id="orgName-hint" className="text-[11px] text-muted-foreground leading-relaxed">
                        {t("onboardingHint")}
                      </p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("onboardingSubmit")}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="join" className="mt-4">
                <form onSubmit={handleJoin} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="inviteToken">{t("onboardingJoinTitle")}</Label>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {t("onboardingJoinDesc")}
                    </p>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="inviteToken"
                        className={`pl-9 font-mono text-xs ${tokenError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        placeholder={t("onboardingJoinPlaceholder")}
                        value={token}
                        onChange={(e) => {
                          setToken(e.target.value);
                          if (tokenError) setTokenError(null);
                        }}
                        onPaste={(e) => {
                          const pasted = e.clipboardData.getData("text");
                          if (!pasted) return;
                          const looksLikeLink =
                            pasted.includes("invite=") ||
                            /^https?:\/\//i.test(pasted.trim());
                          if (!looksLikeLink) return;
                          const extracted = extractToken(pasted);
                          if (extracted.length >= 20 && /^[0-9a-f-]+$/i.test(extracted)) {
                            e.preventDefault();
                            setToken(extracted);
                            setTokenError(null);
                          } else {
                            // User pasted a link but no valid invite token was found.
                            setTokenError(t("onboardingTokenPasteNoInvite"));
                          }
                        }}
                        onBlur={() => {
                          // Auto-trim invite URL → pure UUID for cleaner display
                          const extracted = extractToken(token);
                          if (extracted !== token.trim() && extracted.length >= 20 && /^[0-9a-f-]+$/i.test(extracted)) {
                            setToken(extracted);
                          }
                          setTokenError(validateToken(token));
                        }}
                        maxLength={500}
                        aria-invalid={tokenError ? true : undefined}
                        aria-describedby={tokenError ? "inviteToken-error" : "inviteToken-hint"}
                      />
                    </div>
                    {tokenError ? (
                      <p id="inviteToken-error" className="text-[11px] text-destructive leading-relaxed">
                        {tokenError}
                      </p>
                    ) : (
                      <p id="inviteToken-hint" className="text-[11px] text-muted-foreground leading-relaxed">
                        {t("onboardingJoinHint")}
                      </p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={joinLoading}>
                    {joinLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("onboardingJoinSubmit")}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleSignOut}>
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              {t("logout")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
