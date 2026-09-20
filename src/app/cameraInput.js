/** Pointer-state transitions are independent of the renderer and testable. */
export function createCameraGesture({ orbit, zoom }) {
  const pointers = new Map();
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  return {
    down(id, x, y) {
      pointers.set(id, { x, y });
    },
    move(id, x, y) {
      const previous = pointers.get(id);
      if (!previous) return;
      const before = distance();
      pointers.set(id, { x, y });
      if (pointers.size === 1)
        orbit(-(x - previous.x) * 0.006, -(y - previous.y) * 0.006);
      else if (pointers.size === 2) {
        const after = distance();
        if (before > 4 && after > 4)
          zoom(Math.min(2, Math.max(0.5, before / after)));
      }
    },
    up(id) {
      pointers.delete(id);
    },
    reset() {
      pointers.clear();
    },
    get size() {
      return pointers.size;
    },
  };
}

export function bindCameraInput(
  canvas,
  { orbit, zoom, frame, draw, changed = () => {} },
) {
  const listeners = [];
  const on = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  };
  const gesture = createCameraGesture({
    orbit: (x, y) => {
      orbit(x, y);
      changed("orbit");
      draw();
    },
    zoom: (factor) => {
      zoom(factor);
      changed("zoom");
      draw();
    },
  });
  on(canvas, "pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.button !== 0) return;
    gesture.down(event.pointerId, event.clientX, event.clientY);
    canvas.setPointerCapture(event.pointerId);
  });
  on(canvas, "pointermove", (event) =>
    gesture.move(event.pointerId, event.clientX, event.clientY),
  );
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    on(canvas, type, (event) => {
      gesture.up(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    });
  on(window, "blur", () => gesture.reset());
  on(
    canvas,
    "wheel",
    (event) => {
      // Ctrl/Meta+wheel belongs to browser page zoom.
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      zoom(Math.exp(Math.max(-600, Math.min(600, event.deltaY)) * 0.0012));
      changed("zoom");
      draw();
    },
    { passive: false },
  );
  on(canvas, "keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const directions = {
      ArrowLeft: [-0.12, 0],
      ArrowRight: [0.12, 0],
      ArrowUp: [0, -0.12],
      ArrowDown: [0, 0.12],
    };
    if (directions[event.key]) {
      orbit(...directions[event.key]);
      changed("orbit");
    } else if (["+", "="].includes(event.key)) {
      zoom(0.9);
      changed("zoom");
    } else if (event.key === "-") {
      zoom(1.1);
      changed("zoom");
    } else if (event.key.toLowerCase() === "f") frame();
    else return;
    event.preventDefault();
    draw();
  });
  return () => {
    gesture.reset();
    listeners.forEach((off) => off());
  };
}
