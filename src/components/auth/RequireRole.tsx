import { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { UserRole } from "@/types";
import { useAuthStore } from "@/store";

type RequireRoleProps = {
  roles?: UserRole[];
  children: React.ReactNode;
};

export default function RequireRole({ roles, children }: RequireRoleProps) {
  const { user, token, isLoading } = useAuthStore();
  const location = useLocation();

  const fallbackPath = useMemo(() => {
    if (user?.role === "admin") return "/admin";
    if (user?.role === "seller") return "/seller/account";
    return "/account";
  }, [user?.role]);

  if (isLoading) return null;
  if (!token || !user) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}
