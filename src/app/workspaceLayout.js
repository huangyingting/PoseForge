/** Layout-only state: expanding the viewport never changes the current scene. */
export function bindWorkspaceLayout(root, toggle) {
  const desktop = matchMedia("(min-width: 901px)");
  let focused = false;
  function setFocus(value) {
    focused = Boolean(value && desktop.matches);
    // Move focus before removing sidebars from the accessibility tree.
    if (
      focused &&
      root.querySelector("#library:focus-within, #panel:focus-within")
    )
      toggle.focus();
    root.dataset.focus = String(focused);
    toggle.setAttribute("aria-pressed", String(focused));
    toggle.title = focused
      ? "Exit focus view · Escape"
      : "Focus view · hide sidebars";
  }
  const click = () => setFocus(!focused);
  const resize = () => {
    if (!desktop.matches) {
      setFocus(false);
      if (document.activeElement === toggle)
        root.querySelector('.mobile-nav [aria-pressed="true"]')?.focus();
    }
  };
  const keydown = (event) => {
    if (
      event.key === "Escape" &&
      focused &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      setFocus(false);
      toggle.focus();
    }
  };
  toggle.addEventListener("click", click);
  desktop.addEventListener("change", resize);
  document.addEventListener("keydown", keydown);
  setFocus(false);
  return {
    setFocus,
    dispose() {
      toggle.removeEventListener("click", click);
      desktop.removeEventListener("change", resize);
      document.removeEventListener("keydown", keydown);
    },
  };
}
