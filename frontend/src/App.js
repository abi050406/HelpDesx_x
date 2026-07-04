import React, { useState } from 'react';
import LoginPage from './components/Auth/LoginPage'; // Ajusta la ruta si es necesario

function App() {
  // 1. Definición estricta del estado de credenciales
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });
  const [loginError, setLoginError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // 2. Manejador del cambio en inputs (Resuelve el problema de "n is not a function")
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCredentials((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  // 3. Manejador del envío del formulario
  const handleLogin = (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setLoginError(null);

    // Simulación de autenticación local basada en tus usuarios de prueba
    setTimeout(() => {
      const { username, password } = credentials;
      if (
        (username === 'bryan.mercado' && password === 'admin123') ||
        (username === 'juan.perez' && password === 'tech123') ||
        (username === 'ana.lopez' && password === 'user123')
      ) {
        alert(`¡Bienvenido de nuevo, ${username}!`);
        // Aquí cambias el estado global para ingresar al dashboard correspondiente
      } else {
        setLoginError('Credenciales incorrectas. Verifica el usuario o la contraseña.');
      }
      setAuthLoading(false);
    }, 1000);
  };

  return (
    <div className="App">
      {/* Mapeo exacto de las propiedades requeridas por tu componente */}
      <LoginPage
        credentials={credentials}
        onChange={handleInputChange} // <-- Cambiado de onChangeCredentials a onChange
        onLogin={handleLogin}
        error={loginError}
        loading={authLoading}
      />
    </div>
  );
}

export default App;
