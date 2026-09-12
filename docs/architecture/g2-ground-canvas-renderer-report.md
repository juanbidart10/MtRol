# G2 — Ground Canvas Renderer

## Executive summary

G2 adds the first persistent visual representation of Ground. A Foundry v14 custom `CanvasLayer` reads only `GroundPublicProjection`, derives immutable render models, and maintains ephemeral PIXI sprites keyed by `groundId`. Ground persistence remains the only source of truth.

The renderer is read-only by construction. Its runtime dependency is a `GroundPublicProjectionReader` whose only public operation is `getPublicGroundForScene(sceneId)`. The layer does not receive the persistence primitive, lifecycle, reconciliation, commands, receipts, Actor or Item APIs.

## Baseline

Approved pre-G2 baseline:

```text
1553 total
1552 pass
0 fail
1 manual skip
```

Foundry contract audited against the installed runtime: v14 build 365 with PIXI 7.4.3.

## Files

Productive file created:

- `scripts/ground/ground-canvas-renderer.js`

Productive files modified:

- `scripts/ground/ground-repository.js`
- `scripts/core/init.js`
- `scripts/core/hooks.js`

Test file created:

- `tests/ground-canvas-renderer-g2.test.mjs`

Documentation created:

- `docs/architecture/g2-ground-canvas-renderer-report.md`

No Ground schema, lifecycle, reconciliation, receipt, command, socket, Trade, inventory, Item Piles or gameplay file was changed for G2.

## Tests-first result

The complete G2 test file was created before productive implementation. Its first execution failed with exit code 1 and `ERR_MODULE_NOT_FOUND` for `scripts/ground/ground-canvas-renderer.js`: one test-file failure, zero passing tests.

The first productive implementation produced 18 passing and 2 failing tests. Both failures were defects in test preparation: one hand-built changed model retained the old fingerprint, and one test attempted to modify a frozen reader before replacing the layer dependency. Those preparations were corrected without weakening productive behavior. The directed suite then passed 20/20.

## Layer registration

`registerGroundCanvasLayer()` runs during the existing `initMtrol()` lifecycle and registers exactly:

```text
CONFIG.Canvas.layers.ground = {
  layerClass: GroundCanvasLayer,
  group: "primary"
}
```

The class extends the Foundry v14 `foundry.canvas.layers.CanvasLayer`. Its layer name is `ground`, its `sortLayer` is 650, and registration is idempotent. An existing compatible MTROL Ground layer returns `ALREADY_REGISTERED`. An incompatible `ground` key is retained, logged as `GROUND_CANVAS_LAYER_COLLISION`, and returns `COLLISION`; it is never silently overwritten.

The existing `setup` registration path installs one global `updateScene` hook. No second Canvas lifecycle or Ground socket was added.

## Public-only read

`GroundPersistencePrimitive.getPublicGroundForScene(sceneId)` reads only `publicStorage`, validates the public envelope and every record through the existing schema, and returns cloned projections.

`GroundPublicProjectionReader` holds its storage in a private field and exposes only that read. `createLevel1GroundPublicReader()` constructs it directly over the public Scene flag adapter. The Canvas layer receives this restricted reader rather than `GroundPersistencePrimitive`.

A spy test makes `authorityStorage.read()` throw and verifies that repeated public reads leave its call count at zero.

## Source of truth

The render path is:

```text
Scene.flags.mtrol.groundPublicProjections
→ GroundPublicProjectionReader
→ pure render model
→ GroundCanvasLayer
→ ephemeral PIXI.Container / PIXI.Sprite / PIXI.Graphics
```

No TileDocument, TokenDocument, DrawingDocument, Actor, Item or embedded Document is created. The renderer neither persists derived state nor uses PIXI objects as recovery state.

## Coordinate contract and size

`position: {x, y}` is treated as the visual center in absolute Canvas coordinates. Every sprite uses `anchor.set(0.5)` and applies `x/y` directly without snapping or conversion.

Target bounding size is:

```text
canvas.dimensions.size × 0.4
```

A uniform scale based on the larger texture dimension preserves aspect ratio. Non-finite or non-positive texture dimensions reject only that sprite.

## Z-order

The layer belongs to the `primary` Canvas group and uses `sortLayer = 650`, placing it between Foundry v14 Drawings at 600 and Tokens at 700 when elevation is otherwise equal.

## Visibility and GM invisible representation

The pure policy is:

| Visibility | Player | GM |
| --- | --- | --- |
| `INVISIBLE` | omitted | administrative sprite |
| `HIDDEN` | rendered | rendered |
| `REVEALED` | rendered | rendered |

GM administrative rendering uses sprite alpha `0.35` plus a small local PIXI marker. It contains no text, name, quantity, description, tooltip, Item data or Authority data.

The renderer does not reinterpret `HIDDEN`. Both `REAL` and `GENERIC` use the already-public `appearance.img`.

## Appearance and fallback

The source texture is loaded through `foundry.canvas.loadTexture()`. A missing, invalid or failed source falls back to `icons/svg/item-bag.svg`. A failed fallback omits only that Ground and logs an isolated warning. Other Ground continue rendering.

## Diff and performance

The layer holds `Map<groundId, SpriteEntry>` and computes added, removed, changed and unchanged IDs in linear passes over current and desired maps.

Position, alpha and grid-size changes update an existing sprite. Image and administrative-marker changes replace only that entry. Unchanged records retain sprite identity. A 500-record pure test produces 500 unchanged records with no additions, removals or replacements.

This establishes algorithmic behavior for 10, 100 and 500 Ground. No FPS or GPU-performance claim is made without a real Canvas benchmark.

## Live sync

The single `updateScene` listener synchronizes only when:

- Canvas is ready;
- the updated Scene is the viewed Scene;
- `flags.mtrol.groundPublicProjections` changed.

Each sync reads the public envelope once. Unrelated Scene updates and Ground updates for another Scene are ignored. No polling, socket or per-sprite listener exists.

## Scene lifecycle and async generation

`_draw()` captures the current Scene, increments a local generation, reads the public projections and performs the diff.

Every asynchronous texture result is checked against:

- current generation;
- current Scene ID;
- current desired `groundId`;
- current render-model fingerprint.

A late result from sync A cannot restore state after sync B.

`_tearDown()` increments the generation, clears desired state and sprite entries, removes/destroys owned containers and sprites, and clears the Scene reference before delegating to the base layer teardown. Returning to a Scene reconstructs state from its public flag.

## Texture ownership

The renderer owns containers, sprites and administrative graphics. Foundry/PIXI owns cached textures and base textures. Cleanup explicitly uses `texture: false` and `baseTexture: false`; the renderer never unloads PIXI assets or destroys shared textures.

## Error isolation

A corrupt public read or schema failure clears current Ground sprites and logs a fail-closed warning. It does not retain stale visual state, normalize persistence, write data, invoke reconciliation or inspect Authority.

A single source/fallback texture failure is isolated to its Ground.

## Interaction

The layer, entry containers and sprites use `eventMode = "none"`; the layer and containers disable interactive children. G2 registers no pointer, hover, double-click, drag, context-menu, selection or pickup behavior.

## Privacy and Level 1

The renderer consumes only `GroundPublicProjection`. Authority read count is zero by directed test. Level 1 remains UI privacy: Players can technically inspect distributed Scene flags. No secrecy claim is made.

The Level 2 migration boundary is preserved because visual code depends on the public reader and does not depend on the physical authority adapter.

## Dependency independence

The productive renderer imports only Ground public schema/visibility, the public-reader factory and the MTROL logger. A structural import/call audit rejects lifecycle, reconciliation, AuthorityService, CommandRegistry, ReceiptStore, Ground receipt scope, SharedReservationLedger, Trade, Item Transfer, Item Piles, Sequencer, JB2A, Token Magic and Document mutation APIs.

## G2 SAFETY BASELINE

| Safety property | Result |
| --- | --- |
| Renderer reads AuthorityRecord | NO; spy count 0 |
| Renderer mutates PublicProjection | NO |
| Renderer mutates AuthorityRecord | NO |
| Renderer mutates Ground | NO |
| Renderer mutates Actor | NO |
| Renderer mutates Item | NO |
| Renderer invokes CommandRegistry | NO |
| Renderer invokes ReceiptStore | NO |
| Renderer invokes GroundLifecycleService | NO |
| Renderer invokes GroundReconciliationService | NO |
| Renderer creates Tile/Token/Drawing | NO |
| Renderer depends on Item Piles | NO |
| Renderer depends on Sequencer/JB2A | NO |
| Renderer adds commands or sockets | NO |

These properties are protected by the restricted runtime dependency, spy assertions, behavioral doubles and structural source audit.

## Directed and regression tests

Directed G2:

```text
tests 20
pass 20
fail 0
skip 0
```

All Ground suites, including G1B.1 through G1B.4B and G2:

```text
tests 83
pass 83
fail 0
skip 0
```

Hooks/init/Canvas-related regression selection:

```text
tests 64
pass 64
fail 0
skip 0
```

Final full suite after the last productive change:

```text
tests 1573
pass 1572
fail 0
skipped 1
```

The single skip is the existing manual test. G2 adds no skips.

## Manual Foundry result

**NOT EXECUTED.** No Foundry application window was accessible through the available UI automation surface, so no World could be entered. The EULA/license was not accepted and no fixture or World data was created or modified.

## Known limitations

- Real Foundry Canvas rendering, Scene switching, z-order and live synchronization still require runtime validation.
- Level 1 provides UI policy, not client-data secrecy.
- The generic fallback is a Foundry Core asset; G2 adds no MTROL-owned Ground icon.
- No FPS claim exists for 500 Ground.
- The renderer represents every existing public projection according to its public visibility. It does not and cannot filter by authority lifecycle.
- G2 provides no interaction, inspector, Drop or Pickup.

## Next-phase readiness

The automated renderer contract and read-only safety baseline are complete. The next action is runtime validation in an already accessible Foundry World. No later phase was started.
