import { Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import DashboardPage from "@/pages/DashboardPage";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { isSystemAdmin, loading } = useIsSystemAdmin();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isSystemAdmin) return <Navigate to="/system-admin" replace />;

  return (
    <DashboardLayout>
      <DashboardPage />
    </DashboardLayout>
  );
};

export default Index;
