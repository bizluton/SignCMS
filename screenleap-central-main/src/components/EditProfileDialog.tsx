/**
 * EditProfileDialog — left-tab layout: Basic / Preferences / Security.
 *
 * Storage: avatars are uploaded to the public `media` bucket under
 * `avatars/{userId}/{timestamp}.{ext}` (RLS enforces the {userId} prefix).
 *
 * After save we update both `profiles` (via ProfilesContext.updateProfile so
 * every cached consumer re-renders) AND `auth.users.user_metadata` so the
 * header avatar/name (which reads `user.user_metadata`) stays in sync without
 * a page reload.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Camera, Trash2, Sun, Moon, User, Settings, Shield } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PasswordInput } from "@/components/PasswordInput";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage, type Language } from "@/contexts/LanguageContext";
import { useProfiles } from "@/contexts/ProfilesContext";
import { supabase } from "@/integrations/supabase/client";
import { persistTheme, syncToServer, type Theme } from "@/hooks/usePreferences";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

type TabKey = "basic" | "preferences" | "security";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditProfileDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const { theme: currentTheme, setTheme } = useTheme();
  const { updateProfile, refreshProfiles, getProfile } = useProfiles();

  const [tab, setTab] = useState<TabKey>("basic");

  // Basic
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Preferences
  const [lang, setLang] = useState<Language>(language);
  const [theme, setLocalTheme] = useState<Theme>(currentTheme === "dark" ? "dark" : "light");

  // Security
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPwd, setChangingPwd] = useState(false);

  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !user) return;
    const cached = getProfile(user.id);
    setDisplayName(
      cached?.display_name ||
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email?.split("@")[0] ||
        ""
    );
    setAvatarUrl(
      cached?.avatar_url ||
        (user.user_metadata?.avatar_url as string | undefined) ||
        (user.user_metadata?.picture as string | undefined) ||
        null
    );
    setLang(language);
    setLocalTheme(currentTheme === "dark" ? "dark" : "light");
    setNewPassword("");
    setConfirmPassword("");
    setTab("basic");
  }, [open, user, getProfile, language, currentTheme]);

  if (!user) return null;

  const initials = (displayName || user.email || "?").slice(0, 2).toUpperCase();

  const handlePickFile = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("avatarMustBeImage"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t("avatarTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `avatars/${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
      toast.success(t("avatarUploaded"));
    } catch (err: any) {
      toast.error(err.message || t("avatarUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAvatar = () => setAvatarUrl(null);

  /** Saves Basic + Preferences (Security has its own button). */
  const handleSave = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error(t("displayNameRequired"));
      return;
    }
    setSaving(true);
    try {
      const { error: profErr } = await updateProfile(user.id, {
        display_name: trimmed,
        avatar_url: avatarUrl,
      });
      if (profErr) throw profErr as any;

      const { error: authErr } = await supabase.auth.updateUser({
        data: { full_name: trimmed, avatar_url: avatarUrl },
      });
      if (authErr) throw authErr;

      if (lang !== language) setLanguage(lang);
      if (theme !== currentTheme) {
        persistTheme(theme);
        setTheme(theme);
        syncToServer(lang, theme);
      }

      await refreshProfiles([user.id]);

      toast.success(t("profileUpdated"));
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || t("profileUpdateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error(t("passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("passwordMismatch"));
      return;
    }
    setChangingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success(t("passwordChanged"));
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || t("passwordChangeFailed"));
    } finally {
      setChangingPwd(false);
    }
  };

  const tabs: { key: TabKey; label: string; icon: typeof User }[] = [
    { key: "basic", label: t("profileTabBasic"), icon: User },
    { key: "preferences", label: t("profileTabPreferences"), icon: Settings },
    { key: "security", label: t("profileTabSecurity"), icon: Shield },
  ];

  const busy = saving || uploading || changingPwd;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>{t("editProfile")}</DialogTitle>
          <DialogDescription>{t("editProfileDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row min-h-[420px]">
          {/* Left tab rail */}
          <nav className="sm:w-44 shrink-0 border-b sm:border-b-0 sm:border-r border-border bg-muted/30 p-2 sm:p-3 flex sm:flex-col gap-1">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left flex-1 sm:flex-none",
                  tab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 p-6 overflow-y-auto max-h-[60vh]">
            {tab === "basic" && (
              <div className="space-y-5">
                <div className="flex items-center gap-4">
                  <Avatar className="w-20 h-20">
                    <AvatarImage src={avatarUrl || undefined} />
                    <AvatarFallback className="text-lg bg-primary/10 text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePickFile}
                      disabled={busy}
                    >
                      {uploading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4 mr-2" />
                      )}
                      {t("changeAvatar")}
                    </Button>
                    {avatarUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={handleRemoveAvatar}
                        disabled={busy}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {t("removeAvatar")}
                      </Button>
                    )}
                    <p className="text-[11px] text-muted-foreground">{t("avatarHint")}</p>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFile}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="displayName">{t("displayName")}</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("displayNamePlaceholder")}
                    maxLength={60}
                    disabled={busy}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-muted-foreground">{t("emailLabel")}</Label>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
            )}

            {tab === "preferences" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>{t("preferredLanguage")}</Label>
                  <Select value={lang} onValueChange={(v) => setLang(v as Language)} disabled={busy}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh">🇹🇼 中文</SelectItem>
                      <SelectItem value="en">🇺🇸 English</SelectItem>
                      <SelectItem value="ja">🇯🇵 日本語</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("preferredTheme")}</Label>
                  <Select
                    value={theme}
                    onValueChange={(v) => setLocalTheme(v as Theme)}
                    disabled={busy}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">
                        <span className="flex items-center gap-2">
                          <Sun className="w-4 h-4" />
                          {t("lightMode")}
                        </span>
                      </SelectItem>
                      <SelectItem value="dark">
                        <span className="flex items-center gap-2">
                          <Moon className="w-4 h-4" />
                          {t("darkMode")}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {tab === "security" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">{t("newPassword")}</Label>
                  <PasswordInput
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t("confirmNewPassword")}</Label>
                  <PasswordInput
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    disabled={busy}
                  />
                </div>
                <Button
                  onClick={handleChangePassword}
                  disabled={busy || !newPassword || !confirmPassword}
                  className="w-full sm:w-auto"
                >
                  {changingPwd && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {t("changePassword")}
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={busy || tab === "security"}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
