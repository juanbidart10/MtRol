// =========================
// MTROL - CUSTOM SHEET RESIZE HANDLE
// =========================

const MTROL_RESIZE_HANDLE_CLASS = "mtrol-custom-resize-handle";

function getAppRoot(sheet, html) {
  const htmlElement =
    html?.[0] ?? null;

  const sheetElement =
    sheet?.element?.[0] ?? null;

  return (
    htmlElement?.closest?.(".app.window-app") ??
    sheetElement?.closest?.(".app.window-app") ??
    sheetElement ??
    null
  );
}

function getMinimumSize(sheet) {
  return {
    width: Number(sheet?.options?.minWidth ?? 320),
    height: Number(sheet?.options?.minHeight ?? 300)
  };
}

function getCurrentSize(sheet, appRoot) {
  const rect =
    appRoot?.getBoundingClientRect?.();

  return {
    width: Number(sheet?.position?.width ?? rect?.width ?? sheet?.options?.width ?? 600),
    height: Number(sheet?.position?.height ?? rect?.height ?? sheet?.options?.height ?? 500)
  };
}

export function installMtrolCustomResizeHandle(sheet, html) {
  const appRoot =
    getAppRoot(sheet, html);

  if (!appRoot || typeof sheet?.setPosition !== "function") return;

  appRoot
    .querySelectorAll(`.${MTROL_RESIZE_HANDLE_CLASS}`)
    .forEach(handle => handle.remove());

  const handle =
    document.createElement("div");

  handle.className =
    MTROL_RESIZE_HANDLE_CLASS;

  handle.title =
    "Redimensionar";

  handle.setAttribute("aria-hidden", "true");

  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const startX =
      event.clientX;

    const startY =
      event.clientY;

    const startSize =
      getCurrentSize(sheet, appRoot);

    const minSize =
      getMinimumSize(sheet);

    const previousUserSelect =
      document.body.style.userSelect;

    document.body.style.userSelect =
      "none";

    const onPointerMove = moveEvent => {
      moveEvent.preventDefault();

      const width =
        Math.max(minSize.width, startSize.width + moveEvent.clientX - startX);

      const height =
        Math.max(minSize.height, startSize.height + moveEvent.clientY - startY);

      sheet.setPosition({
        width,
        height
      });
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);

      document.body.style.userSelect =
        previousUserSelect;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });

  appRoot.appendChild(handle);
}
