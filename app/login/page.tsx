"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError("Contraseña incorrecta.");
        setPassword("");
        return;
      }
      // El destino llega como ?next=... cuando se interceptó una ruta protegida.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next && next.startsWith("/") ? next : "/");
    } catch {
      setError("No se ha podido conectar. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark">TØTEM</span>
          <span className="brand-subtitle">Reservas</span>
        </div>
        <h1>Acceso interno</h1>
        <p className="login-note">Herramienta de RRPP. Introduce la contraseña del equipo.</p>

        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="analyze-button" disabled={!password || loading}>
          {loading ? "Comprobando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
