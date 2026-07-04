import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('helpdesk_x_theme') || 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('helpdesk_x_theme', theme); }, [theme]);
  const value = useMemo(() => ({ theme, setTheme, toggleTheme: () => setTheme((v) => v === 'dark' ? 'light' : 'dark') }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
