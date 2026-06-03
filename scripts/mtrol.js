// =========================
// MTROL
// MAIN ENTRY
// =========================

import { initMtrol }
  from "./core/init.js";

import { registerHooks }
  from "./core/hooks.js";

import { readyMtrol }
  from "./core/ready.js";

import { registerMtrolSockets }
  from "./core/sockets.js";

import { initMtrol3D }
  from "./3d/mtrol-3d-init.js";

// =========================
// INIT
// =========================

Hooks.once("init", async () => {

  console.log("=================================");
  console.log("MTROL | BOOTING");
  console.log("=================================");

  initMtrol3D();

  await initMtrol();

});

// =========================
// READY
// =========================

Hooks.once("ready", async () => {

  console.log("=================================");
  console.log("MTROL | READY");
  console.log("=================================");

  registerMtrolSockets();

  readyMtrol();

});

// =========================
// HOOKS
// =========================

Hooks.once("setup", () => {

  registerHooks();

});
