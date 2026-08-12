"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchEvents,
  fetchZones,
  getIntegrationStatus,
  requestBooking,
  toIsoDate,
} from "./lib/fourvenues-browser";
import {
  buildRequestInput,
  composeClientObservations,
  detectNoCharge,
  detectSpecialPricing,
  needsVenueReview,
  findZone,
  placementForZone,
  priceForRate,
  sellableSpaces,
  zoneRates,
  ZONE_MAPPINGS,
} from "./lib/booking-payload";
import { looseFields } from "./lib/free-text";
import type { FourvenuesEvent, FourvenuesRate, FourvenuesZone } from "./lib/fourvenues";

type Zone = "pinar" | "pista" | "jaima" | "lateral" | "front";
type TableStatus = "available" | "internal" | "blocked";

/**
 * Zona tal y como se pinta en pantalla. En simulación sale de las constantes de
 * abajo; conectados, de las zonas REALES que devuelve `GET /bookings/zones`.
 */
type DisplayTable = { name: string; status: TableStatus; capacity: number };
type DisplayZone = {
  key: string;
  label: string;
  subtitle: string;
  special?: boolean;
  tables: DisplayTable[];
  /** Solo en modo conectado. */
  live?: FourvenuesZone;
  rates?: FourvenuesRate[];
};

type BookingDraft = {
  date: string;
  fullName: string;
  people: number;
  phone: string;
  email: string;
  /** Clave de la zona: la del catálogo en simulación, el slug real si hay conexión. */
  zone: string;
  arrival: string;
  bottles: number;
  observations: string;
  referral: string;
  /** Texto de "botellas" cuando no es un número, p. ej. "A copas". */
  bottlesNote?: string;
};

/** La app arranca en blanco: el RRPP pega aquí la solicitud del cliente. */
const initialRequest = "";

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
  date: "",
  fullName: "",
  people: 0,
  phone: "",
  email: "",
  zone: "pinar",
  arrival: "",
  bottles: 0,
  observations: "",
  // Sin preseleccionar a nadie: la app la comparten todos los RRPP y dejar un
  // nombre fijo atribuiría las reservas a quien no es.
  referral: "Sin asignar",
  bottlesNote: "",
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

/**
 * Referentes (RRPP), escritos EXACTAMENTE como figuran en el panel de TØTEM
 * (Ajustes → Usuarios), respetando tildes. El referente no se puede asignar por
 * API, así que el nombre viaja en las observaciones: si no coincide con el del
 * panel, el local no sabe a quién atribuir la reserva.
 *
 * Entre paréntesis, el grupo que tienen en Fourvenues.
 */
const referrals = [
  "Jose Garcia", // RRPP 2
  "Raul Alfonso", // Directores
  "Pedro Fernandez Sampedro", // Directores · RRPP
  "José Cera", // Directores · RRPP
  "Rafa García", // RRPP 2
  "Diego Beas", // RRPP
  "Juan Márquez", // RRPP
  "Gonzalo Lopez Marquez", // RRPP 2
  "Sin asignar",
];

const internalTables = new Set(["202", "205", "109", "J2", "L5", "F2"]);
const blockedTables = new Set(["204", "207", "106", "J3", "L2", "F4"]);
const tableCapacity = 9;

function simulatedTableStatus(table: string): TableStatus {
  if (blockedTables.has(table)) return "blocked";
  if (internalTables.has(table)) return "internal";
  return "available";
}

/** Zonas del catálogo de simulación (sin conexión con Fourvenues). */
const simulatedZones: DisplayZone[] = (Object.keys(zoneCopy) as Zone[]).map((key) => ({
  key,
  label: zoneCopy[key].label,
  subtitle: zoneCopy[key].subtitle,
  special: key === "jaima" || key === "front",
  tables: tables[key].map((name) => ({
    name,
    status: simulatedTableStatus(name),
    capacity: tableCapacity,
  })),
}));

/** Convierte las zonas reales de la API en zonas pintables. */
function toDisplayZones(live: FourvenuesZone[]): DisplayZone[] {
  return live.map((zone) => {
    const rates = zoneRates(zone);
    const cheapest = rates.reduce<FourvenuesRate | undefined>(
      (best, rate) => (!best || rate.price < best.price ? rate : best),
      undefined,
    );
    const libres = sellableSpaces(zone).length;
    return {
      key: zone.slug || zone._id,
      label: zone.name,
      subtitle: [
        `${libres} mesa${libres === 1 ? "" : "s"}`,
        cheapest ? `desde ${cheapest.price} €` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      special: zone.is_full,
      tables: (zone.spaces ?? []).map((space) => ({
        name: space.name,
        capacity: space.capacity ?? tableCapacity,
        status:
          space.blocked || space.hidden || space.available === false ? "blocked" : "available",
      })),
      live: zone,
      rates,
    };
  });
}

/**
 * Una zona real de Fourvenues mezcla familias de mesas: PINAR contiene tanto
 * las jaimas (J1-J4) como las mesas numéricas (201-224). Si el cliente pidió
 * "Pinar" no se le puede colocar una jaima sin más, así que se prioriza la
 * familia que pidió y solo se sale de ella si no cabe el grupo.
 */
function suggestedCombination(
  zoneTables: DisplayTable[],
  people: number,
  preferredTable?: string,
  spacePattern?: RegExp,
) {
  const names = zoneTables.map((table) => table.name);
  const perTable = zoneTables[0]?.capacity || tableCapacity;
  const tablesNeeded = Math.max(1, Math.ceil(people / perTable));
  const isSellable = (name: string) =>
    zoneTables.find((table) => table.name === name)?.status !== "blocked";

  const preferredIndex = preferredTable ? names.indexOf(preferredTable) : -1;
  const allIndexes = names.map((_, index) => index);
  // Las que encajan con la familia pedida van primero; el resto, de reserva.
  const byFamily = spacePattern
    ? [
        ...allIndexes.filter((index) => spacePattern.test(names[index])),
        ...allIndexes.filter((index) => !spacePattern.test(names[index])),
      ]
    : allIndexes;
  const startIndexes = [preferredIndex, ...byFamily]
    .filter((index, position, values) => index >= 0 && values.indexOf(index) === position);

  for (const startIndex of startIndexes) {
    const group = names.slice(startIndex, startIndex + tablesNeeded);
    if (group.length === tablesNeeded && group.every(isSellable)) return group;
  }

  const firstSellable = names.find(isSellable);
  return firstSellable ? [firstSellable] : [];
}

function valueFrom(text: string, labels: string[]) {
  const clean = text.replace(/\*/g, "");
  for (const label of labels) {
    // `[^\S\n]*` = espacios y tabuladores, pero NO saltos de línea. Con `\s*` un
    // campo vacío se comía la línea siguiente: "Observaciones:" sin nada detrás
    // capturaba la instrucción de abajo, y "Correo electrónico:" vacío se quedaba
    // con "Zona preferida: …", que Fourvenues rechazaba por email no válido.
    const expression = new RegExp(`(?:^|\\n)[^\\S\\n]*${label}[^\\S\\n]*:[^\\S\\n]*([^\\n]+)`, "i");
    const match = clean.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

const monthWords: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8, agost: 8,
  septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

/** Sin acentos y en minúsculas, para comparar "Agosto", "agosto" y "AGOSTO". */
function plainText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Si el cliente no pone año, se elige el que hace que la fecha caiga cerca:
 * el actual, salvo que ya haya pasado hace meses (entonces es del año que viene).
 */
function guessYear(day: number, month: number, today: Date): number {
  const year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const seisMeses = 1000 * 60 * 60 * 24 * 180;
  if (candidate.getTime() < today.getTime() - seisMeses) return year + 1;
  return year;
}

/**
 * Interpreta la fecha escrita como sea. Cada cliente la manda a su manera:
 * "15/08/2026", "15-8-26", "15.08.26", "sabado 15/08", "13 agosto",
 * "13 de agosto de 2026", "13 ago", "2026-08-15"… Si no hay forma de
 * entenderla, se devuelve tal cual para que el RRPP la vea y la corrija.
 */
function normalizeDate(value: string, today = new Date()): string {
  const texto = plainText(value);
  const armar = (day: number, month: number, year: number) =>
    `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;

  // 2026-08-15 (formato ISO)
  const iso = texto.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return armar(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  // 15/08/2026 · 15-8-26 · 15.08.26
  const conAnio = texto.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/);
  if (conAnio) {
    const rawYear = Number(conAnio[3]);
    return armar(Number(conAnio[1]), Number(conAnio[2]), rawYear < 100 ? 2000 + rawYear : rawYear);
  }

  // 13 agosto · 13 de agosto · 13 de agosto de 2026 · 13 ago 26
  const conMes = texto.match(
    /(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?(?:\s*(?:de\s+|del\s+)?(\d{2,4}))?/,
  );
  if (conMes) {
    const month = monthWords[conMes[2]];
    if (month) {
      const day = Number(conMes[1]);
      const rawYear = conMes[3] ? Number(conMes[3]) : undefined;
      const year =
        rawYear === undefined
          ? guessYear(day, month, today)
          : rawYear < 100
            ? 2000 + rawYear
            : rawYear;
      return armar(day, month, year);
    }
  }

  // 15/08 · 15-8 (sin año)
  const sinAnio = texto.match(/(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?!\s*[/.\-]?\s*\d)/);
  if (sinAnio) {
    const day = Number(sinAnio[1]);
    const month = Number(sinAnio[2]);
    if (month >= 1 && month <= 12) return armar(day, month, guessYear(day, month, today));
  }

  return value.trim();
}

/** Hora de llegada escrita como sea: "00.00", "18h30", "18:00", "20 h". */
function normalizeTime(value: string): string {
  const match = value.match(/([0-2]?\d)\s*[:.hH]\s*([0-5]\d)/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  // "20h" o "20" a secas: hora en punto.
  const hourOnly = value.match(/\b([0-2]?\d)\s*h?\b/);
  return hourOnly ? `${hourOnly[1].padStart(2, "0")}:00` : "";
}

function zoneFrom(value: string): Zone {
  if (/front/i.test(value)) return "front";
  if (/lateral|escenario/i.test(value)) return "lateral";
  if (/jaima/i.test(value)) return "jaima";
  if (/pista/i.test(value)) return "pista";
  return "pinar";
}

function parseRequest(text: string, previous: BookingDraft) {
  // Muchas solicitudes no llegan con el formulario, sino en cuatro líneas
  // sueltas por WhatsApp. Lo que no traiga etiqueta se intenta deducir del
  // texto libre, pero la etiqueta siempre manda si existe.
  const suelto = looseFields(text);
  const orLoose = (labelled: string, loose: string) => labelled || loose;

  const date = orLoose(valueFrom(text, ["Fecha"]), suelto.date);
  const fullName = orLoose(
    valueFrom(text, ["(?:Un )?nombre y apellidos", "Nombre"]),
    suelto.fullName,
  );
  const people = orLoose(valueFrom(text, ["N[º°o]?\\.? de personas", "Personas"]), suelto.people);
  const phone = orLoose(valueFrom(text, ["Tel[eé]fono"]), suelto.phone);
  const email = valueFrom(text, ["Correo electr[oó]nico", "Email"]);
  const preferredZone = orLoose(valueFrom(text, ["Zona preferida", "Zona"]), suelto.zone);
  const arrival = orLoose(valueFrom(text, ["Hora de llegada", "Llegada"]), suelto.arrival);
  const bottles = orLoose(valueFrom(text, ["N[º°o]?\\.? de botellas", "Botellas"]), suelto.bottles);
  const observations = orLoose(
    valueFrom(text, ["Observaciones", "Notas"]),
    // Solo se usan las sobras como observación si el mensaje venía sin
    // etiquetas; en un formulario, lo no reconocido son las propias etiquetas.
    valueFrom(text, ["Fecha"]) ? "" : suelto.observations,
  );
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
      arrival: normalizeTime(arrival) || previous.arrival,
      bottles: bottles ? Number(bottles.match(/\d+/)?.[0]) || previous.bottles : previous.bottles,
      // "A copas", "sin botella"… no son un número: se conserva el texto tal cual
      // en vez de perderlo, y sirve para detectar que la revisa el local.
      bottlesNote: bottles && !/\d/.test(bottles) ? bottles : "",
      observations: observations || previous.observations,
      referral: referral || previous.referral,
    },
  };
}

/** Cómo llamamos a cada campo que puede rechazar la API. */
const fieldLabels: Record<string, string> = {
  email: "el correo electrónico",
  "info.email": "el correo electrónico",
  full_name: "el nombre",
  "info.full_name": "el nombre",
  phone: "el teléfono",
  "info.phone": "el teléfono",
  quantity: "el nº de personas",
  "info.quantity": "el nº de personas",
  birthdate: "la fecha de nacimiento",
  event_id: "el evento",
  zone_slug: "la zona",
  rate_slug: "la tarifa",
  table_id: "la mesa",
  redirect_url: "la URL de retorno",
  error_url: "la URL de error",
};

/**
 * Fourvenues devuelve "Validation Error" con el detalle en `details.errors`.
 * Sin ese detalle el RRPP no sabe qué corregir, así que lo desglosamos.
 */
function describeApiError(result: { error?: string; details?: unknown }, fallback: string): string {
  const errors = (result.details as { errors?: { field?: string; error?: string }[] } | null)
    ?.errors;
  if (errors?.length) {
    const detalles = errors.map((item) => {
      const label = fieldLabels[item.field ?? ""] ?? (item.field ? `«${item.field}»` : "un campo");
      if (/valid email/i.test(item.error ?? "")) return `${label} no es válido`;
      if (/required/i.test(item.error ?? "")) return `falta ${label}`;
      return `${label}: ${item.error ?? "valor no válido"}`;
    });
    return `Fourvenues ha rechazado la reserva — ${detalles.join("; ")}.`;
  }
  return result.error || fallback;
}

/**
 * Día del evento en hora del local, como "DD/MM/YYYY". Se compara con la fecha
 * del formulario, así que tiene que ser la fecha de Punta Umbría y no la UTC.
 */
function localDayOf(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const partes = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const buscar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${buscar("day")}/${buscar("month")}/${buscar("year")}`;
}

const monthNames = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/** "15/08/2026" → "AGO" (antes solo contemplaba julio y agosto). */
function monthLabel(date: string): string {
  const month = Number(date.slice(3, 5));
  return monthNames[month - 1] ?? "";
}

function eventForDate(date: string) {
  if (date === "30/07/2026") return "UKIYØ · Gonzalo Alhambra";
  if (date === "01/08/2026") return "YUGEN · GEMELIERS";
  return "Evento de TØTEM";
}

export default function Home() {
  const [rawRequest, setRawRequest] = useState(initialRequest);
  const [draft, setDraft] = useState<BookingDraft>(defaultDraft);
  const [detectedFields, setDetectedFields] = useState(0);
  const [parsed, setParsed] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [combineMode, setCombineMode] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [selectedRateSlug, setSelectedRateSlug] = useState<string | undefined>();
  const [integration, setIntegration] = useState<{ configured: boolean; baseUrl: string } | null>(null);
  const [liveEvents, setLiveEvents] = useState<FourvenuesEvent[] | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
  const [liveZones, setLiveZones] = useState<FourvenuesZone[] | null>(null);
  // La zona tal y como la pidió el cliente ("pinar", "jaima"…). `draft.zone` se
  // sobrescribe con el slug de la zona real, y ahí ya no se distingue si pidió
  // jaima o mesa de pinar: las dos viven dentro de la zona PINAR.
  const [requestedZoneKey, setRequestedZoneKey] = useState<string>(defaultDraft.zone);
  const [submit, setSubmit] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    /** Importe exacto que pedirá la pasarela, según la propia respuesta de la API. */
    totalAmount?: number;
    /** Aviso cuando el checkout aún no ha creado nada en el panel. */
    note?: string;
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

  // Con API key, la agenda completa de TØTEM se carga una sola vez: así el
  // desplegable de la cabecera los lista todos y el RRPP puede elegir sin tener
  // que acertar la fecha. Se pide en vivo, así que los eventos nuevos salen solos.
  useEffect(() => {
    if (!integration?.configured) return;
    let active = true;
    fetchEvents()
      .then((result) => {
        if (!active) return;
        const agenda = (result.success ? result.data ?? [] : [])
          .slice()
          .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
        setLiveEvents(agenda);
      })
      .catch(() => {
        /* Un fallo cargando la agenda no debe romper la pantalla. */
      });
    return () => {
      active = false;
    };
  }, [integration?.configured]);

  // La fecha del formulario manda: selecciona el evento de ese día si existe.
  // Se normaliza al comparar para que "13/8/26" encuentre el evento igual que
  // "13/08/2026"; una fecha a medias simplemente no casa con ninguno.
  useEffect(() => {
    if (!liveEvents?.length || !draft.date) return;
    const buscada = normalizeDate(draft.date);
    const match = liveEvents.find((event) => localDayOf(event.start_date) === buscada);
    setSelectedEventId((current) => (match ? match._id : current ? undefined : current));
    // Al encontrar el evento se deja la fecha en su forma canónica, para que el
    // campo, el día del chip y el evento digan lo mismo aunque el cliente la
    // hubiera escrito como "13 agosto".
    if (match && draft.date !== buscada) updateDraft("date", buscada);
  }, [liveEvents, draft.date]);

  // Zonas reales del evento seleccionado (cambia al elegir otro en la cabecera).
  useEffect(() => {
    if (!selectedEventId) {
      // Sin evento no puede haber zonas reales. Si no se limpian, se quedan las
      // del evento anterior y la pantalla se contradice: avisa de que no hay
      // evento mientras enseña zonas etiquetadas como "datos reales".
      setLiveZones(null);
      return;
    }
    let active = true;
    setLiveZones(null);
    fetchZones(selectedEventId)
      .then((zones) => {
        if (!active || !zones.success || !zones.data?.length) return;
        setLiveZones(zones.data);

        // Traduce la zona detectada en el formulario ("pinar", "jaima"…) a la
        // zona equivalente de ESTE evento, y recoloca tarifa y mesas sugeridas.
        const mapping = ZONE_MAPPINGS[draft.zone];
        const match = mapping ? findZone(zones.data, mapping.zoneAliases) : undefined;
        const target = match ?? zones.data[0];
        const key = target.slug || target._id;

        setDraft((current) => (current.zone === key ? current : { ...current, zone: key }));
        setSelectedRateSlug(zoneRates(target)[0]?.slug);
        setSelectedTables(
          suggestedCombination(
            toDisplayZones([target])[0].tables,
            draft.people,
            undefined,
            mapping?.spacePattern,
          ),
        );
      })
      .catch(() => {
        /* Igual: si fallan las zonas, la pantalla sigue usable. */
      });
    return () => {
      active = false;
    };
    // `draft.zone` y `draft.people` se leen a propósito sin estar en las
    // dependencias: solo hay que recargar al cambiar de evento, no cada vez que
    // el RRPP toca la zona o el número de personas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  const isAlpha = integration?.baseUrl.includes("alpha") ?? true;
  const connectionLabel = integration?.configured
    ? isAlpha
      ? "Conectado a Fourvenues (Alpha)"
      : "Conectado a Fourvenues (Producción)"
    : "Sin conectar";

  const afterCutoff = draft.arrival > "18:30";
  const isConcert = eventForDate(draft.date) !== "Evento de TØTEM";
  // Conectados mandan los datos reales; el catálogo solo cubre la simulación.
  const liveEvent = liveEvents?.find((event) => event._id === selectedEventId) ?? null;
  const eventName = liveEvent?.name || eventForDate(draft.date);
  // El desplegable solo aparece con datos reales; en simulación se pinta el texto.
  const eventPickerOptions = liveEvents ?? [];
  // Solo avisamos de "sin evento" si ya hay fecha; con la app en blanco no.
  const noLiveEvent = Boolean(integration?.configured) && Boolean(draft.date) && !liveEvent;

  // Si el formulario trae un referente que no está en la lista, se conserva como
  // opción extra en vez de descartarlo en silencio.
  const referralOptions = referrals.includes(draft.referral)
    ? referrals
    : [draft.referral, ...referrals];

  // Conectados: zonas y mesas reales del evento. Si no, el catálogo simulado.
  const displayZones = useMemo(
    () => (liveZones?.length ? toDisplayZones(liveZones) : simulatedZones),
    [liveZones],
  );
  const currentZone =
    displayZones.find((zone) => zone.key === draft.zone) ?? displayZones[0];
  const currentTables = currentZone?.tables ?? [];
  const isLive = Boolean(currentZone?.live);
  /** Familia de mesas que encaja con lo que pidió el cliente (jaima vs. numérica). */
  const requestedPattern = ZONE_MAPPINGS[requestedZoneKey]?.spacePattern;

  const statusOf = (table: string): TableStatus =>
    currentTables.find((item) => item.name === table)?.status ?? "available";
  const capacityOf = (table: string) =>
    currentTables.find((item) => item.name === table)?.capacity ?? tableCapacity;

  const sellableCount = currentTables.filter((table) => table.status !== "blocked").length;
  const selectedTablesLabel = selectedTables.join(" + ") || "sin elegir";
  const combinationUsesInternal = selectedTables.some((table) => statusOf(table) === "internal");
  const perTableCapacity = currentTables[0]?.capacity ?? tableCapacity;
  const tablesNeeded = Math.max(1, Math.ceil(draft.people / perTableCapacity));
  const selectedTableCapacity = selectedTables.reduce(
    (total, table) => total + capacityOf(table),
    0,
  );
  const tablesCapacityOk = selectedTableCapacity >= draft.people;

  // Tarifa: conectados la elige el RRPP entre las reales de la zona.
  const availableRates = currentZone?.rates ?? [];
  const activeRate =
    availableRates.find((rate) => rate.slug === selectedRateSlug) ?? availableRates[0];

  const simulatedBottlePrice = draft.zone === "front"
    ? (afterCutoff ? 150 : 130)
    : draft.zone === "lateral"
      ? (afterCutoff ? 120 : 100)
      : draft.zone === "pista"
        ? (afterCutoff ? 120 : 100)
        : (afterCutoff ? 100 : 80);
  const includedPeople = draft.bottles * 3;
  const extraPeople = Math.max(0, draft.people - includedPeople);
  const extraPrice = Math.min(extraPeople, draft.bottles) * 15;
  const standardPrice = draft.bottles * simulatedBottlePrice + extraPrice;
  const simulatedPrice = draft.zone === "jaima" ? Math.max(300, standardPrice) : standardPrice;

  // Con tarifa real, el importe lo calcula Fourvenues (precio + suplementos).
  const livePricing = activeRate ? priceForRate(activeRate, draft.people) : null;
  const price = livePricing?.price ?? simulatedPrice;
  // Lo que cobra el enlace ahora; el resto se liquida en puerta.
  const chargeNow = livePricing?.chargeNow ?? Math.round(price / 2);
  const pendingAtDoor = livePricing?.pendingAtDoor ?? Math.max(0, price - chargeNow);
  const maxCapacity = draft.bottles * 4;
  // Sin botellas ("a copas") no aplica el máximo de personas por botella.
  const bottleCapacityOk = Boolean(draft.bottlesNote) || draft.people <= maxCapacity;
  // La API exige un email válido; comprobarlo aquí evita un "Validation Error"
  // que no dice nada tras haber rellenado todo.
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim());
  // Qué falta para poder seguir. Se enumera en vez de dar un simple sí/no para
  // poder decírselo al RRPP: un botón gris sin explicación no hay quien lo use.
  const blockers: string[] = [];
  if (!parsed) blockers.push("pulsa «Analizar solicitud»");
  if (!draft.date) blockers.push("falta la fecha");
  if (!draft.fullName.trim()) blockers.push("falta el nombre del cliente");
  if (!draft.people) blockers.push("faltan las personas");
  // "A copas" vale como respuesta: no todas las reservas llevan botella.
  if (!draft.bottles && !draft.bottlesNote) blockers.push("faltan las botellas");
  if (!emailOk) blockers.push("el correo no es válido");
  // Cuando el local cierra la venta online de una zona para un evento (típico en
  // conciertos), Fourvenues la devuelve sin mesas vendibles y rechaza la reserva
  // con "This zone has reached its booking limit". Pedir "selecciona 2 mesas" en
  // ese caso manda al RRPP a buscar algo que no existe.
  const zoneClosed = isLive && sellableCount === 0;
  if (zoneClosed) {
    blockers.push(`Fourvenues no tiene mesas a la venta en ${currentZone?.label} para este evento`);
  } else if (!tablesCapacityOk) {
    blockers.push(`selecciona ${tablesNeeded} mesas para ${draft.people} personas`);
  }
  if (!bottleCapacityOk) blockers.push(`con ${draft.bottles} botellas caben ${maxCapacity} personas`);
  if (noLiveEvent) blockers.push("no hay evento ese día");
  const requiredFieldsOk = blockers.length === 0;

  // "No cobrar / 0 €": se detecta por las notas y decide el flujo (request vs checkout).
  // "No cobrar" y "a copas" van igual: las revisa el local antes de cobrar.
  const reviewText = `${draft.observations} ${draft.bottlesNote ?? ""}`;
  const noCharge = detectNoCharge(reviewText);
  const specialPricing = detectSpecialPricing(reviewText);
  const needsReview = needsVenueReview(reviewText);
  const canSubmitLive = Boolean(integration?.configured && liveEvent && liveZones?.length);

  function updateDraft<K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /**
   * Elegir evento en la cabecera fija también la fecha del formulario, para que
   * no queden contradiciéndose (y para que el resto de la pantalla cuadre).
   */
  function chooseEvent(eventId: string) {
    setSelectedEventId(eventId || undefined);
    const elegido = liveEvents?.find((event) => event._id === eventId);
    const dia = localDayOf(elegido?.start_date);
    if (dia) updateDraft("date", dia);
  }

  function chooseZone(nextZoneKey: string) {
    const nextZone = displayZones.find((zone) => zone.key === nextZoneKey);
    updateDraft("zone", nextZoneKey);
    setSelectedRateSlug(nextZone?.rates?.[0]?.slug);
    const perTable = nextZone?.tables[0]?.capacity ?? tableCapacity;
    setCombineMode(draft.people > perTable);
    setSelectedTables(suggestedCombination(nextZone?.tables ?? [], draft.people, undefined, requestedPattern));
  }

  function updatePeople(people: number) {
    updateDraft("people", people);
    setCombineMode(people > perTableCapacity);
    setSelectedTables(suggestedCombination(currentTables, people, selectedTables[0], requestedPattern));
  }

  function toggleCombineMode() {
    const nextMode = !combineMode;
    setCombineMode(nextMode);
    if (nextMode) setSelectedTables(suggestedCombination(currentTables, draft.people, selectedTables[0], requestedPattern));
    else setSelectedTables(selectedTables.slice(0, 1));
  }

  function selectTable(table: string) {
    if (statusOf(table) === "blocked") return;
    if (!combineMode) {
      setSelectedTables([table]);
      return;
    }

    const names = currentTables.map((item) => item.name);
    const tableIndex = names.indexOf(table);
    const selectedIndexes = selectedTables.map((item) => names.indexOf(item)).sort((a, b) => a - b);
    const isSelected = selectedTables.includes(table);

    if (isSelected) {
      if (selectedTables.length === 1) return;
      const isEdge = tableIndex === selectedIndexes[0] || tableIndex === selectedIndexes[selectedIndexes.length - 1];
      if (isEdge) setSelectedTables((current) => current.filter((item) => item !== table));
      return;
    }

    const isAdjacent = tableIndex === selectedIndexes[0] - 1 || tableIndex === selectedIndexes[selectedIndexes.length - 1] + 1;
    if (isAdjacent) {
      setSelectedTables((current) => [...current, table].sort((a, b) => names.indexOf(a) - names.indexOf(b)));
    } else {
      setSelectedTables([table]);
    }
  }

  /** Traduce la zona detectada por el parser a la zona que se está mostrando. */
  function displayKeyFor(appZoneKey: string): string {
    if (!liveZones?.length) return appZoneKey;
    const mapping = ZONE_MAPPINGS[appZoneKey];
    const match = mapping ? findZone(liveZones, mapping.zoneAliases) : undefined;
    const target = match ?? liveZones[0];
    return target.slug || target._id;
  }

  /** Aplica un borrador recién parseado ajustando zona, tarifa y mesas. */
  function applyParsed(result: ReturnType<typeof parseRequest>, forceCombine = false) {
    const zoneKey = displayKeyFor(result.draft.zone);
    const zone = displayZones.find((item) => item.key === zoneKey);
    const perTable = zone?.tables[0]?.capacity ?? tableCapacity;

    setDraft({ ...result.draft, zone: zoneKey });
    setRequestedZoneKey(result.draft.zone);
    setDetectedFields(result.detected);
    setSelectedRateSlug(zone?.rates?.[0]?.slug);
    setCombineMode(forceCombine || result.draft.people > perTable);
    setSelectedTables(
      suggestedCombination(
        zone?.tables ?? [],
        result.draft.people,
        undefined,
        ZONE_MAPPINGS[result.draft.zone]?.spacePattern,
      ),
    );
    setParsed(true);
  }

  function analyzeRequest() {
    applyParsed(parseRequest(rawRequest, draft));
  }

  function loadLargeGroupDemo() {
    setRawRequest(largeGroupRequest);
    applyParsed(parseRequest(largeGroupRequest, draft), true);
    setReviewOpen(false);
  }

  /**
   * Crea la reserva real en Fourvenues. Solo se usa con API key activa y datos
   * reales cargados; en simulación el botón queda desactivado (sin efectos).
   */
  async function submitBooking() {
    if (!canSubmitLive || !liveEvent || !liveZones) return;

    // La zona ya está elegida sobre datos reales: no hay que adivinarla.
    const placement = currentZone?.live
      ? placementForZone(currentZone.live, {
          tableName: selectedTables[0],
          rateSlug: activeRate?.slug,
          preferNoCharge: noCharge,
        })
      : null;
    if (!placement) {
      setSubmit({
        status: "error",
        message: "No se ha encontrado la zona o la tarifa en Fourvenues para esta selección.",
      });
      return;
    }

    const observations = composeClientObservations({
      arrival: draft.arrival,
      bottles: draft.bottlesNote ? undefined : draft.bottles,
      bottlesNote: draft.bottlesNote,
      referral: draft.referral,
      tables: selectedTables,
      internalNotes: draft.observations,
      noCharge,
      specialPricing,
    });
    const info = {
      full_name: draft.fullName,
      email: draft.email,
      phone: draft.phone || undefined,
      quantity: draft.people,
    };

    setSubmit({ status: "loading" });
    try {
      const result = await requestBooking(
        buildRequestInput({ eventId: liveEvent._id, placement, info, observations }),
      );
      if (!result.success) {
        throw new Error(describeApiError(result, "No se pudo crear la reserva."));
      }
      // Fourvenues calcula el precio por su cuenta; se enseña el suyo, no el
      // nuestro, para que el RRPP diga al cliente la cifra que verá el local.
      const registrado = result.data?.booking;
      setSubmit({
        status: "success",
        message: "Reserva registrada en Fourvenues, pendiente de confirmar.",
        totalAmount: registrado?.deposit,
        note: needsReview
          ? "Queda \"A revisar\": el local ajusta el importe antes de cobrar nada."
          : "Queda \"A revisar\" en el panel del local, que la confirma y gestiona el cobro. Ya está apuntada.",
      });
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
          <button
            className="logout-button"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
              window.location.replace("/login");
            }}
          >
            ⏻
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className={isLive || integration?.configured ? "test-badge live-badge" : "test-badge"}>
              <span />{" "}
              {isLive
                ? `Zonas reales de ${eventName}`
                : integration?.configured
                  // Conectados pero sin fecha aún: no es simulación, solo faltan datos.
                  ? "Conectado · pega una solicitud para empezar"
                  : "Simulación · sin conectar"}
            </div>
            <p className="eyebrow">Nueva reserva</p>
            <h1>Del mensaje a la mesa.</h1>
            <p className="test-description">Analiza el formulario, valida la zona y deja preparada la reserva para Fourvenues.</p>
          </div>
          <div className="event-chip">
            <span className="event-date">{draft.date ? <><b>{draft.date.slice(0, 2)}</b>{monthLabel(draft.date)}</> : <b>·</b>}</span>
            <span>
              <small>{eventPickerOptions.length > 0 ? "Elige el evento" : "Evento localizado"}</small>
              {eventPickerOptions.length > 0 ? (
                <select
                  className="event-select"
                  aria-label="Evento de Fourvenues"
                  value={selectedEventId ?? ""}
                  onChange={(event) => chooseEvent(event.target.value)}
                >
                  <option value="">— Sin elegir —</option>
                  {eventPickerOptions.map((option) => (
                    <option key={option._id} value={option._id}>
                      {localDayOf(option.start_date).slice(0, 5)} · {option.name}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{eventName}</strong>
              )}
            </span>
            {eventPickerOptions.length === 0 && <span className="chevron">⌄</span>}
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
              placeholder="Pega aquí el formulario que te ha enviado el cliente por WhatsApp…"
              value={rawRequest}
              onChange={(event) => { setRawRequest(event.target.value); setParsed(false); }}
              className="request-box"
            />
            <button className="analyze-button" onClick={analyzeRequest}><span>✦</span> Analizar solicitud</button>

            <div className="parsed-card">
              <div className="parsed-header"><h3>Datos interpretados</h3><span>Todos se pueden corregir</span></div>
              <div className="fields-grid">
                <label className="field wide"><span>Nombre y apellidos</span><input value={draft.fullName} onChange={(e) => updateDraft("fullName", e.target.value)} /></label>
                {/* Se ordena al salir del campo, no en cada tecla: normalizando
                    mientras se escribe, "13/08/20" se convertía en 2020 y ya no
                    se podía terminar de teclear el año. */}
                <label className="field"><span>Fecha</span><input value={draft.date} placeholder="DD/MM/AAAA" onChange={(e) => updateDraft("date", e.target.value)} onBlur={(e) => updateDraft("date", normalizeDate(e.target.value))} /></label>
                <label className="field"><span>Hora de llegada</span><input type="time" value={draft.arrival} onChange={(e) => updateDraft("arrival", e.target.value)} /></label>
                <label className="field"><span>Personas</span><input type="number" min="1" value={draft.people} onChange={(e) => updatePeople(Number(e.target.value))} /></label>
                <label className="field"><span>Botellas</span><input type="number" min="1" value={draft.bottles} onChange={(e) => updateDraft("bottles", Number(e.target.value))} />{draft.bottlesNote && <small className="field-hint">El formulario decía «{draft.bottlesNote}»: se enviará ese texto, no el número.</small>}</label>
                <label className="field"><span>Teléfono</span><input value={draft.phone} onChange={(e) => updateDraft("phone", e.target.value)} /></label>
                <label className="field"><span>Correo electrónico</span><input type="email" value={draft.email} onChange={(e) => updateDraft("email", e.target.value)} />{draft.email.trim() !== "" && !emailOk && <small className="field-error">Fourvenues rechazará la reserva si el correo no es válido. Revísalo en el mensaje del cliente.</small>}</label>
                <label className="field"><span>Referente / RRPP</span><select value={draft.referral} onChange={(e) => updateDraft("referral", e.target.value)}>{referralOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                <label className="field wide"><span>Observaciones internas {needsReview && <em className="no-charge-badge">{noCharge ? "Sin cobro detectado" : "A copas · revisa el local"}</em>}</span><textarea value={draft.observations} placeholder="Ej.: No pagan entrada, botella Martin Miller gratis" onChange={(e) => updateDraft("observations", e.target.value)} />{needsReview && <small className="field-hint">Se enviará como solicitud: queda &quot;A revisar&quot; en Fourvenues y el local ajusta el importe. Sin cobro automático.</small>}</label>
              </div>
            </div>
          </section>

          <section className="panel assignment-panel">
            <div className="panel-heading">
              <div><span className="panel-number">02</span><div><h2>Zona y mesa</h2><p>La zona detectada queda marcada para comprobarla.</p></div></div>
              <span className="availability"><i /> {sellableCount} vendibles</span>
            </div>

            {noLiveEvent && (
              <p className="no-event-note">
                No hay ningún evento de TØTEM el {draft.date}. Las zonas de abajo son de
                ejemplo: cambia la fecha para cargar las reales.
              </p>
            )}

            <div className={`zone-selector ${displayZones.length > 4 ? "five-zones" : ""}`}>
              {displayZones.map((zone) => (
                <button key={zone.key} className={currentZone?.key === zone.key ? "zone-card selected" : "zone-card"} onClick={() => chooseZone(zone.key)}>
                  <span className="zone-radio" />
                  <b>{zone.label}</b>
                  <small>{zone.subtitle}</small>
                  {zone.special && <em>{isLive ? "Completa" : "Especial"}</em>}
                </button>
              ))}
            </div>

            {isLive && availableRates.length > 1 && (
              <div className="rate-selector">
                <span className="mini-label">Tarifa</span>
                <div className="rate-options">
                  {availableRates.map((rate) => (
                    <button
                      key={rate.slug}
                      type="button"
                      className={activeRate?.slug === rate.slug ? "rate-chip selected" : "rate-chip"}
                      onClick={() => setSelectedRateSlug(rate.slug)}
                    >
                      <b>{rate.name}</b>
                      <small>{rate.price} € · {rate.included_persons} pax incl.</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isLive ? (
              <div className="rule-note">
                <span>✓</span><div><b>Datos reales de Fourvenues</b><p>Zonas, mesas y tarifas de este evento. {currentZone?.live?.can_select_client ? "Esta zona permite fijar la mesa concreta." : "Esta zona no permite fijar mesa por API: la asignará el local (se indica en las notas)."}</p></div>
              </div>
            ) : (
              <div className="rule-note">
                <span>✓</span><div><b>Regla de venta interna aplicada</b><p>Los puntos rojos indican mesas ocultas en la web pero vendibles por RRPP. Las rayas rojas indican mesas bloqueadas para todo el mundo.</p></div>
              </div>
            )}

            <div className="table-heading"><div><h3>Elige una mesa</h3><p>Capacidad configurada: {perTableCapacity} personas por mesa</p></div><div className="table-heading-actions">{!isLive && <button type="button" className="demo-button" onClick={loadLargeGroupDemo}><span>20</span> Probar grupo</button>}<div className="legend"><span><i className="free" />Pública</span>{!isLive && <span><i className="internal" />Solo RRPP</span>}<span><i className="busy" />{isLive ? "No disponible" : "Bloqueada"}</span></div></div></div>
            <div className={`combine-control ${draft.people > perTableCapacity ? "recommended" : ""}`}>
              <button type="button" className={combineMode ? "combine-button active" : "combine-button"} onClick={toggleCombineMode} aria-pressed={combineMode}>
                <span>⇄</span> Combinar mesas
              </button>
              <p>{draft.people > perTableCapacity ? `${draft.people} personas requieren al menos ${tablesNeeded} mesas contiguas.` : combineMode ? "Selecciona una mesa vecina para añadirla a la combinación." : "Actívalo para reservar varias mesas contiguas juntas."}</p>
              {combineMode && <button type="button" className="suggest-button" onClick={() => setSelectedTables(suggestedCombination(currentTables, draft.people, selectedTables[0], requestedPattern))}>Aplicar sugerencia</button>}
            </div>
            <div className="table-grid">
              {currentTables.map((table) => {
                const blocked = table.status === "blocked";
                const selected = selectedTables.includes(table.name);
                const statusLabel = selected && selectedTables.length > 1 ? "Combinada" : table.status === "internal" ? "Solo RRPP" : blocked ? "No vendible" : `${table.capacity} pax`;
                return <button key={table.name} disabled={blocked} onClick={() => selectTable(table.name)} className={`table-seat ${selected ? "selected" : ""} ${selected && selectedTables.length > 1 ? "combined" : ""} ${table.status}`} aria-label={`Mesa ${table.name}, ${statusLabel}`} aria-pressed={selected}><b>{table.name}</b><span>{statusLabel}</span></button>;
              })}
            </div>

            <div className="summary-card">
              <div className="summary-top"><div><span className="mini-label">Resumen de Fourvenues</span><h3>{selectedTables.length > 1 ? "Mesas" : "Mesa"} {selectedTablesLabel} · {currentZone?.label}</h3></div><span className={combinationUsesInternal ? "verified internal-badge" : "verified"}>{selectedTables.length > 1 ? `⇄ ${selectedTables.length} combinadas` : combinationUsesInternal ? "● Solo RRPP" : "✓ Pública"}</span></div>
              <div className="summary-stats">
                <div><span>Personas</span><b>{draft.people}</b></div>
                <div><span>Capacidad mesas</span><b>{selectedTableCapacity} pax</b></div>
                <div><span>{isLive ? "Precio (según Fourvenues)" : "Precio estimado"}</span><b>{price} €</b></div>
                <div><span>Adelanto</span><b>{chargeNow} €</b></div>
              </div>
              {isLive && activeRate && <p className="rate-note">Tarifa <b>{activeRate.name}</b>: {activeRate.price} € con {activeRate.included_persons} personas incluidas{activeRate.supplement_price ? ` · +${activeRate.supplement_price} € por persona extra` : ""}. Adelanto {chargeNow} €{activeRate.fee_quantity ? ` (incluye ${activeRate.fee_quantity}% de gestión)` : ""}{pendingAtDoor > 0 ? `; los ${pendingAtDoor} € restantes se pagan en puerta` : ""}.</p>}
              {zoneClosed ? (
                <p className="warning">Fourvenues no ofrece ninguna mesa de {currentZone?.label} para este evento: el local tiene cerrada la venta online de esta zona. Aunque en el panel se vean mesas libres, la API responde &quot;This zone has reached its booking limit&quot;. Esta reserva hay que crearla desde Fourvenues.</p>
              ) : !tablesCapacityOk ? (
                <p className="warning">Faltan mesas: selecciona {tablesNeeded} mesas contiguas para alojar a {draft.people} personas.</p>
              ) : null}
              {!bottleCapacityOk && <p className="warning">Se permiten hasta {maxCapacity} personas con {draft.bottles} botella{draft.bottles === 1 ? "" : "s"}. Revisa personas o botellas.</p>}
              {isConcert && <p className="concert-note">La reserva de botella no incluye la entrada del concierto.</p>}
            </div>
          </section>
        </div>

        <section className="send-bar">
          <div className="fv-logo">F<span>V</span></div>
          <div className="send-copy"><span>Destino</span><b>Fourvenues · TØTEM Punta Umbría</b></div>
          <div className="send-details"><span><small>Evento</small>{draft.date}</span><span><small>Zona</small>{currentZone?.label}</span><span><small>{selectedTables.length > 1 ? "Mesas" : "Mesa"}</small>{selectedTablesLabel}</span></div>
          <div className="send-action">
            <button className="send-button" disabled={!requiredFieldsOk} onClick={() => { setReviewed(false); setReviewOpen(true); }}>Revisar antes de crear <span>→</span></button>
            {blockers.length > 0 && <small className="send-blockers">Para continuar: {blockers.join("; ")}.</small>}
          </div>
        </section>
      </section>

      {reviewOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <div className="review-modal">
            <button className="modal-close" onClick={() => setReviewOpen(false)} aria-label="Cerrar">×</button>
            <div className="review-header">
              <span className="review-icon">◎</span>
              <div><p className="eyebrow">{canSubmitLive ? "Fourvenues · TØTEM Punta Umbría" : "Conector desactivado"}</p><h2 id="review-title">{submit.status === "success" ? "Reserva enviada" : "Reserva lista para crear"}</h2></div>
              <span className={submit.status === "success" ? "safe-pill sent" : "safe-pill"}>{submit.status === "success" ? "Enviada" : "No enviada"}</span>
            </div>

            <div className="check-list" aria-label="Comprobaciones realizadas">
              <div><span>✓</span><p><b>Solicitud validada</b><small>{detectedFields} campos reconocidos y editables</small></p></div>
              <div><span>✓</span><p><b>Evento localizado</b><small>{draft.date} · {eventName}</small></p></div>
              <div><span>✓</span><p><b>Zona y tarifa comprobadas</b><small>{currentZone?.label} · {price} € en total · {chargeNow} € de adelanto</small></p></div>
              <div><span>✓</span><p><b>{selectedTables.length > 1 ? "Mesas combinadas preparadas" : "Mesa compatible preparada"}</b><small>{selectedTables.length > 1 ? `Mesas ${selectedTablesLabel}` : `Mesa ${selectedTablesLabel}`} · {combinationUsesInternal ? "incluye venta interna RRPP" : "venta pública"} · {draft.people} personas</small></p></div>
              {canSubmitLive ? (
                <div><span>✓</span><p><b>Conector Fourvenues activo</b><small>{needsReview ? "Entrará en Fourvenues como \"A revisar\" y el local ajusta el importe (sin cobro)." : `Entrará en Fourvenues como "A revisar": ${price} € con ${chargeNow} € de adelanto. El local la confirma y cobra desde el panel.`}</small></p></div>
              ) : (
                <div className="pending"><span>5</span><p><b>{noLiveEvent ? "Sin evento para esa fecha" : "Conector pendiente"}</b><small>{noLiveEvent ? "Elige una fecha con evento para poder crear la reserva." : "Al configurar la API key, este paso creará el booking en Fourvenues."}</small></p></div>
              )}
            </div>

            <div className="review-receipt">
              <div className="receipt-person"><span>Cliente</span><b>{draft.fullName}</b><small>{draft.phone || "Sin teléfono"} · {draft.email}</small></div>
              <div className="receipt-grid">
                <p><span>Evento</span><b>{eventName}</b></p>
                <p><span>Llegada</span><b>{draft.arrival || "Sin hora"}</b></p>
                <p><span>Ubicación</span><b>{currentZone?.label} · {selectedTables.length > 1 ? "Mesas" : "Mesa"} {selectedTablesLabel}</b></p>
                <p><span>Personas / botellas</span><b>{draft.people} / {draft.bottlesNote || draft.bottles}</b></p>
                <p><span>Total / adelanto</span><b>{price} € / {chargeNow} €</b></p>
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
                {submit.totalAmount != null && (
                  <p className="submit-amount">Adelanto según Fourvenues: <b>{submit.totalAmount} €</b>. El resto se cobra en puerta.</p>
                )}
                {submit.note && <p className="submit-note">{submit.note}</p>}
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
                      : needsReview
                        ? "Solicitar reserva sin cobro"
                        : "Crear reserva en Fourvenues"}
                </button>
                <p className="duplicate-note">{needsReview ? "Irá como solicitud: el local la confirma y ajusta el importe desde el panel." : "La reserva queda registrada en Fourvenues al momento, pendiente de que el local la confirme."}</p>
              </>
            ) : (
              <>
                <button className="blocked-action" disabled>
                  {noLiveEvent ? "Sin evento: elige otra fecha" : reviewed ? "Preparado · falta configurar la API" : "Revisa y marca la confirmación"}
                </button>
                <p className="duplicate-note">{noLiveEvent ? "No hay evento en esa fecha, así que no se puede crear la reserva." : "No se enviará ninguna reserva mientras el conector esté desactivado."}</p>
              </>
            )}
            <button className="modal-action secondary" onClick={() => setReviewOpen(false)}>Volver a la reserva</button>
          </div>
        </div>
      )}
    </main>
  );
}
