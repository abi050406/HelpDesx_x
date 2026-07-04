import React from 'react';

export default function LoginPage({ credentials, onChange, onLogin, error, loading }) {
  return (
    <div className="login-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#0f172a', color: '#fff' }}>
      <form onSubmit={onLogin} style={{ display: 'flex', flexDirection: 'column', width: '320px', padding: '2rem', borderRadius: '8px', backgroundColor: '#1e293b', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: '#38bdf8' }}>HelpDesk_X</h2>
        
        {error && (
          <div style={{ backgroundColor: '#ef444422', color: '#f87171', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.875rem', border: '1px solid #ef444444' }}>
            {error}
          </div>
        )}

        <label style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#94a3b8' }}>Usuario</label>
        <input
          type="text"
          name="username" /* <-- Clave para mapear el estado dinámicamente */
          value={credentials.username || ''}
          onChange={onChange} /* <-- Provoca el error si no se pasa correctamente desde App.js */
          disabled={loading}
          placeholder="ej: bryan.mercado"
          required
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff', marginBottom: '1rem', outline: 'none' }}
        />

        <label style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: '#94a3b8' }}>Contraseña</label>
        <input
          type="password"
          name="password" /* <-- Clave para mapear el estado dinámicamente */
          value={credentials.password || ''}
          onChange={onChange} /* <-- Provoca el error si no se pasa correctamente desde App.js */
          disabled={loading}
          placeholder="••••••••"
          required
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #334155', backgroundColor: '#0f172a', color: '#fff', marginBottom: '1.5rem', outline: 'none' }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{ padding: '0.75rem', borderRadius: '4px', border: 'none', backgroundColor: loading ? '#64748b' : '#0284c7', color: '#fff', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', transition: 'background-color 0.2s' }}
        >
          {loading ? 'Cargando...' : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
}
