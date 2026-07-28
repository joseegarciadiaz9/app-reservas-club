"use client";

import { useMemo, useState } from "react";

type Zone = "pinar" | "pista" | "jaima";

const initialRequest = `*TØTEM*
*Formulario de reserva*

*Fecha:* 1/08/2026
*Un nombre y apellidos:* Rafael Márquez Sánchez
*Nº de personas:* 8
*Teléfono:* 617882780
*Correo Electrónico:* rafamarsan1996@gmail.com
*Zona preferida:* Zona Pinar (Arriba)
*Hora de llegada:* 18:00
*Nº de botellas:* 3`;

const zoneCopy: Record<Zone, { label: string; subtitle: string }> = {
  pinar: { label: "Pinar", subtitle: "Mesas 201–224" },
  pista: { label: "Pista", subtitle: "Mesas 101–133" },
  jaima: { label: "Jaima", subtitle: "Mesas J1–J4" },
};

const tables: Record<Zone, string[]> = {
  pinar: ["201", "202", "203", "204", "205", "206", "207", "208", "209"],
  pista: ["101", "102", "103", "104", "105", "106", "107", "108", "109"],
  jaima: ["J1", "J2", "J3", "J4"],
};

export default function Home() {
  const [rawRequest, setRawRequest] = useState(initialRequest);
  const [parsed, setParsed] = useState(true);
  const [zone, setZone] = useState<Zone>("pinar");
  const [selectedTable, setSelectedTable] = useState("201");
  const [people, setPeople] = useState(8);
  const [bottles, setBottles] = useState(3);
  const [arrival, setArrival] = useState("18:00");
  const [submitted, setSubmitted] = useState(false);

  const afterCutoff = arrival > "18:30";
  const bottlePrice = zone === "pista" ? (afterCutoff ? 120 : 100) : afterCutoff ? 100 : 80;
  const price = zone === "jaima" ? Math.max(300, bottles * 80) : bottles * bottlePrice;
  const deposit = Math.round(price / 2);
  const maxCapacity = zone === "jaima" ? 8 : bottles * 4;
  const capacityOk = people <= maxCapacity;

  const currentTables = useMemo(() => tables[zone], [zone]);

  function chooseZone(nextZone: Zone) {
    setZone(nextZone);
    setSelectedTable(tables[nextZone][0]);
  }

  function analyzeRequest() {
    const peopleMatch = rawRequest.match(/personas:\*?\s*(\d+)/i);
    const bottlesMatch = rawRequest.match(/botellas:\*?\s*(\d+)/i);
    const arrivalMatch = rawRequest.match(/llegada:\*?\s*([0-2]?\d:\d{2})/i);
    if (peopleMatch) setPeople(Number(peopleMatch[1]));
    if (bottlesMatch) setBottles(Number(bottlesMatch[1]));
    if (arrivalMatch) setArrival(arrivalMatch[1]);
    if (/jaima/i.test(rawRequest)) chooseZone("jaima");
    else if (/pista|escenario/i.test(rawRequest)) chooseZone("pista");
    else chooseZone("pinar");
    setParsed(true);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TØTEM</span>
          <span className="brand-subtitle">Reservas</span>
        </div>

        <nav className="side-nav" aria-label="Navegación principal">
          <button className="nav-item active"><span className="nav-icon">＋</span>Nueva reserva</button>
          <button className="nav-item"><span className="nav-icon">◫</span>Historial</button>
          <button className="nav-item"><span className="nav-icon">◎</span>Reglas y zonas</button>
        </nav>

        <div className="sync-card">
          <div className="sync-row"><span className="status-dot" /> Fourvenues conectado</div>
          <p>Última comprobación ahora</p>
        </div>

        <div className="profile">
          <div className="avatar">JG</div>
          <div><strong>Jose Garcia</strong><span>RRPP · TØTEM</span></div>
          <button aria-label="Abrir perfil">•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Nueva reserva</p>
            <h1>Revisa. Ubica. Confirma.</h1>
          </div>
          <div className="event-chip">
            <span className="event-date"><b>01</b>AGO</span>
            <span><small>Evento seleccionado</small><strong>YUGEN · GEMELIERS</strong></span>
            <span className="chevron">⌄</span>
          </div>
        </header>

        <div className="steps" aria-label="Progreso de reserva">
          <div className="step complete"><span>1</span><div><b>Solicitud recibida</b><small>Datos reconocidos</small></div></div>
          <div className="step-line complete" />
          <div className="step active"><span>2</span><div><b>Revisión y mesa</b><small>Estás aquí</small></div></div>
          <div className="step-line" />
          <div className="step"><span>3</span><div><b>Fourvenues</b><small>Confirmación final</small></div></div>
        </div>

        <div className="content-grid">
          <section className="panel request-panel">
            <div className="panel-heading">
              <div><span className="panel-number">01</span><div><h2>Solicitud del cliente</h2><p>Pega el mensaje tal como lo recibes.</p></div></div>
              {parsed && <span className="success-badge">✓ 8 campos detectados</span>}
            </div>

            <textarea
              aria-label="Mensaje de reserva"
              value={rawRequest}
              onChange={(event) => { setRawRequest(event.target.value); setParsed(false); }}
              className="request-box"
            />
            <button className="analyze-button" onClick={analyzeRequest}><span>✦</span> Analizar solicitud</button>

            <div className="parsed-card">
              <div className="parsed-header"><h3>Datos interpretados</h3><span>Listo para revisar</span></div>
              <div className="fields-grid">
                <label className="field wide"><span>Nombre y apellidos</span><input value="Rafael Márquez Sánchez" readOnly /></label>
                <label className="field"><span>Fecha</span><input value="01 ago 2026" readOnly /></label>
                <label className="field"><span>Hora de llegada</span><input value={arrival} onChange={(e) => setArrival(e.target.value)} /></label>
                <label className="field"><span>Personas</span><input type="number" min="1" value={people} onChange={(e) => setPeople(Number(e.target.value))} /></label>
                <label className="field"><span>Botellas</span><input type="number" min="1" value={bottles} onChange={(e) => setBottles(Number(e.target.value))} /></label>
                <label className="field wide"><span>Contacto</span><input value="617 882 780 · rafamarsan1996@gmail.com" readOnly /></label>
              </div>
            </div>
          </section>

          <section className="panel assignment-panel">
            <div className="panel-heading">
              <div><span className="panel-number">02</span><div><h2>Ubicación inteligente</h2><p>Solo se muestran mesas compatibles.</p></div></div>
              <span className="availability"><i /> 26 libres</span>
            </div>

            <div className="zone-selector">
              {(Object.keys(zoneCopy) as Zone[]).map((key) => (
                <button key={key} className={zone === key ? "zone-card selected" : "zone-card"} onClick={() => chooseZone(key)}>
                  <span className="zone-radio" />
                  <b>{zoneCopy[key].label}</b>
                  <small>{zoneCopy[key].subtitle}</small>
                  {key === "jaima" && <em>Especial</em>}
                </button>
              ))}
            </div>

            <div className="rule-note">
              <span>✓</span><div><b>Regla aplicada</b><p>{zone === "pinar" ? "Las mesas J1–J4 están bloqueadas: pertenecen a Jaima." : zone === "jaima" ? "Reserva especial con consumo mínimo de 300 €." : "Solo mesas de Pista 101–133."}</p></div>
            </div>

            <div className="table-heading"><div><h3>Elige una mesa</h3><p>Capacidad recomendada: 9 personas</p></div><div className="legend"><span><i className="free" />Libre</span><span><i className="busy" />Ocupada</span></div></div>
            <div className="table-grid">
              {currentTables.map((table) => {
                const busy = table === "204" || table === "106" || table === "J3";
                return <button key={table} disabled={busy} onClick={() => setSelectedTable(table)} className={`table-seat ${selectedTable === table ? "selected" : ""} ${busy ? "busy" : ""}`}><b>{table}</b><span>{busy ? "Ocupada" : "9 pax"}</span></button>;
              })}
            </div>

            <div className="summary-card">
              <div className="summary-top"><div><span className="mini-label">Resumen</span><h3>Mesa {selectedTable} · {zoneCopy[zone].label}</h3></div><span className="verified">✓ Compatible</span></div>
              <div className="summary-stats">
                <div><span>Personas</span><b>{people}</b></div>
                <div><span>Botellas</span><b>{bottles}</b></div>
                <div><span>Precio</span><b>{price} €</b></div>
                <div><span>Adelanto</span><b>{deposit} €</b></div>
              </div>
              {!capacityOk && <p className="warning">Revisa la capacidad: esta configuración admite hasta {maxCapacity} personas.</p>}
            </div>
          </section>
        </div>

        <section className="send-bar">
          <div className="fv-logo">F<span>V</span></div>
          <div className="send-copy"><span>Destino</span><b>Fourvenues · TØTEM Punta Umbría</b></div>
          <div className="send-details"><span><small>Evento</small>01/08/2026</span><span><small>Zona</small>{zoneCopy[zone].label}</span><span><small>Mesa</small>{selectedTable}</span></div>
          <button className="send-button" disabled={!capacityOk} onClick={() => setSubmitted(true)}>Crear reserva <span>→</span></button>
        </section>
      </section>

      {submitted && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="success-title">
          <div className="success-modal">
            <button className="modal-close" onClick={() => setSubmitted(false)} aria-label="Cerrar">×</button>
            <div className="success-icon">✓</div>
            <p className="eyebrow">Simulación completada</p>
            <h2 id="success-title">La reserva está lista</h2>
            <p>En la versión conectada, aquí se enviaría a Fourvenues con la mesa <b>{selectedTable}</b> y el adelanto de <b>{deposit} €</b>.</p>
            <div className="modal-receipt"><span>Rafael Márquez Sánchez</span><strong>{price} €</strong></div>
            <button className="modal-action" onClick={() => setSubmitted(false)}>Volver al preview</button>
          </div>
        </div>
      )}
    </main>
  );
}
