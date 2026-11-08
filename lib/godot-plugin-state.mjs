// Reads and edits the [editor_plugins] list in a Godot 4 project.godot.
// The export filter that keeps the panel out of the game PCK is registered by
// the plugin itself, so the plugin must be enabled before any export.

export const WXSLIM_PLUGIN_CFG = 'res://addons/wxslim_readonly/plugin.cfg';

const SECTION = /^\[editor_plugins\][ \t]*$/m;

function sectionBounds(text) {
  const m = SECTION.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = /^\[[^\]\r\n]+\][ \t]*$/m.exec(text.slice(start));
  return {header: m.index, start, end: next ? start + next.index : text.length};
}

const ENABLED = /^enabled=PackedStringArray\(([^)]*)\)[ \t]*$/m;

/** Plugin paths listed as enabled in project.godot text. */
export function enabledPlugins(text) {
  const b = sectionBounds(text);
  if (!b) return [];
  const m = ENABLED.exec(text.slice(b.start, b.end));
  if (!m) return [];
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1]);
}

export function isPluginEnabled(text, cfg = WXSLIM_PLUGIN_CFG) {
  return enabledPlugins(text).includes(cfg);
}

/** Returns project.godot text with the plugin enabled; other plugins and settings are kept. */
export function enablePlugin(text, cfg = WXSLIM_PLUGIN_CFG) {
  if (isPluginEnabled(text, cfg)) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const b = sectionBounds(text);
  if (!b) {
    const sep = text.length === 0 || text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol;
    return `${text}${sep}[editor_plugins]${eol}${eol}enabled=PackedStringArray("${cfg}")${eol}`;
  }
  const body = text.slice(b.start, b.end);
  const m = ENABLED.exec(body);
  let next;
  if (m) {
    const list = [...enabledPlugins(text), cfg].map(p => `"${p}"`).join(', ');
    next = body.slice(0, m.index) + `enabled=PackedStringArray(${list})` + body.slice(m.index + m[0].length);
  } else {
    next = `${eol}${eol}enabled=PackedStringArray("${cfg}")${body.replace(/^(\r?\n)+/, eol)}`;
    if (!next.endsWith(eol)) next += eol;
  }
  return text.slice(0, b.start) + next + text.slice(b.end);
}
