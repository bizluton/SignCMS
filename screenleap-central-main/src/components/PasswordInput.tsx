import { useState, forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Lock, Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  showLockIcon?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showLockIcon = true, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const { t } = useLanguage();
    return (
      <div className="relative">
        {showLockIcon && (
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        )}
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(showLockIcon ? "pl-9" : "", "pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={visible ? t("authHidePassword") : t("authShowPassword")}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
