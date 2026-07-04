import React from 'react';

// Asegúrate de que las props se llamen exactamente así:
export default function LoginPage({ credentials, onChangeCredentials, onLogin, error, loading }) {
  return (
    <div className="login-container"> {/* Tus clases CSS originales se quedan igual */}
      <form onSubmit={onLogin} className="login-form">
        <h2>HelpDesk_X</h2>
        
        {error && <div className="error-message">{error}</div>}

        <label>Usuario</label>
        <input
          type="text"
          name="username"
          value={credentials.username || ''}
          onChange={(e) => onChangeCredentials({ ...credentials, username: e.target.value })} // Usa directamente la prop aquí
          disabled={loading}
          required
        />

        <label>Contraseña</label>
        <input
          type="password"
          name="password"
          value={credentials.password || ''}
          onChange={(e) => onChangeCredentials({ ...credentials, password: e.target.value })} // Usa directamente la prop aquí
          disabled={loading}
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Cargando...' : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
}
