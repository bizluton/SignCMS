import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Loader2, Info } from "lucide-react";
import { PasswordInput } from "@/components/PasswordInput";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { ThemeToggle } from "@/components/ThemeToggle";
import logoImg from "@/assets/logo.png";
import logoLightImg from "@/assets/logo-light.png";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const { resolvedTheme } = useTheme();
  const currentLogo = resolvedTheme === "dark" ? logoLightImg : logoImg;
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 1) Hash-based recovery (legacy implicit flow): #access_token=...&type=recovery
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get("type") === "recovery") {
      setIsRecovery(true);
      setChecking(false);
      return;
    }
    // 2) Query-based recovery (PKCE flow): ?code=... — Supabase will exchange and fire PASSWORD_RECOVERY
    const search = new URLSearchParams(window.location.search);
    const hasCode = !!search.get("code");

    // 3) Listen for PASSWORD_RECOVERY (fires after Supabase processes the link)
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
        setChecking(false);
      }
    });

    // 4) Fallback: if user already has a session AND landed here directly from
    // a recovery email (referrer or recent sign-in via /verify), treat as recovery.
    // We give the listener ~1.5s to fire; otherwise check session.
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Session present on /reset-password = came from recovery link
        setIsRecovery(true);
      }
      setChecking(false);
    }, hasCode ? 2500 : 1200);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { toast.error(t("resetMismatch")); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(t("resetSuccess"));
      navigate("/");
    } catch (error: any) { toast.error(error.message || t("resetFailed")); }
    finally { setLoading(false); }
  };

  if (checking) return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (!isRecovery) return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src={currentLogo} alt="SignCMS" className="h-14 object-contain" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">Trial</span>
        </div>
        <Card className="shadow-lg">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">{t("resetInvalidLink")}</p>
            <Button className="mt-4" onClick={() => navigate("/forgot-password")}>{t("resetRequestNew")}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src={currentLogo} alt="SignCMS" className="h-14 object-contain" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">Trial</span>
        </div>
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{t("resetTitle")}</CardTitle>
            <CardDescription>{t("resetDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("resetNewPassword")}</Label>
                <PasswordInput id="password" placeholder={t("authPasswordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
                <PasswordStrengthMeter password={password} />
                <p className="text-[11px] text-muted-foreground flex items-start gap-1 leading-relaxed">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{t("authPasswordRules")}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">{t("resetConfirmPassword")}</Label>
                <PasswordInput id="confirmPassword" placeholder={t("resetConfirmPlaceholder")} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="text-[11px] text-destructive">{t("authPasswordMismatch")}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("resetUpdate")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
