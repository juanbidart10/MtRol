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

import { mtrolLifecycle }
  from "./core/lifecycle.js";

import { logger } from "./utils/logger.js";

// =========================
// INIT
// =========================

Hooks.once("init", () => {
  void mtrolLifecycle.run("INIT", async () => {
    initMtrol3D();
    await initMtrol();
  }).catch(error => logger.error("LIFECYCLE", "init phase failed", {
    command: "lifecycle.init",
    status: "failed",
    reasonCode: error.reasonCode ?? "INIT_FAILED",
    error
  }));
});

// =========================
// READY
// =========================

Hooks.once("ready", () => {
  void mtrolLifecycle.run("READY", async () => {
    registerMtrolSockets();
    await readyMtrol();
  }).catch(error => logger.error("LIFECYCLE", "ready phase failed", {
    command: "lifecycle.ready",
    status: "failed",
    reasonCode: error.reasonCode ?? "READY_FAILED",
    error
  }));
});

// =========================
// HOOKS
// =========================

Hooks.once("setup", () => {
  void mtrolLifecycle.run("REGISTER", async () => registerHooks())
    .catch(error => logger.error("LIFECYCLE", "hook registration failed", {
      command: "lifecycle.register",
      status: "failed",
      reasonCode: error.reasonCode ?? "REGISTER_FAILED",
      error
    }));
});
