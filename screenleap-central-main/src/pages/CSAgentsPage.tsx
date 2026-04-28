import { DashboardLayout } from "@/components/DashboardLayout";
import CSAgentManagement from "@/components/customer-service/CSAgentManagement";

const CSAgentsPage = () => (
  <DashboardLayout>
    <div className="flex flex-col h-full p-6 space-y-4">
      <CSAgentManagement />
    </div>
  </DashboardLayout>
);

export default CSAgentsPage;
