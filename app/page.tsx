"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createCheckout,
  fetchEvents,
  fetchZones,
  getIntegrationStatus,
  requestBooking,
  toIsoDate,
} from "./lib/fourvenues-browser";
import {
  buildCheckoutInput,
  buildRequestInput,
  composeClientObservations,
  detectNoCharge,
  resolveBookingMode,
  resolvePlacement,
} from "./lib/booking-payload";
import type { FourvenuesEvent, FourvenuesZone } from "./lib/fourvenues";

type Zone = "pinar" | "pista" | "jaima" | "lateral" | "front";
type TableStatus = "available" | "internal" | "blocked";

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

const largeGroupRequest = `*TØTEM*
*Formulario de reserva*

*Fecha:* 01/08/2026
*Un nombre y apellidos:* Grupo de prueba TØTEM
*Nº de personas:* 20
*Teléfono:* 600000000
*Correo Electrónico:* prueba@totem.es
*Zona preferida:* Pinar
*Hora de llegada:* 18:00
*Nº de botellas:* 5
*Observaciones:* Prueba interna de mesas combinadas`;

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

const internalTables = new Set(["202", "205", "109", "J2", "L5", "F2"]);
const blockedTables = new Set(["204", "207", "106", "J3", "L2", "F4"]);
const tableCapacity = 9;

function tableStatus(table: string): TableStatus {
  if (blockedTables.has(table)) return "blocked";
  if (internalTables.has(table)) return "internal";
  return "available";
}

function suggestedCombination(zone: Zone, people: number, preferredTable?: string) {
  const zoneTables = tables[zone];
  const tablesNeeded = Math.max(1, Math.ceil(people / tableCapacity));
  const preferredIndex = preferredTable ? zoneTables.indexOf(preferredTable) : -1;
  const startIndexes = [preferredIndex, ...zoneTables.map((_, index) => index)]
    .filter((index, position, values) => index >= 0 && values.indexOf(index) === position);

  for (const startIndex of startIndexes) {
    const group = zoneTables.slice(startIndex, startIndex + tablesNeeded);
    if (group.length === tablesNeeded && group.every((table) => tableStatus(table) !== "blocked")) return group;
  }

  const firstSellable = zoneTables.find((table) => tableStatus(table) !== "blocked");
  return firstSellable ? [firstSellable] : [];
}

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
  const [selectedTables, setSelectedTables] = useState<string[]>(["201"]);
  const [combineMode, setCombineMode] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [integration, setIntegration] = useState<{ configured: boolean; baseUrl: string } | null>(null);
  const [liveEvent, setLiveEvent] = useState<FourvenuesEvent | null>(null);
  const [liveZones, setLiveZones] = useState<FourvenuesZone[] | null>(null);
  const [submit, setSubmit] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    paymentUrl?: string;
  }>({ status: "idle" });

  useEffect(() => {
    let active = true;
    getIntegrationStatus()
      .then((result) => {
        if (active && result.success && result.data) setIntegration(result.data);
      })
      .catch(() => {
        /* Sin conexión con el backend: se mantiene el modo simulación. */
      });
    return () => {
      active = false;
    };
  }, []);

  // Solo cuando hay API key: localiza el evento de la fecha y carga sus zonas
  // reales. En simulación no se ejecuta y la UI sigue con datos hardcodeados.
  useEffect(() => {
    if (!integration?.configured || !draft.date) return;
    let active = true;
    setLiveEvent(null);
    setLiveZones(null);
    (async () => {
      const events = await fetchEvents(toIsoDate(draft.date));
      if (!active || !events.success || !events.data?.length) return;
      const event = events.data[0];
      setLiveEvent(event);
      const zones = await fetchZones(event._id);
      if (active && zones.success && zones.data) setLiveZones(zones.data);
    })().catch(() => {
      /* Un fallo cargando datos reales no debe romper la pantalla. */
    });
    return () => {
      active = false;
    };
  }, [integration?.configured, draft.date]);

  const isAlpha = integration?.baseUrl.includes("alpha") ?? true;
  const connectionLabel = integration?.configured
    ? isAlpha
      ? "Conectado a Fourvenues (Alpha)"
      : "Conectado a Fourvenues (Producción)"
    : "API Alpha pendiente";

  const afterCutoff = draft.arrival > "18:30";
  const isConcert = eventForDate(draft.date) !== "Evento de TØTEM";
  const eventName = eventForDate(draft.date);
  const currentTables = useMemo(() => tables[draft.zone], [draft.zone]);
  const sellableCount = currentTables.filter((table) => tableStatus(table) !== "blocked").length;
  const selectedTablesLabel = selectedTables.join(" + ");
  const combinationUsesInternal = selectedTables.some((table) => tableStatus(table) === "internal");
  const tablesNeeded = Math.max(1, Math.ceil(draft.people / tableCapacity));
  const selectedTableCapacity = selectedTables.length * tableCapacity;
  const tablesCapacityOk = selectedTableCapacity >= draft.people;

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
  const bottleCapacityOk = draft.people <= maxCapacity;
  const requiredFieldsOk = Boolean(draft.date && draft.fullName && draft.email && draft.people && draft.bottles);

  // "No cobrar / 0 €": se detecta por las notas y decide el flujo (request vs checkout).
  const noCharge = detectNoCharge(draft.observations);
  const bookingMode = resolveBookingMode(noCharge);
  const canSubmitLive = Boolean(integration?.configured && liveEvent && liveZones?.length);

  function updateDraft<K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseZone(nextZone: Zone) {
    updateDraft("zone", nextZone);
    const shouldCombine = draft.people > tableCapacity;
    setCombineMode(shouldCombine);
    setSelectedTables(suggestedCombination(nextZone, draft.people));
  }

  function updatePeople(people: number) {
    updateDraft("people", people);
    const shouldCombine = people > tableCapacity;
    setCombineMode(shouldCombine);
    setSelectedTables(suggestedCombination(draft.zone, people, selectedTables[0]));
  }

  function toggleCombineMode() {
    const nextMode = !combineMode;
    setCombineMode(nextMode);
    if (nextMode) setSelectedTables(suggestedCombination(draft.zone, draft.people, selectedTables[0]));
    else setSelectedTables(selectedTables.slice(0, 1));
  }

  function selectTable(table: string) {
    if (tableStatus(table) === "blocked") return;
    if (!combineMode) {
      setSelectedTables([table]);
      return;
    }

    const tableIndex = currentTables.indexOf(table);
    const selectedIndexes = selectedTables.map((item) => currentTables.indexOf(item)).sort((a, b) => a - b);
    const isSelected = selectedTables.includes(table);

    if (isSelected) {
      if (selectedTables.length === 1) return;
      const isEdge = tableIndex === selectedIndexes[0] || tableIndex === selectedIndexes[selectedIndexes.length - 1];
      if (isEdge) setSelectedTables((current) => current.filter((item) => item !== table));
      return;
    }

    const isAdjacent = tableIndex === selectedIndexes[0] - 1 || tableIndex === selectedIndexes[selectedIndexes.length - 1] + 1;
    if (isAdjacent) {
      setSelectedTables((current) => [...current, table].sort((a, b) => currentTables.indexOf(a) - currentTables.indexOf(b)));
    } else {
      setSelectedTables([table]);
    }
  }

  function analyzeRequest() {
    const result = parseRequest(rawRequest, draft);
    setDraft(result.draft);
    setDetectedFields(result.detected);
    const shouldCombine = result.draft.people > tableCapacity;
    setCombineMode(shouldCombine);
    setSelectedTables(suggestedCombination(result.draft.zone, result.draft.people));
    setParsed(true);
  }

  function loadLargeGroupDemo() {
    const result = parseRequest(largeGroupRequest, draft);
    setRawRequest(largeGroupRequest);
    setDraft(result.draft);
    setDetectedFields(result.detected);
    setCombineMode(true);
    setSelectedTables(suggestedCombination(result.draft.zone, result.draft.people));
    setParsed(true);
    setReviewOpen(false);
  }

  /**
   * Crea la reserva real en Fourvenues. Solo se usa con API key activa y datos
   * reales cargados; en simulación el botón queda desactivado (sin efectos).
   */
  async function submitBooking() {
    if (!canSubmitLive || !liveEvent || !liveZones) return;

    const placement = resolvePlacement(liveZones, {
      zoneKey: draft.zone,
      tableName: selectedTables[0],
    });
    if (!placement) {
      setSubmit({
        status: "error",
        message: "No se ha encontrado la zona o la tarifa en Fourvenues para esta selección.",
      });
      return;
    }

    const observations = composeClientObservations({
      arrival: draft.arrival,
      bottles: draft.bottles,
      referral: draft.referral,
      tables: selectedTables,
      internalNotes: draft.observations,
      noCharge,
    });
    const info = {
      full_name: draft.fullName,
      email: draft.email,
      phone: draft.phone || undefined,
      quantity: draft.people,
    };

    setSubmit({ status: "loading" });
    try {
      if (bookingMode === "request") {
        const result = await requestBooking(
          buildRequestInput({ eventId: liveEvent._id, placement, info, observations }),
        );
        if (!result.success) throw new Error(result.error || "No se pudo solicitar la reserva.");
        setSubmit({
          status: "success",
          message: "Reserva solicitada. El local debe aceptarla desde el panel (sin cobro).",
        });
      } else {
        const origin = typeof window !== "undefined" ? window.location.origin : undefined;
        const result = await createCheckout(
          buildCheckoutInput({
            eventId: liveEvent._id,
            placement,
            info,
            observations,
            redirectUrl: origin,
            errorUrl: origin,
          }),
        );
        if (!result.success || !result.data) {
          throw new Error(result.error || "No se pudo crear el checkout.");
        }
        setSubmit({
          status: "success",
          message: "Reserva creada. Enlace de pago listo para enviar al cliente.",
          paymentUrl: result.data.payment_url,
        });
      }
    } catch (error) {
      setSubmit({
        status: "error",
        message: error instanceof Error ? error.message : "Error al crear la reserva.",
      });
    }
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

        <div className={integration?.configured ? "sync-card" : "sync-card test-sync"}>
          <div className="sync-row"><span className="status-dot" /> {connectionLabel}</div>
          <p>{integration?.configured ? "El conector está activo y creará la reserva en Fourvenues." : "El conector se activará al recibir la clave"}</p>
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
          <div className="step"><span>3</span><div><b>Fourvenues</b><small>{connectionLabel}</small></div></div>
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
                <label className="field"><span>Personas</span><input type="number" min="1" value={draft.people} onChange={(e) => updatePeople(Number(e.target.value))} /></label>
                <label className="field"><span>Botellas</span><input type="number" min="1" value={draft.bottles} onChange={(e) => updateDraft("bottles", Number(e.target.value))} /></label>
                <label className="field"><span>Teléfono</span><input value={draft.phone} onChange={(e) => updateDraft("phone", e.target.value)} /></label>
                <label className="field"><span>Correo electrónico</span><input type="email" value={draft.email} onChange={(e) => updateDraft("email", e.target.value)} /></label>
                <label className="field"><span>Referente / RRPP</span><select value={draft.referral} onChange={(e) => updateDraft("referral", e.target.value)}><option>Jose Garcia</option><option>RAUL ALFONSO</option><option>Sin asignar</option></select></label>
                <label className="field wide"><span>Observaciones internas {noCharge && <em className="no-charge-badge">Sin cobro detectado</em>}</span><textarea value={draft.observations} placeholder="Ej.: No pagan entrada, botella Martin Miller gratis" onChange={(e) => updateDraft("observations", e.target.value)} />{noCharge && <small className="field-hint">Se enviará como solicitud (la confirma el local), sin cobro automático.</small>}</label>
              </div>
            </div>
          </section>

          <section className="panel assignment-panel">
            <div className="panel-heading">
              <div><span className="panel-number">02</span><div><h2>Zona y mesa</h2><p>La zona detectada queda marcada para comprobarla.</p></div></div>
              <span className="availability"><i /> {sellableCount} vendibles</span>
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
              <span>✓</span><div><b>Regla de venta interna aplicada</b><p>Los puntos rojos indican mesas ocultas en la web pero vendibles por RRPP. Las rayas rojas indican mesas bloqueadas para todo el mundo.</p></div>
            </div>

            <div className="table-heading"><div><h3>Elige una mesa</h3><p>Capacidad configurada: {tableCapacity} personas por mesa</p></div><div className="table-heading-actions"><button type="button" className="demo-button" onClick={loadLargeGroupDemo}><span>20</span> Probar grupo</button><div className="legend"><span><i className="free" />Pública</span><span><i className="internal" />Solo RRPP</span><span><i className="busy" />Bloqueada</span></div></div></div>
            <div className={`combine-control ${draft.people > tableCapacity ? "recommended" : ""}`}>
              <button type="button" className={combineMode ? "combine-button active" : "combine-button"} onClick={toggleCombineMode} aria-pressed={combineMode}>
                <span>⇄</span> Combinar mesas
              </button>
              <p>{draft.people > tableCapacity ? `${draft.people} personas requieren al menos ${tablesNeeded} mesas contiguas.` : combineMode ? "Selecciona una mesa vecina para añadirla a la combinación." : "Actívalo para reservar varias mesas contiguas juntas."}</p>
              {combineMode && <button type="button" className="suggest-button" onClick={() => setSelectedTables(suggestedCombination(draft.zone, draft.people, selectedTables[0]))}>Aplicar sugerencia</button>}
            </div>
            <div className="table-grid">
              {currentTables.map((table) => {
                const status = tableStatus(table);
                const blocked = status === "blocked";
                const selected = selectedTables.includes(table);
                const statusLabel = selected && selectedTables.length > 1 ? "Combinada" : status === "internal" ? "Solo RRPP" : blocked ? "No vendible" : `${tableCapacity} pax`;
                return <button key={table} disabled={blocked} onClick={() => selectTable(table)} className={`table-seat ${selected ? "selected" : ""} ${selected && selectedTables.length > 1 ? "combined" : ""} ${status}`} aria-label={`Mesa ${table}, ${statusLabel}`} aria-pressed={selected}><b>{table}</b><span>{statusLabel}</span></button>;
              })}
            </div>

            <div className="summary-card">
              <div className="summary-top"><div><span className="mini-label">Resumen de Fourvenues</span><h3>{selectedTables.length > 1 ? "Mesas" : "Mesa"} {selectedTablesLabel} · {zoneCopy[draft.zone].label}</h3></div><span className={combinationUsesInternal ? "verified internal-badge" : "verified"}>{selectedTables.length > 1 ? `⇄ ${selectedTables.length} combinadas` : combinationUsesInternal ? "● Solo RRPP" : "✓ Pública"}</span></div>
              <div className="summary-stats">
                <div><span>Personas</span><b>{draft.people}</b></div>
                <div><span>Capacidad mesas</span><b>{selectedTableCapacity} pax</b></div>
                <div><span>Precio estimado</span><b>{price} €</b></div>
                <div><span>Adelanto</span><b>{deposit} €</b></div>
              </div>
              {!tablesCapacityOk && <p className="warning">Faltan mesas: selecciona {tablesNeeded} mesas contiguas para alojar a {draft.people} personas.</p>}
              {!bottleCapacityOk && <p className="warning">Se permiten hasta {maxCapacity} personas con {draft.bottles} botella{draft.bottles === 1 ? "" : "s"}. Revisa personas o botellas.</p>}
              {isConcert && <p className="concert-note">La reserva de botella no incluye la entrada del concierto.</p>}
            </div>
          </section>
        </div>

        <section className="send-bar">
          <div className="fv-logo">F<span>V</span></div>
          <div className="send-copy"><span>Destino</span><b>Fourvenues · TØTEM Punta Umbría</b></div>
          <div className="send-details"><span><small>Evento</small>{draft.date}</span><span><small>Zona</small>{zoneCopy[draft.zone].label}</span><span><small>{selectedTables.length > 1 ? "Mesas" : "Mesa"}</small>{selectedTablesLabel}</span></div>
          <button className="send-button" disabled={!bottleCapacityOk || !tablesCapacityOk || !parsed || !requiredFieldsOk} onClick={() => { setReviewed(false); setReviewOpen(true); }}>Revisar antes de crear <span>→</span></button>
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
              <div><span>✓</span><p><b>{selectedTables.length > 1 ? "Mesas combinadas preparadas" : "Mesa compatible preparada"}</b><small>{selectedTables.length > 1 ? `Mesas ${selectedTablesLabel}` : `Mesa ${selectedTablesLabel}`} · {combinationUsesInternal ? "incluye venta interna RRPP" : "venta pública"} · {draft.people} personas</small></p></div>
              {canSubmitLive ? (
                <div><span>✓</span><p><b>Conector Fourvenues activo</b><small>{noCharge ? "Se enviará como SOLICITUD sin cobro (la confirma el local)." : "Se creará la reserva con enlace de pago (checkout)."}</small></p></div>
              ) : (
                <div className="pending"><span>5</span><p><b>Conector Alpha pendiente</b><small>Al recibir la API key, este paso creará el booking en Fourvenues</small></p></div>
              )}
            </div>

            <div className="review-receipt">
              <div className="receipt-person"><span>Cliente</span><b>{draft.fullName}</b><small>{draft.phone || "Sin teléfono"} · {draft.email}</small></div>
              <div className="receipt-grid">
                <p><span>Evento</span><b>{eventName}</b></p>
                <p><span>Llegada</span><b>{draft.arrival || "Sin hora"}</b></p>
                <p><span>Ubicación</span><b>{zoneCopy[draft.zone].label} · {selectedTables.length > 1 ? "Mesas" : "Mesa"} {selectedTablesLabel}</b></p>
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

            {submit.status === "success" ? (
              <div className="submit-result success">
                <b>✓ {submit.message}</b>
                {submit.paymentUrl && (
                  <a className="payment-link" href={submit.paymentUrl} target="_blank" rel="noopener noreferrer">Abrir enlace de pago →</a>
                )}
              </div>
            ) : canSubmitLive ? (
              <>
                {submit.status === "error" && <p className="submit-result error">{submit.message}</p>}
                <button
                  className="modal-action primary"
                  disabled={!reviewed || submit.status === "loading"}
                  onClick={submitBooking}
                >
                  {submit.status === "loading"
                    ? "Creando reserva…"
                    : !reviewed
                      ? "Revisa y marca la confirmación"
                      : noCharge
                        ? "Solicitar reserva sin cobro"
                        : "Crear reserva y generar enlace de pago"}
                </button>
                <p className="duplicate-note">{noCharge ? "Irá como solicitud: el local la confirma desde el panel." : "Se generará un enlace de pago para enviar al cliente."}</p>
              </>
            ) : (
              <>
                <button className="blocked-action" disabled>
                  {reviewed ? "Preparado · esperando API key Alpha" : "Revisa y marca la confirmación"}
                </button>
                <p className="duplicate-note">No se enviará ninguna reserva mientras el conector Alpha esté desactivado.</p>
              </>
            )}
            <button className="modal-action secondary" onClick={() => setReviewOpen(false)}>Volver a la reserva</button>
          </div>
        </div>
      )}
    </main>
  );
}
