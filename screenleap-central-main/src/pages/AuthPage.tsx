import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLogger";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, User, Loader2, Info, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PasswordInput } from "@/components/PasswordInput";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import {
  mapSupabaseAuthError,
  getLoginLockRemainingMs,
  recordLoginFailure,
  clearLoginLock,
  getLoginFailureCount,
  formatLockCountdown,
  LOGIN_MAX_FAILS,
} from "@/lib/supabaseAuthErrors";
import logoImg from "@/assets/logo.png";
import logoLightImg from "@/assets/logo-light.png";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useNavigate, Link, useSearchParams, Navigate } from "react-router-dom";
import { extractToken } from "@/lib/inviteToken";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthPage() {
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { resolvedTheme } = useTheme();
  const currentLogo = resolvedTheme === "dark" ? logoLightImg : logoImg;
  const [searchParams] = useSearchParams();
  // Sanitize via shared inviteToken util — accepts a bare UUID OR a full
  // invite URL accidentally pasted into the query (?invite=https://...).
  // Drops anything that isn't a UUID-shaped token.
  const rawInvite = searchParams.get("invite") || "";
  const extractedInvite = extractToken(rawInvite);
  // Accept UUID (36 chars) or 64-char hex from gen_random_bytes(32)
  const inviteToken = extractedInvite.length >= 20 && /^[0-9a-f-]+$/i.test(extractedInvite) ? extractedInvite : "";
  // True when ?invite=... was provided but couldn't be reduced to a valid token.
  const inviteInvalid = rawInvite.length > 0 && !inviteToken;
  const csAgentId = searchParams.get("cs_agent") || "";
  const [isSignUp, setIsSignUp] = useState(!!inviteToken || !!csAgentId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [domainBlocked, setDomainBlocked] = useState<string | null>(null);
  const navigate = useNavigate();

  const checkEmailDomain = async (emailValue: string) => {
    if (inviteToken || !emailValue.includes("@")) { setDomainBlocked(null); return; }
    try {
      const { data } = await supabase.rpc("check_email_domain_registered", { p_email: emailValue });
      setDomainBlocked(data && !data.eligible ? (data.org_name as string || "") : null);
    } catch {
      setDomainBlocked(null);
    }
  };

  const [lockRemainingMs, setLockRemainingMs] = useState(getLoginLockRemainingMs());
  const isLocked = lockRemainingMs > 0;
  const failCount = getLoginFailureCount();

  useEffect(() => {
    if (!inviteToken) return;
    setIsSignUp(true);
  }, [inviteToken]);

  // Redirect already-authenticated users away from the login page.
  // Don't redirect when an invite/cs_agent token is present — those are valid
  // reasons a logged-in user might land here (e.g. accept a team invitation).
  if (!authLoading && user && !inviteToken && !csAgentId) {
    return <Navigate to="/" replace />;
  }

  // Tick countdown every second while locked.
  useEffect(() => {
    if (!isLocked) return;
    const id = setInterval(() => {
      const remaining = getLoginLockRemainingMs();
      setLockRemainingMs(remaining);
      if (remaining <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [isLocked]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSignUp && getLoginLockRemainingMs() > 0) {
      setLockRemainingMs(getLoginLockRemainingMs());
      toast.error(t("authLockedTitle"));
      return;
    }
    if (isSignUp && password !== confirmPassword) {
      toast.error(t("authPasswordMismatch"));
      return;
    }
    if (isSignUp && !inviteToken && domainBlocked !== null) {
      toast.error(t("authDomainRegistered").replace("{org}", domainBlocked || ""));
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: displayName,
              invite_token: inviteToken || undefined,
              cs_agent: csAgentId || undefined,
            },
          },
        });
        if (error) throw error;
        // Detect "user already exists" — Supabase returns 200 with a user
        // object that has an empty identities array (anti-enumeration).
        const identities = (data?.user as Record<string, unknown> | undefined)?.identities;
        if (data?.user && Array.isArray(identities) && identities.length === 0) {
          toast.error(t("authEmailExists"), { duration: 6000 });
          return;
        }
        toast.success(t("authSignUpSuccess"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (rememberMe) {
          localStorage.setItem("signcms_remember_me", "true");
        } else {
          localStorage.removeItem("signcms_remember_me");
          sessionStorage.setItem("signcms_session_active", "true");
        }
        clearLoginLock();
        toast.success(t("authSignInSuccess"));
        logActivity({ action: "sign_in", category: "auth", actionParams: { email } });
        navigate("/");
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "";
      const msg = errMsg.toLowerCase();
      if (
        isSignUp &&
        (msg.includes("already registered") ||
          msg.includes("already been registered") ||
          msg.includes("user already exists") ||
          msg.includes("email address is already"))
      ) {
        toast.error(t("authEmailExists"), { duration: 6000 });
      } else {
        const mappedKey = mapSupabaseAuthError(errMsg);
        const friendly = mappedKey ? t(mappedKey as import("@/contexts/translations").TranslationKey) : (errMsg || t("authFailed"));
        // Only count as a brute-force failure for sign-in attempts where
        // the credentials were rejected (not for sign-up errors or rate limits).
        if (!isSignUp && (mappedKey === "authErrInvalidCredentials" || mappedKey === null)) {
          const lockedMs = recordLoginFailure();
          if (lockedMs > 0) {
            setLockRemainingMs(lockedMs);
            toast.error(t("authLockedTitle"), { description: t("authLockedBody"), duration: 8000 });
          } else {
            const remaining = LOGIN_MAX_FAILS - getLoginFailureCount();
            toast.error(friendly, {
              description: t("authFailWarning").replace("{count}", String(getLoginFailureCount())),
              duration: 5000,
            });
            void remaining;
          }
        } else {
          toast.error(friendly);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/#/` },
      });
      if (error) throw error;
      // Redirect is handled by Supabase — loading stays true until navigation
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("authGoogleFailed"));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-3 py-6 sm:p-4 relative">
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-center gap-2 mb-6 sm:mb-8">
          <img src={currentLogo} alt="SignCMS" className="h-10 sm:h-14 object-contain" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">{t("trialBadge")}</span>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{isSignUp ? t("authCreateAccount") : t("authWelcome")}</CardTitle>
            <CardDescription>{isSignUp ? t("authSignUpDesc") : t("authSignInDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {inviteInvalid && (
              <Alert variant="destructive">
                <Info className="h-4 w-4" />
                <AlertDescription>{t("authInviteInvalid")}</AlertDescription>
              </Alert>
            )}
            <Button variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn} disabled={loading}>
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {t("authGoogleSignIn")}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">{t("authOrEmail")}</span></div>
            </div>

            {!isSignUp && isLocked && (
              <Alert variant="destructive">
                <Lock className="h-4 w-4" />
                <AlertTitle>{t("authLockedTitle")}</AlertTitle>
                <AlertDescription className="space-y-1">
                  <p>{t("authLockedBody")}</p>
                  <p className="font-mono text-sm">
                    {t("authLockedRemaining")}: <span className="font-semibold tabular-nums">{formatLockCountdown(lockRemainingMs)}</span>
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {!isSignUp && !isLocked && failCount > 0 && failCount < LOGIN_MAX_FAILS && (
              <p className="text-xs text-destructive text-center">
                {t("authFailWarning").replace("{count}", String(failCount))}
              </p>
            )}

            <form onSubmit={handleEmailAuth} className="space-y-3">
              {isSignUp && (
                <div className="space-y-1.5">
                  <Label htmlFor="displayName">{t("authDisplayName")}</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="displayName" className="pl-9" placeholder={t("authNamePlaceholder")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setDomainBlocked(null); }}
                    onBlur={isSignUp && !inviteToken ? (e) => void checkEmailDomain(e.target.value) : undefined}
                    required
                  />
                </div>
                {isSignUp && !inviteToken && domainBlocked !== null && (
                  <Alert variant="destructive" className="py-2">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {t("authDomainRegistered").replace("{org}", domainBlocked || "")}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("authPassword")}</Label>
                  {!isSignUp && <Link to="/forgot-password" className="text-xs text-primary hover:underline">{t("authForgotPassword")}</Link>}
                </div>
                <PasswordInput
                  id="password"
                  placeholder={t("authPasswordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
                {isSignUp && (
                  <>
                    <PasswordStrengthMeter password={password} />
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1 leading-relaxed">
                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{t("authPasswordRules")}</span>
                    </p>
                  </>
                )}
              </div>
              {isSignUp && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">{t("authConfirmPassword")}</Label>
                  <PasswordInput
                    id="confirmPassword"
                    placeholder={t("authConfirmPasswordPlaceholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  {confirmPassword.length > 0 && password !== confirmPassword && (
                    <p className="text-[11px] text-destructive">{t("authPasswordMismatch")}</p>
                  )}
                </div>
              )}
              {!isSignUp && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
                    {t("authRememberMe")}
                  </Label>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading || (!isSignUp && isLocked)}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {!isSignUp && isLocked
                  ? `${t("authLockedRemaining")} ${formatLockCountdown(lockRemainingMs)}`
                  : (isSignUp ? t("authSignUp") : t("authSignIn"))}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              {isSignUp ? t("authHaveAccount") : t("authNoAccount")}
              <button
                type="button"
                className="text-primary hover:underline ml-1 font-medium"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setConfirmPassword("");
                }}
              >
                {isSignUp ? t("authSignIn") : t("authSignUp")}
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
