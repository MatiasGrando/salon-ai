import type { Env } from "../env";
import type { NichePack } from "./types";
import { generico } from "./generico";
import { restaurante } from "./restaurante";
import { inmobiliaria } from "./inmobiliaria";
import { barberia } from "./barberia";
import { salon } from "./salon";
import { dentista } from "./dentista";
import { gimnasio } from "./gimnasio";
import { coach } from "./coach";
import { tienda } from "./tienda";
import { panaderia } from "./panaderia";
import { crm } from "./crm";
import { hoteleria } from "./hoteleria";
import { cafeteria } from "./cafeteria";
import { clinica } from "./clinica";
import { spa } from "./spa";

export type { NichePack, NicheColumn } from "./types";

// Registro de packs. Agregar un nicho = importar su archivo y sumarlo aquí.
const PACKS: Record<string, NichePack> = {
  generico,
  restaurante,
  inmobiliaria,
  barberia,
  salon,
  dentista,
  gimnasio,
  coach,
  tienda,
  panaderia,
  crm,
  hoteleria,
  cafeteria,
  clinica,
  spa,
};

/** Resuelve el pack activo desde BOT_NICHE. Nicho ausente/desconocido → genérico. */
export function getNiche(env: Env): NichePack {
  const id = (env.BOT_NICHE ?? "").trim().toLowerCase();
  return PACKS[id] ?? generico;
}
