// Actors directory: "(placed)" after the name of every actor with a token on the scene being viewed.
// Updates when tokens are added or removed and when the viewed scene changes.

/** Ids of actors with at least one token on `scene`. */
export function placedActorIds(scene) {
  const ids = new Set();
  for (const t of scene?.tokens ?? []) if (t.actorId) ids.add(t.actorId);
  return ids;
}

/** Add or remove the "(placed)" tag on every actor entry under `root`. */
export function markPlaced(root, ids) {
  if (!root) return;
  for (const li of root.querySelectorAll("[data-entry-id]")) {
    const on = ids.has(li.dataset.entryId);
    let tag = li.querySelector(".qin-placed");
    if (on && !tag) {
      tag = document.createElement("span");
      tag.className = "qin-placed"; tag.textContent = " (placed)";
      tag.style.opacity = "0.7"; tag.style.fontStyle = "italic"; tag.style.whiteSpace = "nowrap";
      tag.title = "This unit has a token on the scene you're viewing";
      const name = li.querySelector(".entry-name a, .entry-name, .document-name a, .document-name") ?? li;
      name.append(tag);
    } else if (!on && tag) tag.remove();
  }
}

export function registerPlacedTag() {
  const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0]) ?? null;
  const refresh = () => {
    const ids = placedActorIds(canvas?.scene);
    markPlaced(rootOf(ui.actors?.element), ids);
    for (const app of Object.values(ui.windows ?? {})) if (app?.constructor?.name === "ActorDirectory" && app !== ui.actors) markPlaced(rootOf(app.element), ids);
  };
  Hooks.on("renderActorDirectory", (app, html) => markPlaced(rootOf(html), placedActorIds(canvas?.scene)));
  Hooks.on("canvasReady", refresh);
  const onScene = (doc) => { if (doc?.parent?.id && doc.parent.id === canvas?.scene?.id) refresh(); };
  Hooks.on("createToken", onScene);
  Hooks.on("deleteToken", onScene);
  Hooks.on("updateToken", (doc, change) => { if ("actorId" in (change ?? {})) onScene(doc); });
}
