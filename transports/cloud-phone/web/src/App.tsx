import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { FleetPage } from "./features/fleet/FleetPage";
import { ProxiesPage } from "./features/proxies/ProxiesPage";
import { GroupsPage } from "./features/groups/GroupsPage";
import { AppsPage } from "./features/apps/AppsPage";
import { DrivePage } from "./features/drive/DrivePage";
import { AutomationPage } from "./features/automation/AutomationPage";
import { NumbersPage } from "./features/numbers/NumbersPage";
import { OrdersPage } from "./features/account/OrdersPage";
import { SubscriptionsPage } from "./features/account/SubscriptionsPage";
import { ProvisionPage } from "./features/provision/ProvisionPage";
import { ReportsPage } from "./features/reports/ReportsPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<FleetPage />} />
        <Route path="/proxies" element={<ProxiesPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/drive" element={<DrivePage />} />
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/numbers" element={<NumbersPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/provision" element={<ProvisionPage />} />
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>
    </Layout>
  );
}
