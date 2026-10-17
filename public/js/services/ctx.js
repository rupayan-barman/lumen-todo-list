// The one shared application context. Populated by main.js at boot; services and views import `app`.
import { createBus } from '../core/bus.js';

export const app = {
  bus: createBus(),
  db: null,
  store: null,
  ready: false,
  degraded: false, // true when running on the in-memory fallback (nothing will persist)
};
