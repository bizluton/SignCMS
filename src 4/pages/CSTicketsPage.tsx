import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import TicketPanel from "@/components/customer-service/TicketPanel";
import { useLanguage } from "@/contexts/LanguageContext";

const CSTicketsPage = () => {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id") || null;
  const sessionSubject = searchParams.get("subject") || null;
  const customerName = searchParams.get("customer") || null;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{t("navCSTickets")}</h1>
        </div>
        <TicketPanel sessionId={sessionId} sessionSubject={sessionSubject} customerName={customerName} />
      </div>
    </DashboardLayout>
  );
};

export default CSTicketsPage;
