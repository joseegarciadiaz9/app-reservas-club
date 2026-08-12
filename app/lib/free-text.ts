/**
 * Lectura de solicitudes escritas "a lo bruto": las que llegan por WhatsApp sin
 * el formulario, en cuatro líneas sueltas y sin una sola etiqueta.
 *
 *     Juanma Márquez
 *     Jueves 13
 *     15 pax
 *     Todos han. Comprado la entrada
 *     +34 627 57 43 11
 *
 * Devuelve los mismos campos en crudo que saca el lector de etiquetas, para que
 * luego pasen por el mismo normalizado (fecha, hora, zona). Solo rellena lo que
 * el lector de etiquetas haya dejado vacío: nunca pisa un dato explícito.
 */

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** Palabras que descartan una línea como nombre de persona. */
const NOT_A_NAME =
  /\d|pax|persona|botella|copa|zona|pinar|jaima|pista|arena|front|lateral|entrada|reserva|mesa|hola|gracias|buenas|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[ñn]ana|hoy/i;

function plain(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function ddmmyyyy(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** Mismo día del mes, a partir de hoy: si ya pasó, el mes que viene. */
function nextWithDay(day: number, today: Date): Date {
  const candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate.getDate() !== day || candidate < startOfDay(today)) {
    return new Date(today.getFullYear(), today.getMonth() + 1, day);
  }
  return candidate;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * "Jueves 13": se busca el próximo día 13 que además caiga en jueves, mirando
 * hasta un año vista. Si el cliente se equivocó de día de la semana no se le
 * lleva la contraria: manda el número, que es lo que la gente mira.
 */
function dayAndWeekday(day: number, weekday: number, today: Date): Date {
  const base = startOfDay(today);
  for (let ahead = 0; ahead < 13; ahead += 1) {
    const candidate = new Date(today.getFullYear(), today.getMonth() + ahead, day);
    if (candidate.getDate() !== day) continue;
    if (candidate < base) continue;
    if (candidate.getDay() === weekday) return candidate;
  }
  return nextWithDay(day, today);
}

/** Próximo día de la semana indicado ("el jueves"). */
function nextWeekday(weekday: number, today: Date): Date {
  const base = startOfDay(today);
  const delta = (weekday - base.getDay() + 7) % 7 || 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

function looseDate(text: string, today: Date): string {
  const t = plain(text);

  if (/\bpasado\s+manana\b/.test(t)) {
    return ddmmyyyy(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2));
  }
  if (/\bmanana\b/.test(t)) {
    return ddmmyyyy(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  }
  if (/\bhoy\b/.test(t)) return ddmmyyyy(today);
  if (/\besta\s+noche\b/.test(t)) return ddmmyyyy(today);

  // "jueves 13" o "13 jueves". El número no cuenta como día del mes si lo sigue
  // una unidad: en "el sábado 10 personas", el 10 son personas, no el día 10.
  const dias = Object.keys(WEEKDAYS).join("|");
  const noEsUnidad = "(?!\\s*(?:pax|persona|pers|gente|adulto|botella|bot\\b|copa))";
  const conNumero =
    t.match(new RegExp(`\\b(${dias})\\b[^\\d\\n]{0,10}(\\d{1,2})\\b${noEsUnidad}`)) ??
    t.match(new RegExp(`\\b(\\d{1,2})\\b${noEsUnidad}[^\\d\\n]{0,10}\\b(${dias})\\b`));
  if (conNumero) {
    const [, a, b] = conNumero;
    const weekday = WEEKDAYS[a] ?? WEEKDAYS[b];
    const day = Number(/^\d+$/.test(a) ? a : b);
    if (day >= 1 && day <= 31) return ddmmyyyy(dayAndWeekday(day, weekday, today));
  }

  const soloDia = t.match(new RegExp(`\\b(${dias})\\b`));
  if (soloDia) return ddmmyyyy(nextWeekday(WEEKDAYS[soloDia[1]], today));

  // "el 13" / una línea que es solo un número de día.
  const numeroSuelto = text.match(/(?:^|\n)\s*(?:el\s+)?(\d{1,2})\s*(?:$|\n)/);
  if (numeroSuelto) {
    const day = Number(numeroSuelto[1]);
    if (day >= 1 && day <= 31) return ddmmyyyy(nextWithDay(day, today));
  }

  return "";
}

/** Teléfono: 9 dígitos seguidos, con o sin +34 y con los espacios que sea. */
function loosePhone(text: string): string {
  const match = text.match(/(?:\+?\s*34[\s.\-]*)?(?:\d[\s.\-]*){9,}/);
  if (!match) return "";
  const digits = match[0].replace(/\D/g, "");
  const national = digits.length > 9 && digits.startsWith("34") ? digits.slice(2) : digits;
  return national.length >= 9 ? national.slice(0, 9) : "";
}

function looseNumber(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function looseName(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[*_]/g, "").trim();
    if (!line || line.length < 5 || NOT_A_NAME.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    // Dos o más palabras que empiezan por mayúscula: "Juanma Márquez".
    if (words.every((word) => /^[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü'’-]+$/.test(word))) return line;
  }
  return "";
}

const ZONE_WORDS = /\b(pinar|jaima|pista|arenas|front\s*stage|lateral)\b/i;

function looseZone(text: string): string {
  return text.match(ZONE_WORDS)?.[1] ?? "";
}

/**
 * La hora solo se acepta si va anunciada ("a las 12", "llegamos sobre las 2").
 * Un "18:37" suelto suele ser la marca de hora de WhatsApp al copiar el chat, y
 * colarla como hora de llegada sería peor que dejarla vacía.
 */
function looseArrival(text: string): string {
  const match = text.match(
    /\b(?:a\s+las|sobre\s+las|hacia\s+las|llegada|llegamos|llegan|entramos|entrada\s+a\s+las)\b\D{0,6}(\d{1,2}(?:\s*[:.h]\s*\d{0,2})?)/i,
  );
  return match?.[1] ?? "";
}

export interface LooseFields {
  date: string;
  fullName: string;
  people: string;
  phone: string;
  zone: string;
  arrival: string;
  bottles: string;
  observations: string;
}

export function looseFields(text: string, today = new Date()): LooseFields {
  const date = looseDate(text, today);
  const fullName = looseName(text);
  const people = looseNumber(text, [
    /(\d{1,3})\s*(?:pax|personas?|pers\b|gente|adultos?|chicas?|chicos?)/i,
    /\b(?:somos|seremos|vamos|iremos)\b\D{0,10}(\d{1,3})\b/i,
  ]);
  const phone = loosePhone(text);
  const zone = looseZone(text);
  const arrival = looseArrival(text);
  const bottles = /\b(?:a\s*copas|sin\s+botella)\b/i.test(text)
    ? (text.match(/\b(a\s*copas|sin\s+botella)\b/i)?.[1] ?? "")
    : looseNumber(text, [/(\d{1,2})\s*(?:botellas?|bot\b)/i]);

  // Lo que no se ha reconocido se conserva como observación en vez de tirarlo:
  // "Todos han comprado la entrada" cambia cómo se cobra en puerta.
  const usadas = [fullName, phone].filter(Boolean);
  const observations = text
    .split("\n")
    .map((line) => line.replace(/[*_]/g, "").trim())
    .filter((line) => {
      if (!line) return false;
      if (usadas.some((used) => line.includes(used))) return false;
      if (loosePhone(line)) return false;
      if (people && new RegExp(`^\\D{0,3}${people}\\s*(pax|personas?|pers)`, "i").test(line)) return false;
      if (date && looseDate(line, today) === date) return false;
      return true;
    })
    .join(" · ");

  return { date, fullName, people, phone, zone, arrival, bottles, observations };
}
