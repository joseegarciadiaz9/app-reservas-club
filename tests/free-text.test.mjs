import assert from "node:assert/strict";
import test from "node:test";

import { looseFields } from "../app/lib/free-text.ts";

/** Miércoles 12 de agosto de 2026, para que las fechas relativas sean fijas. */
const hoy = new Date(2026, 7, 12);

test("el mensaje suelto de WhatsApp que mandó un RRPP", () => {
  const campos = looseFields(
    `Juanma Márquez
Jueves 13
15 pax
Todos han. Comprado la entrada
+34 627 57 43 11`,
    hoy,
  );

  assert.equal(campos.fullName, "Juanma Márquez");
  // El 13/08/2026 cae en jueves, así que "Jueves 13" no es ambiguo.
  assert.equal(campos.date, "13/08/2026");
  assert.equal(campos.people, "15");
  assert.equal(campos.phone, "627574311");
  assert.match(campos.observations, /Comprado la entrada/);
});

test("no confunde la marca de hora de WhatsApp con la hora de llegada", () => {
  // Al copiar del chat se cuela la hora del mensaje; sin un "a las" delante no
  // se puede tratar como hora de llegada.
  assert.equal(looseFields("Jueves 13\n15 pax\n18:37", hoy).arrival, "");
  assert.equal(looseFields("Jueves 13, llegamos a las 18:30", hoy).arrival, "18:30");
});

test("fechas relativas", () => {
  assert.equal(looseFields("mañana somos 8", hoy).date, "13/08/2026");
  assert.equal(looseFields("pasado mañana", hoy).date, "14/08/2026");
  assert.equal(looseFields("hoy 6 pax", hoy).date, "12/08/2026");
  // "sábado" a secas: el siguiente, no el de hace tres días.
  assert.equal(looseFields("el sábado 10 personas", hoy).date, "15/08/2026");
});

test("un día ya pasado salta al mes siguiente", () => {
  // El 5 de agosto ya pasó el día 12, así que se entiende septiembre.
  assert.equal(looseFields("el 5\n10 pax", hoy).date, "05/09/2026");
});

test("cuenta personas escrita de varias formas", () => {
  assert.equal(looseFields("somos 12", hoy).people, "12");
  assert.equal(looseFields("12 personas", hoy).people, "12");
  assert.equal(looseFields("seremos unos 20 pax", hoy).people, "20");
});

test("botellas y mesas a copas", () => {
  assert.equal(looseFields("2 botellas", hoy).bottles, "2");
  assert.equal(looseFields("van a copas", hoy).bottles, "a copas");
});

test("teléfono con y sin prefijo", () => {
  assert.equal(looseFields("+34 627 57 43 11", hoy).phone, "627574311");
  assert.equal(looseFields("627574311", hoy).phone, "627574311");
  assert.equal(looseFields("Tel 627-57-43-11", hoy).phone, "627574311");
  // Un número corto no es un teléfono.
  assert.equal(looseFields("15 pax", hoy).phone, "");
});

test("zona cuando la nombran de pasada", () => {
  assert.equal(looseFields("queremos jaima", hoy).zone.toLowerCase(), "jaima");
  assert.equal(looseFields("mesa en el pinar", hoy).zone.toLowerCase(), "pinar");
});

test("no inventa un nombre donde no lo hay", () => {
  assert.equal(looseFields("15 pax\nJueves 13", hoy).fullName, "");
  assert.equal(looseFields("Hola buenas", hoy).fullName, "");
});
