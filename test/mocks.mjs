// Minimal stand-ins for the Foundry globals the system uses, so the Foundry-facing
// code (data models, battle adapter) can be exercised in Node.
const setPath = (obj, p, v) => { const ks = p.split("."); let o = obj; while (ks.length > 1) { const k = ks.shift(); o = o[k] ??= {}; } o[ks[0]] = v; };

class Field { constructor(...a) { this.args = a; } }
globalThis.foundry = {
  data: { fields: { NumberField: Field, StringField: Field, BooleanField: Field, SchemaField: Field, ArrayField: Field, HTMLField: Field, ObjectField: Field } },
  abstract: { TypeDataModel: class {} },
  utils: { deepClone: (x) => structuredClone(x), escapeHTML: (s) => s, getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o) },
  applications: { api: {}, sheets: {} },
};
globalThis.document = { createElement: () => ({ set innerHTML(v) { this.textContent = String(v).replace(/<[^>]+>/g, ""); }, textContent: "" }) };
globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };

export const chat = [];
const ChatClass = { create: async (d) => { chat.push(d); return d; }, getSpeaker: () => ({}) };

const settings = new Map();
const users = [];
users.find = Array.prototype.find; users.get = (id) => users.find(u => u.id === id);
const uuids = new Map();
globalThis.fromUuidSync = (u) => uuids.get(u) ?? null;
globalThis.CONFIG = { Dice: { randomUniform: Math.random }, ChatMessage: { documentClass: ChatClass } };
globalThis.canvas = { scene: null };

export const scenes = new Map();
globalThis.game = {
  settings: { get: (ns, k) => settings.get(k), set: async (ns, k, v) => { settings.set(k, structuredClone(v)); } },
  users, scenes: { get: (id) => scenes.get(id) },
  user: null,
};
Object.defineProperty(game.users, "activeGM", { get: () => users.find(u => u.isGM) });

export function addUser(id, isGM) { const u = { id, name: id, isGM, color: "#fff" }; users.push(u); return u; }
export function setSetting(k, v) { settings.set(k, v); }

export function makeActor({ type, system, items = [], owners = [], uuid }) {
  const a = {
    type, system, uuid, name: system.name ?? uuid,
    items: Object.assign(items, { filter: Array.prototype.filter, find: Array.prototype.find, get(id) { return items.find(i => i.id === id); } }),
    testUserPermission: (u) => u.isGM || owners.includes(u.id),
    update: async (upd) => { for (const [k, v] of Object.entries(upd)) setPath(a, k, v); return a; },
    getSkill(key) { return { value: a.system.skills?.[key]?.value ?? 0 }; },
  };
  if (uuid) uuids.set(uuid, a);
  return a;
}

export function makeScene(id, size = 100) {
  const tokens = [];
  tokens.get = (tid) => tokens.find(t => t.id === tid);
  const scene = {
    id, name: id, grid: { size }, tokens, regions: [],
    async updateEmbeddedDocuments(type, updates) {
      for (const u of updates) { const t = tokens.get(u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(t, k, v); }
    },
  };
  scenes.set(id, scene);
  return scene;
}

export function addToken(scene, { id, name, x, y, actor }) {
  const t = { id, name, x: x * scene.grid.size, y: y * scene.grid.size, actor, parent: scene, texture: { src: "" }, rotation: 0, hidden: false, lockRotation: false, flags: {}, getFlag(ns, k) { return this.flags?.[ns]?.[k]; } };
  scene.tokens.push(t);
  return t;
}
