import { Route, Routes } from 'react-router-dom';
import { CHANGE_PASSWORD_PATH, RequireAuth } from '@/auth/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AuditPage } from '@/pages/audit/AuditPage';
import { CatalogPage } from '@/pages/catalog/CatalogPage';
import { ExamDetailPage } from '@/pages/catalog/ExamDetailPage';
import { PatientsPage } from '@/pages/patients/PatientsPage';
import { PrescribersPage } from '@/pages/prescribers/PrescribersPage';
import { ANALYSIS_ROLES, BILLING_READ_ROLES, INDICATORS_ROLES, INSTRUMENT_READ_ROLES, INTEROP_READ_ROLES, QC_READ_ROLES, PATIENT_READ_ROLES, REGISTRATION_WRITE_ROLES, SAMPLE_COLLECT_ROLES } from '@/auth/navigation';
import { CashierPage } from '@/pages/cashier/CashierPage';
import { NewOrderPage } from '@/pages/orders/NewOrderPage';
import { OrderDetailPage } from '@/pages/orders/OrderDetailPage';
import { OrdersPage } from '@/pages/orders/OrdersPage';
import { CashSessionPrintPage } from '@/pages/print/CashSessionPrintPage';
import { LabelsPrintPage } from '@/pages/print/LabelsPrintPage';
import { ReceiptPrintPage } from '@/pages/print/ReceiptPrintPage';
import { InstrumentDetailPage } from '@/pages/instruments/InstrumentDetailPage';
import { InteropPage } from './pages/interop/InteropPage';
import { SetupPage } from './pages/SetupPage';
import { InstrumentsPage } from '@/pages/instruments/InstrumentsPage';
import { IndicatorsPage } from '@/pages/quality/IndicatorsPage';
import { LeveyJenningsPage } from '@/pages/quality/LeveyJenningsPage';
import { QcPage } from '@/pages/quality/QcPage';
import { QualityIssuesPage } from '@/pages/quality/QualityIssuesPage';
import { ResultsEntryPage } from '@/pages/results/ResultsEntryPage';
import { WorklistPage } from '@/pages/results/WorklistPage';
import { SamplesPage } from '@/pages/samples/SamplesPage';
import { LabSettingsPage } from '@/pages/settings/LabSettingsPage';
import { UsersPage } from '@/pages/users/UsersPage';

export function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<LoginPage />} />
      <Route path="/installation" element={<SetupPage />} />
      {/* Pages d'impression : hors de la mise en page applicative */}
      <Route
        path="/impression/etiquettes/:orderId"
        element={
          <RequireAuth roles={PATIENT_READ_ROLES}>
            <LabelsPrintPage />
          </RequireAuth>
        }
      />
      <Route
        path="/impression/recu/:paymentId"
        element={
          <RequireAuth roles={BILLING_READ_ROLES}>
            <ReceiptPrintPage />
          </RequireAuth>
        }
      />
      <Route
        path="/impression/caisse/:id"
        element={
          <RequireAuth roles={BILLING_READ_ROLES}>
            <CashSessionPrintPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path={CHANGE_PASSWORD_PATH} element={<ChangePasswordPage />} />
        <Route
          path="patients"
          element={
            <RequireAuth roles={PATIENT_READ_ROLES}>
              <PatientsPage />
            </RequireAuth>
          }
        />
        <Route
          path="prescripteurs"
          element={
            <RequireAuth roles={PATIENT_READ_ROLES}>
              <PrescribersPage />
            </RequireAuth>
          }
        />
        <Route
          path="demandes"
          element={
            <RequireAuth roles={PATIENT_READ_ROLES}>
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path="demandes/nouvelle"
          element={
            <RequireAuth roles={REGISTRATION_WRITE_ROLES}>
              <NewOrderPage />
            </RequireAuth>
          }
        />
        <Route
          path="demandes/:id"
          element={
            <RequireAuth roles={PATIENT_READ_ROLES}>
              <OrderDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="echantillons"
          element={
            <RequireAuth roles={SAMPLE_COLLECT_ROLES}>
              <SamplesPage />
            </RequireAuth>
          }
        />
        <Route
          path="paillasses"
          element={
            <RequireAuth roles={ANALYSIS_ROLES}>
              <WorklistPage />
            </RequireAuth>
          }
        />
        <Route
          path="resultats/:orderId"
          element={
            <RequireAuth roles={PATIENT_READ_ROLES}>
              <ResultsEntryPage />
            </RequireAuth>
          }
        />
        <Route
          path="qualite/ciq"
          element={
            <RequireAuth roles={QC_READ_ROLES}>
              <QcPage />
            </RequireAuth>
          }
        />
        <Route
          path="qualite/ciq/levey-jennings/:targetId"
          element={
            <RequireAuth roles={QC_READ_ROLES}>
              <LeveyJenningsPage />
            </RequireAuth>
          }
        />
        <Route path="qualite/non-conformites" element={<QualityIssuesPage />} />
        <Route
          path="qualite/indicateurs"
          element={
            <RequireAuth roles={INDICATORS_ROLES}>
              <IndicatorsPage />
            </RequireAuth>
          }
        />
        <Route
          path="interoperabilite"
          element={
            <RequireAuth roles={INTEROP_READ_ROLES}>
              <InteropPage />
            </RequireAuth>
          }
        />
        <Route
          path="automates"
          element={
            <RequireAuth roles={INSTRUMENT_READ_ROLES}>
              <InstrumentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="automates/:id"
          element={
            <RequireAuth roles={INSTRUMENT_READ_ROLES}>
              <InstrumentDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="caisse"
          element={
            <RequireAuth roles={BILLING_READ_ROLES}>
              <CashierPage />
            </RequireAuth>
          }
        />
        <Route path="catalogue" element={<CatalogPage />} />
        <Route path="catalogue/examens/:id" element={<ExamDetailPage />} />
        <Route
          path="utilisateurs"
          element={
            <RequireAuth roles={['ADMIN']}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="audit"
          element={
            <RequireAuth roles={['ADMIN', 'QUALITE']}>
              <AuditPage />
            </RequireAuth>
          }
        />
        <Route
          path="parametres"
          element={
            <RequireAuth roles={['ADMIN']}>
              <LabSettingsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
