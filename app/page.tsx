"use client";

import { useMemo, useState } from "react";

type Zone = "pinar" | "pista" | "jaima" | "lateral" | "front";

type BookingDraft = {
  date: string;
  fullName: string;
  people: number;
  phone: string;
  email: string;
  zone: Zone;
  arrival: string;
  bottles: number;
  observations: string;
  referral: string;
};

const initialRequest = `*TØTEM*
*Formulario de reserva*
*Copie, pegue y rellene estos datos por favor*

*Fecha:* 1/08/2026
*Un nombre y apellidos:* Rafael Márquez Sánchez
*Nº de personas:* 8
*Teléfono:* 617882780
*Correo Electrónico:* rafamarsan1996@gmail.com
*Zona preferida:* Zona Pinar (Arriba)
*Hora de llegada:* 18:00
*Nº de botellas:* 3`;

const defaultDraft: BookingDraft = {
  date: "01/08/2026",
  fullName: "Rafael Márquez Sánchez",
  people: 8,
  phone: "617882780",
  email: "rafamarsan1996@gmail.com",
  zone: "pinar",
  arrival: "18:00",
  bottles: 3,
  observations: "",
  referral: "Jose Garcia",
};

const zoneCopy: Record<Zone, { label: string; subtitle: string; prefix: string }> = {
  pinar: { label: "Pinar", subtitle: "Mesas 201–224", prefix: "2" },
  pista: { label: "Pista", subtitle: "Mesas 101–133", prefix: "1" },
  jaima: { label: "Jaima", subtitle: "Mesas J1–J4", prefix: "J" },
  lateral: { label: "Lateral escenario", subtitle: "Solo conciertos", prefix: "L" },
  front: { label: "Front Stage", subtitle: "Zona sectorizada", prefix: "F" },
};

const tables: Record<Zone, string[]> = {
  pinar: Array.from({ length: 12 }, (_, index) => String(201 + index)),
  pista: Array.from({ length: 12 }, (_, index) => String(101 + index)),
  jaima: ["J1", "J2", "J3", "J4"],
  lateral: ["L1", "L2", "L3", "L4", "L5", "L6"],
  front: ["F1", "F2", "F3", "F4", "F5", "F6"],
};

const unavailableTables = new Set(["204", "207", "106", "J3", "L2", "F4"]);

function valueFrom(text: string, labels: string[]) {
  const clean = text.replace(/\*/g, "");
  for (const label of labels) {
    const expression = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, "i");
    const match = clean.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function normalizeDate(value: string) {
  const parts = value.trim().split(/[./-]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return value.trim();
  const [day, month, shortYear] = parts;
  const year = shortYear < 100 ? 2000 + shortYear : shortYear;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function zoneFrom(value: string): Zone {
  if (/front/i.test(value)) return "front";
  if (/lateral|escenario/i.test(value)) return "lateral";
  if (/jaima/i.test(value)) return "jaima";
  if (/pista/i.test(value)) return "pista";
  return "pinar";
}

function parseRequest(text: string, previous: BookingDraft) {
  const date = valueFrom(text, ["Fecha"]);
  const fullName = valueFrom(text, ["(?:Un )?nombre y apellidos", "Nombre"]);
  const people = valueFrom(text, ["N[º°o]?\\.? de personas", "Personas"]);
  const phone = valueFrom(text, ["Tel[eé]fono"]);
  const email = valueFrom(text, ["Correo electr[oó]nico", "Email"]);
  const preferredZone = valueFrom(text, ["Zona preferida", "Zona"]);
  const arrival = valueFrom(text, ["Hora de llegada", "Llegada"]);
  const bottles = valueFrom(text, ["N[º°o]?\\.? de botellas", "Botellas"]);
  const observations = valueFrom(text, ["Observaciones", "Notas"]);
  const referral = valueFrom(text, ["Referente", "RRPP"]);

  const detected = [date, fullName, people, phone, email, preferredZone, arrival, bottles]
    .filter(Boolean).length;

  return {
    detected,
    draft: {
      date: date ? normalizeDate(date) : previous.date,
      fullName: fullName || previous.fullName,
      people: people ? Number(people.match(/\d+/)?.[0]) || previous.people : previous.people,
      phone: phone || previous.phone,
      email: email || previous.email,
      zone: preferredZone ? zoneFrom(preferredZone) : previous.zone,
      arrival: arrival.match(/[0-2]?\d:\d{2}/)?.[0] || previous.arrival,
      bottles: bottles ? Number(bottles.match(/\d+/)?.[0]) || previous.bottles : previous.bottles,
      observations: observations || previous.observations,
      referral: referral || previous.referral,
    },
  };
}

function eventForDate(date: string) {
  if (date === "30/07/2026") return "UKIYØ · Gonzalo Alhambra";
  if (date === "01/08/2026") return "YUGEN · GEMELIERS";
  return "Evento de TØTEM";
}

export default function Home() {
  const [rawRequest, setRawRequest] = useState(initialRequest);
  const [draft, setDraft] = useState<BookingDraft>(defaultDraft);
  const [detectedFields, setDetectedFields] = useState(8);
  const [parsed, setParsed] = useState(true);
  const [selectedTable, setSelectedTable] = useState("201");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  const afterCutoff = draft.arrival > "18:30";
  const isConcert = eventForDate(draft.date) !== "Evento de TØTEM";
  const eventName = eventForDate(draft.date);
  const currentTables = useMemo(() => tables[draft.zone], [draft.zone]);
  const availableCount = currentTables.filter((table) => !unavailableTables.has(table)).length;

  const bottlePrice = draft.zone === "front"
    ? (afterCutoff ? 150 : 130)
    : draft.zone === "lateral"
      ? (afterCutoff ? 120 : 100)
      : draft.zone === "pista"
        ? (afterCutoff ? 120 : 100)
        : (afterCutoff ? 100 : 80);
  const includedPeople = draft.bottles * 3;
  const extraPeople = Math.max(0, draft.people - includedPeople);
  const extraPrice = Math.min(extraPeople, draft.bottles) * 15;
  const standardPrice = draft.bottles * bottlePrice + extraPrice;
  const price = draft.zone === "jaima" ? Math.max(300, standardPrice) : standardPrice;
  const deposit = Math.round(price / 2);
  const maxCapacity = draft.bottles * 4;
  const capacityOk = draft.people <= maxCapacity;
  const requiredFieldsOk = Boolean(draft.date && draft.fullName && draft.email && draft.people && draft.bottles);

  function updateDraft<K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseZone(nextZone: Zone) {
    updateDraft("zone", nextZone);
    const firstAvailable = tables[nextZone].find((table) => !unavailableTables.has(table));
    setSelectedTable(firstAvailable || tables[nextZone][0]);
  }

  function analyzeRequest() {
    const result = parseRequest(rawRequest, draft);
    setDraft(result.draft);
    setDetectedFields(result.detected);
    const firstAvailable = tables[result.draft.zone].find((table) => !unavailableTables.has(table));
    setSelectedTable(firstAvailable || tables[result.draft.zone][0]);
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

        <div className="sync-card test-sync">
          <div className="sync-row"><span className="status-dot" /> API Alpha pendiente</div>
          <p>El conector se activará al recibir la clave</p>
        </div>

        <div className="profile">
          <div className="avatar">JG</div>
          <div><strong>Jose Garcia</strong><span>Administrador · TØTEM</span></div>
          <button aria-label="Abrir perfil">•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="test-badge"><span /> Simulación conectable a Alpha</div>
            <p className="eyebrow">Nueva reserva</p>
            <h1>Del mensaje a la mesa.</h1>
            <p className="test-description">Analiza el formulario, valida la zona y deja preparada la reserva para Fourvenues.</p>
          </div>
          <div className="event-chip">
            <span className="event-date"><b>{draft.date.slice(0, 2)}</b>{draft.date.slice(3, 5) === "08" ? "AGO" : "JUL"}</span>
            <span><small>Evento localizado</small><strong>{eventName}</strong></span>
            <span className="chevron">⌄</span>
          </div>
        </header>

        <div className="steps" aria-label="Progreso de reserva">
          <div className="step complete"><span>1</span><div><b>Solicitud recibida</b><small>{detectedFields} campos reconocidos</small></div></div>
          <div className="step-line complete" />
          <div className="step active"><span>2</span><div><b>Revisión y mesa</b><small>Estás aquí</small></div></div>
          <div className="step-line" />
          <div className="step"><span>3</span><div><b>Fourvenues</b><small>API Alpha pendiente</small></div></div>
        </div>

        <div className="content-grid">
          <section className="panel request-panel">
            <div className="panel-heading">
              <div><span className="panel-number">01</span><div><h2>Solicitud del cliente</h2><p>Pega el mensaje exactamente como lo recibes.</p></div></div>
              {parsed && <span className="success-badge">✓ {detectedFields} campos detectados</span>}
            </div>

            <textarea
              aria-label="Mensaje de reserva"
              value={rawRequest}
              onChange={(event) => { setRawRequest(event.target.value); setParsed(false); }}
              className="request-box"
            />
            <button className="analyze-button" onClick={analyzeRequest}><span>✦</span> Analizar solicitud</button>

            <div className="parsed-card">
              <div className="parsed-header"><h3>Datos interpretados</h3><span>Todos se pueden corregir</span></div>
              <div className="fields-grid">
                <label className="field wide"><span>Nombre y apellidos</span><input value={draft.fullName} onChange={(e) => updateDraft("fullName", e.target.value)} /></label>
                <label className="field"><span>Fecha</span><input value={draft.date} onChange={(e) => updateDraft("date", normalizeDate(e.target.value))} /></label>
                <label className="field"><span>Hora de llegada</span><input type="time" value={draft.arrival} onChange={(e) => updateDraft("arrival", e.target.value)} /></label>
                <label className="field"><span>Personas</span><input type="number" min="1" value={draft.people} onChange={(e) => updateDraft("people", Number(e.target.value))} /></label>
                <label className="field"><span>Botellas</span><input type="number" min="1" value={draft.bottles} onChange={(e) => updateDraft("bottles", Number(e.target.value))} /></label>
                <label className="field"><span>Teléfono</span><input value={draft.phone} onChange={(e) => updateDraft("phone", e.target.value)} /></label>
                <label className="field"><span>Correo electrónico</span><input type="email" value={draft.email} onChange={(e) => updateDraft("email", e.target.value)} /></label>
                <label className="field"><span>Referente / RRPP</span><select value={draft.referral} onChange={(e) => updateDraft("referral", e.target.value)}><option>Jose Garcia</option><option>RAUL ALFONSO</option><option>Sin asignar</option></select></label>
                <label className="field wide"><span>Observaciones internas</span><textarea value={draft.observations} placeholder="Ej.: No pagan entrada, botella Martin Miller gratis" onChange={(e) => updateDraft("observations", e.target.value)} /></label>
              </div>
            </div>
          </section>

          <section className="panel assignment-panel">
            <div className="panel-heading">
              <div><span className="panel-number">02</span><div><h2>Zona y mesa</h2><p>La zona detectada queda marcada para comprobarla.</p></div></div>
              <span className="availability"><i /> {availableCount} libres</span>
            </div>

            <div className="zone-selector five-zones">
              {(Object.keys(zoneCopy) as Zone[]).map((key) => (
                <button key={key} className={draft.zone === key ? "zone-card selected" : "zone-card"} onClick={() => chooseZone(key)}>
                  <span className="zone-radio" />
                  <b>{zoneCopy[key].label}</b>
                  <small>{zoneCopy[key].subtitle}</small>
                  {(key === "jaima" || key === "front") && <em>Especial</em>}
                </button>
              ))}
            </div>

            <div className="rule-note">
              <span>✓</span><div><b>Zona comprobada</b><p>{draft.zone === "jaima" ? "Jaima mantiene un consumo mínimo de 300 € y no se mezcla con Pinar." : draft.zone === "front" || draft.zone === "lateral" ? "Zona disponible únicamente en la configuración de concierto." : `Se buscarán únicamente mesas ${zoneCopy[draft.zone].subtitle.toLowerCase()}.`}</p></div>
            </div>

            <div className="table-heading"><div><h3>Elige una mesa</h3><p>Capacidad configurada: 9 personas</p></div><div className="legend"><span><i className="free" />Libre</span><span><i className="busy" />Ocupada</span></div></div>
            <div className="table-grid">
              {currentTables.map((table) => {
                const busy = unavailableTables.has(table);
                return <button key={table} disabled={busy} onClick={() => setSelectedTable(table)} className={`table-seat ${selectedTable === table ? "selected" : ""} ${busy ? "busy" : ""}`}><b>{table}</b><span>{busy ? "Ocupada" : "9 pax"}</span></button>;
              })}
            </div>

            <div className="summary-card">
              <div className="summary-top"><div><span className="mini-label">Resumen de Fourvenues</span><h3>Mesa {selectedTable} · {zoneCopy[draft.zone].label}</h3></div><span className="verified">✓ Compatible</span></div>
              <div className="summary-stats">
                <div><span>Personas</span><b>{draft.people}</b></div>
                <div><span>Botellas</span><b>{draft.bottles}</b></div>
                <div><span>Precio estimado</span><b>{price} €</b></div>
                <div><span>Adelanto</span><b>{deposit} €</b></div>
              </div>
              {!capacityOk && <p className="warning">Se permiten hasta {maxCapacity} personas con {draft.bottles} botella{draft.bottles === 1 ? "" : "s"}. Revisa personas o botellas.</p>}
              {isConcert && <p className="concert-note">La reserva de botella no incluye la entrada del concierto.</p>}
            </div>
          </section>
        </div>

        <section className="send-bar">
          <div className="fv-logo">F<span>V</span></div>
          <div className="send-copy"><span>Destino</span><b>Fourvenues · TØTEM Punta Umbría</b></div>
          <div className="send-details"><span><small>Evento</small>{draft.date}</span><span><small>Zona</small>{zoneCopy[draft.zone].label}</span><span><small>Mesa</small>{selectedTable}</span></div>
          <button className="send-button" disabled={!capacityOk || !parsed || !requiredFieldsOk} onClick={() => { setReviewed(false); setReviewOpen(true); }}>Revisar antes de crear <span>→</span></button>
        </section>
      </section>

      {reviewOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <div className="review-modal">
            <button className="modal-close" onClick={() => setReviewOpen(false)} aria-label="Cerrar">×</button>
            <div className="review-header">
              <span className="review-icon">◎</span>
              <div><p className="eyebrow">Simulación de la API</p><h2 id="review-title">Reserva lista para crear</h2></div>
              <span className="safe-pill">No enviada</span>
            </div>

            <div className="check-list" aria-label="Comprobaciones realizadas">
              <div><span>✓</span><p><b>Solicitud validada</b><small>{detectedFields} campos reconocidos y editables</small></p></div>
              <div><span>✓</span><p><b>Evento localizado</b><small>{draft.date} · {eventName}</small></p></div>
              <div><span>✓</span><p><b>Zona y tarifa comprobadas</b><small>{zoneCopy[draft.zone].label} · {price} € · adelanto {deposit} €</small></p></div>
              <div><span>✓</span><p><b>Mesa compatible preparada</b><small>Mesa {selectedTable} · {draft.people} personas · {draft.bottles} botellas</small></p></div>
              <div className="pending"><span>5</span><p><b>Conector Alpha pendiente</b><small>Al recibir la API key, este paso creará el booking en Fourvenues</small></p></div>
            </div>

            <div className="review-receipt">
              <div className="receipt-person"><span>Cliente</span><b>{draft.fullName}</b><small>{draft.phone || "Sin teléfono"} · {draft.email}</small></div>
              <div className="receipt-grid">
                <p><span>Evento</span><b>{eventName}</b></p>
                <p><span>Llegada</span><b>{draft.arrival || "Sin hora"}</b></p>
                <p><span>Ubicación</span><b>{zoneCopy[draft.zone].label} · Mesa {selectedTable}</b></p>
                <p><span>Personas / botellas</span><b>{draft.people} / {draft.bottles}</b></p>
                <p><span>Precio / adelanto</span><b>{price} € / {deposit} €</b></p>
                <p><span>Referente</span><b>{draft.referral}</b></p>
              </div>
              {draft.observations && <div className="receipt-observations"><span>Observaciones internas</span><b>{draft.observations}</b></div>}
            </div>

            <label className="review-check">
              <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
              <span>He revisado cliente, evento, zona, mesa e importes.</span>
            </label>
            <button className="blocked-action" disabled>
              {reviewed ? "Preparado · esperando API key Alpha" : "Revisa y marca la confirmación"}
            </button>
            <p className="duplicate-note">No se enviará ninguna reserva mientras el conector Alpha esté desactivado.</p>
            <button className="modal-action secondary" onClick={() => setReviewOpen(false)}>Volver a la reserva</button>
          </div>
        </div>
      )}
    </main>
  );
}
