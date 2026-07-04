function LoginPage({ credentials, setCredentials, onLogin, loginError, authLoading }) {
  return (
    <main className="login-screen login-centered">
      <section className="login-card login-card-centered">
        <div className="login-logo-mark">🎧</div>

        <div className="login-card-header centered-text">
          <span className="secure-dot">● Servidor de autenticación</span>
          <h1>HelpDesk_X</h1>
          <h2>Iniciar sesión</h2>
          <p>Ingresa con tu usuario corporativo para cargar tu dashboard según tu rol.</p>
        </div>

        <form onSubmit={onLogin} className="login-form">
          <label>
            Usuario
            <input
              type="text"
              value={credentials.username}
              onChange={(event) => setCredentials((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="ej. bryan.mercado"
              autoComplete="username"
              disabled={authLoading}
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={authLoading}
            />
          </label>

          {loginError && <div className="login-error">{loginError}</div>}

          <button className="login-submit" type="submit" disabled={authLoading}>
            {authLoading ? 'Validando...' : 'Entrar al sistema'}
          </button>
        </form>

        <div className="login-footnote">
          La vista y permisos se asignan automáticamente desde el backend.
        </div>
      </section>
    </main>
  );
}

export default LoginPage;
