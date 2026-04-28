import { useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Score password 0..4 based on length + character variety + common-password penalty.
 * 0 = empty, 1 = weak, 2 = fair, 3 = good, 4 = strong.
 */
export function scorePassword(pwd: string): PasswordStrengthLevel {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  let variety = 0;
  if (/[a-z]/.test(pwd)) variety++;
  if (/[A-Z]/.test(pwd)) variety++;
  if (/[0-9]/.test(pwd)) variety++;
  if (/[^A-Za-z0-9]/.test(pwd)) variety++;
  if (variety >= 2) score++;
  if (variety >= 3) score++;
  if (variety >= 4 && pwd.length >= 12) score++;

  // Penalize obviously weak / common passwords
  const lower = pwd.toLowerCase();
  const common = ["password", "12345", "qwerty", "abc123", "letmein", "iloveyou", "admin", "welcome", "testpass"];
  if (common.some((c) => lower.includes(c))) score = Math.min(score, 1);

  if (score > 4) score = 4;
  return score as PasswordStrengthLevel;
}

interface Props {
  password: string;
  className?: string;
}

export function PasswordStrengthMeter({ password, className }: Props) {
  const { t } = useLanguage();
  const score = useMemo(() => scorePassword(password), [password]);

  if (!password) return null;

  const labels = [
    t("pwdStrengthVeryWeak"),
    t("pwdStrengthWeak"),
    t("pwdStrengthFair"),
    t("pwdStrengthGood"),
    t("pwdStrengthStrong"),
  ];
  // Use semantic tokens via inline classes keyed off score
  const barColors = [
    "bg-destructive",
    "bg-destructive",
    "bg-orange-500",
    "bg-yellow-500",
    "bg-green-500",
  ];
  const textColors = [
    "text-destructive",
    "text-destructive",
    "text-orange-500",
    "text-yellow-600 dark:text-yellow-500",
    "text-green-600 dark:text-green-500",
  ];

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < score ? barColors[score] : "bg-muted"
            )}
          />
        ))}
      </div>
      <p className={cn("text-[11px] font-medium", textColors[score])}>
        {t("pwdStrengthLabel")}: {labels[score]}
      </p>
    </div>
  );
}
