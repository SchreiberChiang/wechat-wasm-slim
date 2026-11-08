import test from 'node:test';
import assert from 'node:assert/strict';
import {enablePlugin, enabledPlugins, isPluginEnabled, WXSLIM_PLUGIN_CFG} from '../lib/godot-plugin-state.mjs';

const CFG = WXSLIM_PLUGIN_CFG;

test('plugin state: adds a section when the project has none', () => {
  const text = 'config_version=5\n\n[application]\n\nconfig/name="A"\n';
  const out = enablePlugin(text);
  assert.equal(out, text + `\n[editor_plugins]\n\nenabled=PackedStringArray("${CFG}")\n`);
  assert.equal(isPluginEnabled(out), true);
  assert.equal(enablePlugin(out), out);
});

test('plugin state: keeps other plugins and later sections, CRLF preserved', () => {
  const text = '[application]\r\n\r\nconfig/name="A"\r\n\r\n[editor_plugins]\r\n\r\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\r\n\r\n[rendering]\r\n\r\nx=1\r\n';
  const out = enablePlugin(text);
  assert.deepEqual(enabledPlugins(out), ['res://addons/other/plugin.cfg', CFG]);
  assert.match(out, /\r\n\[rendering\]\r\n\r\nx=1\r\n$/);
  assert(!/[^\r]\n/.test(out));
});

test('plugin state: fills an empty section and ignores the plugin listed elsewhere', () => {
  const text = `[a]\n\nnote="${CFG}"\n\n[editor_plugins]\n\n[b]\n\ny=2\n`;
  assert.equal(isPluginEnabled(text), false);
  const out = enablePlugin(text);
  assert.deepEqual(enabledPlugins(out), [CFG]);
  assert.match(out, /\n\[b\]\n\ny=2\n$/);
});
