import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

export default function ChangePasswordDialog() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  function reset(next: boolean) {
    setOpen(next);
    setCurrent("");
    setPassword("");
    setConfirm("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      toast({
        title: ar ? "كلمتا المرور غير متطابقتين" : "Passwords do not match",
        variant: "destructive",
      });
      return;
    }
    if (
      password.length < 10 ||
      new TextEncoder().encode(password).length > 72
    ) {
      toast({
        title: ar
          ? "كلمة المرور: 10 أحرف على الأقل و72 بايت كحد أقصى"
          : "Use at least 10 characters and at most 72 UTF-8 bytes",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword(current, password);
      reset(false);
      toast({
        title: ar
          ? "تم تغيير كلمة المرور وإلغاء الجلسات الأخرى"
          : "Password changed; other sessions revoked",
      });
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : "Password change failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          {ar ? "تغيير كلمة المرور" : "Change password"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {ar ? "تغيير كلمة المرور" : "Change password"}
          </DialogTitle>
          <DialogDescription>
            {ar
              ? "سيتم إلغاء الجلسات الأخرى. استخدم كلمة مرور فريدة."
              : "Other sessions will be revoked. Use a unique password."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="current-password">
              {ar ? "كلمة المرور الحالية" : "Current password"}
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="new-password">
              {ar ? "كلمة المرور الجديدة" : "New password"}
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">
              {ar ? "تأكيد كلمة المرور" : "Confirm password"}
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? (ar ? "جارٍ الحفظ…" : "Saving…") : ar ? "حفظ" : "Save"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
