import MetricsGrid from './MetricsGrid';
import ChartsSection from './ChartsSection';
import RightRail from './RightRail';
import TicketWorkspace from './TicketWorkspace';

function AdminDashboard({ tickets, metrics, categoryData, selectedTicket, selectedId, setSelectedId, resolveTicket, loading, technicianDirectory, authToken }) {
  return (
    <>
      <section className="content-grid">
        <div className="left-content">
          <MetricsGrid metrics={metrics} loading={loading} />
          <ChartsSection metrics={metrics} categoryData={categoryData} tickets={tickets} technicianDirectory={technicianDirectory} />
        </div>
        <RightRail tickets={tickets} technicianDirectory={technicianDirectory} />
      </section>

      <TicketWorkspace
        tickets={tickets}
        metrics={metrics}
        selectedTicket={selectedTicket}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        resolveTicket={resolveTicket}
        authToken={authToken}
      />
    </>
  );
}

export default AdminDashboard;
