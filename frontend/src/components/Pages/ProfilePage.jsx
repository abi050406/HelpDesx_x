import PageHeader from './PageHeader';

function ProfilePage({ role, currentUser }) {
  return (
    <section className="module-page">
      <PageHeader title="Mi Perfil" subtitle="Datos de sesión y preferencias del usuario." />
      <div className="profile-card">
        <div className="avatar large">{currentUser?.avatar || '👤'}</div>
        <h2>{currentUser?.name || 'Usuario'}</h2>
        <p>{currentUser?.roleLabel || role}</p>
        <small>{currentUser?.department || 'HelpDesk_X'}</small>
        <button>Editar perfil</button>
      </div>
    </section>
  );
}

export default ProfilePage;
