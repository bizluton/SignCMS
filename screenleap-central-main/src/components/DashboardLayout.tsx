import { useState } from "react";
import { LicenseBanner } from "@/components/LicenseBanner";
import { DelegationBanner } from "@/components/delegation/DelegationBanner";
import { DelegationDialog } from "@/components/delegation/DelegationDialog";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { LogOut, KeyRound, Loader2, ShieldCheck, Info, UserCog } from "lucide-react";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { useProfiles } from "@/contexts/ProfilesContext";
import { PasswordInput } from "@/components/PasswordInput";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { NotificationBell } from "@/components/NotificationBell";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useActiveOrg } from "@/contexts/ActiveOrgContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const { activeOrgId, setActiveOrgId } = useActiveOrg();
  const { getProfile, profilesVersion } = useProfiles();

  const [pwdOpen, setPwdOpen] = useState(false);
  const [delegationOpen, setDelegationOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Prefer the live profile cache (updated immediately after edits) and fall
  // back to auth metadata for the very first render before the cache loads.
   
  const _v = profilesVersion; // re-render trigger when cache changes
  const cachedProfile = user ? getProfile(user.id) : undefined;
  const displayName =
    cachedProfile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    t("user");
  const avatarUrl =
    cachedProfile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t("passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success(t("passwordChanged"));
      setPwdOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t("passwordChangeFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 sm:h-14 flex items-center justify-between border-b border-border px-2 sm:px-4 bg-card/80 backdrop-blur-sm shrink-0 sticky top-0 z-10">
            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              <SidebarTrigger title={t("navDashboard")} className="shrink-0" />
              <span className="text-xs sm:text-sm font-bold tracking-wide text-foreground hidden sm:inline truncate">
                {t("appSubtitle")}
              </span>
              <OrgSwitcher value={activeOrgId} onChange={setActiveOrgId} />
            </div>
            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full w-8 h-8" title={displayName}>
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={avatarUrl} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <div className="px-2 py-1.5 text-sm">
                    <p className="font-medium text-foreground">{displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setEditProfileOpen(true)} className="cursor-pointer">
                    <UserCog className="w-4 h-4 mr-2" />
                    {t("editProfile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPwdOpen(true)} className="cursor-pointer">
                    <KeyRound className="w-4 h-4 mr-2" />
                    {t("changePassword")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDelegationOpen(true)} className="cursor-pointer">
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    {t("delegationMenu")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer" title={t("logout")}>
                    <LogOut className="w-4 h-4 mr-2" />
                    {t("logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
            <DelegationBanner />
            <LicenseBanner />
            {children}
          </main>
        </div>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("changePassword")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPwd">{t("newPassword")}</Label>
              <PasswordInput
                id="newPwd"
                showLockIcon={false}
                placeholder={t("authPasswordPlaceholder")}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              <PasswordStrengthMeter password={newPassword} />
              <p className="text-[11px] text-muted-foreground flex items-start gap-1 leading-relaxed">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{t("authPasswordRules")}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPwd">{t("confirmNewPassword")}</Label>
              <PasswordInput
                id="confirmPwd"
                showLockIcon={false}
                placeholder={t("authPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-[11px] text-destructive">{t("passwordMismatch")}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={loading || (confirmPassword.length > 0 && newPassword !== confirmPassword)}
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DelegationDialog open={delegationOpen} onOpenChange={setDelegationOpen} />
      <EditProfileDialog open={editProfileOpen} onOpenChange={setEditProfileOpen} />
    </SidebarProvider>
  );
}
