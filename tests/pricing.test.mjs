import assert from "node:assert/strict";
import test from "node:test";

import { priceForRate } from "../app/lib/booking-payload.ts";

/**
 * Tarifa REAL de TØTEM, copiada tal cual de `GET /bookings/zones` para el
 * evento del 26/08/2026 (zona PINAR, mesa 205). Sirve de ancla: si alguien
 * cambia la fórmula, estos números tienen que seguir cuadrando con lo que
 * cobró la pasarela de verdad.
 */
const precioEmbarcadero = {
  name: "PRECIO EMBARCADERO",
  price: 80,
  included_persons: 3,
  supplement_persons: 1,
  supplement_price: 15,
  fee_type: "percentage",
  fee_quantity: 5,
  deposit: { type: "percentage", value: 50 },
  full_payment: true,
};

test("el total incluye el suplemento por persona extra", () => {
  // 6 personas = 80 € de base (3 incluidas) + 3 × 15 €.
  assert.equal(priceForRate(precioEmbarcadero, 6).price, 125);
  assert.equal(priceForRate(precioEmbarcadero, 3).price, 80);
});

test("el enlace cobra la base más la comisión, no el total ni el 50 %", () => {
  // Medido contra un checkout real: la pasarela pidió 84,00 € para 6 personas.
  // Ni 125 € (el total) ni 63 € (el 50 % que mostraba la app antes).
  assert.equal(priceForRate(precioEmbarcadero, 6).chargeNow, 84);
  // El cobro no depende del grupo: los suplementos se liquidan en puerta.
  assert.equal(priceForRate(precioEmbarcadero, 3).chargeNow, 84);
  assert.equal(priceForRate(precioEmbarcadero, 6).pendingAtDoor, 45);
});

test("sin full_payment se cobra el adelanto configurado", () => {
  const conAdelanto = { ...precioEmbarcadero, full_payment: false };
  // 50 % de 80 = 40, más el 5 % de comisión.
  assert.equal(priceForRate(conAdelanto, 6).chargeNow, 42);
  assert.equal(priceForRate(conAdelanto, 6).pendingAtDoor, 85);
});

test("un adelanto fijo se respeta tal cual", () => {
  const fijo = {
    ...precioEmbarcadero,
    full_payment: false,
    deposit: { type: "fixed", value: 30 },
    fee_quantity: 0,
  };
  assert.equal(priceForRate(fijo, 6).chargeNow, 30);
});
