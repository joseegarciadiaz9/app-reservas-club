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

/**
 * Precio y adelanto que devolvió Fourvenues al crear reservas reales con esta
 * tarifa (producción, evento del 26/08/2026). No son cálculos nuestros: son las
 * respuestas de `POST /bookings/request` y lo que muestra el panel.
 *
 * Lo importante es el salto de 4 a 5 personas: 95 € → 160 €. Cada bloque cubre
 * 3 incluidas + 1 de suplemento, así que la quinta persona abre bloque nuevo.
 */
const medidoEnProduccion = [
  { personas: 3, precio: 80, adelanto: 40 },
  { personas: 4, precio: 95, adelanto: 47.5 },
  { personas: 5, precio: 160, adelanto: 80 },
  { personas: 6, precio: 160, adelanto: 80 },
  { personas: 7, precio: 175, adelanto: 87.5 },
];

for (const { personas, precio, adelanto } of medidoEnProduccion) {
  test(`${personas} personas → ${precio} € (adelanto ${adelanto} €)`, () => {
    const resultado = priceForRate(precioEmbarcadero, personas);
    assert.equal(resultado.price, precio);
    assert.equal(resultado.deposit, adelanto);
  });
}

test("la pasarela cobra el adelanto más la comisión", () => {
  // Medido contra la pasarela real para 6 personas: pidió 84,00 €.
  // 50 % de 160 = 80, más el 5 % de gestión.
  assert.equal(priceForRate(precioEmbarcadero, 6).chargeNow, 84);
  assert.equal(priceForRate(precioEmbarcadero, 6).pendingAtDoor, 80);
});

test("full_payment no significa cobrar el 100 %", () => {
  // La tarifa lo tiene a true y aun así Fourvenues aplicó el adelanto del 50 %,
  // así que el campo no debe alterar el cálculo.
  const sinFullPayment = { ...precioEmbarcadero, full_payment: false };
  assert.equal(
    priceForRate(sinFullPayment, 6).chargeNow,
    priceForRate(precioEmbarcadero, 6).chargeNow,
  );
});

test("un adelanto fijo se respeta tal cual", () => {
  const fijo = {
    ...precioEmbarcadero,
    deposit: { type: "fixed", value: 30 },
    fee_quantity: 0,
  };
  assert.equal(priceForRate(fijo, 6).chargeNow, 30);
});
