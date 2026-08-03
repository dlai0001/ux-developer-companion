// Input forwarding (PLAN §4.2). Printable keys need keyDown + char + keyUp; non-printable keys
// use rawKeyDown + keyUp with a virtual keycode. Verified against a live page in spike S4b.
import type Protocol from 'devtools-protocol';
import type { CdpSession } from '../browser/cdp.js';
import type { InputModifiers, MouseKind } from '../../shared/protocol.js';

interface KeyDef { code: string; key: string; vk: number; text?: string }

const KEYS: Record<string, KeyDef> = {
  Enter: { code: 'Enter', key: 'Enter', vk: 13, text: '\r' },
  Backspace: { code: 'Backspace', key: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', key: 'Delete', vk: 46 },
  Tab: { code: 'Tab', key: 'Tab', vk: 9, text: '\t' },
  Escape: { code: 'Escape', key: 'Escape', vk: 27 },
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
  Home: { code: 'Home', key: 'Home', vk: 36 },
  End: { code: 'End', key: 'End', vk: 35 },
  PageUp: { code: 'PageUp', key: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', key: 'PageDown', vk: 34 },
  Shift: { code: 'ShiftLeft', key: 'Shift', vk: 16 },
  Control: { code: 'ControlLeft', key: 'Control', vk: 17 },
  Alt: { code: 'AltLeft', key: 'Alt', vk: 18 },
  Meta: { code: 'MetaLeft', key: 'Meta', vk: 91 },
};

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function modifierMask(m: InputModifiers): number {
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
}

export async function forwardKey(
  cdp: CdpSession,
  key: string,
  code: string,
  mods: InputModifiers,
): Promise<void> {
  const known = KEYS[key];
  const printable = !known && [...key].length === 1;
  const modifiers = modifierMask(mods);
  const vk = known ? known.vk : key.toUpperCase().charCodeAt(0);

  const base: Protocol.Input.DispatchKeyEventRequest = {
    type: 'keyDown',
    modifiers,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    key: known ? known.key : key,
    code: known ? known.code : code,
  };

  // KNOWN COST: with focus emulation enabled (required — see CdpSession.enableDomains), a
  // dispatch can block for a few hundred ms, occasionally longer, before the renderer
  // acknowledges. Each event is still awaited: skipping the await loses the guarantee that
  // the character has landed, and firing them unawaited produced dropped input.
  const send = (p: Parameters<CdpSession['dispatchKey']>[0]): Promise<void> => cdp.dispatchKey(p);

  if (printable) {
    // Ctrl/Meta chords must not insert text — send them as raw key events instead.
    if (mods.ctrl || mods.meta) {
      await send({ ...base, type: 'rawKeyDown' });
      await send({ ...base, type: 'keyUp' });
      return;
    }
    // Chrome inserts text for BOTH a `keyDown` carrying `text` and a `char` event — sending
    // both duplicates every character ("hey" -> "hheeyy"). `keyDown` must stay text-free.
    await send({ ...base, type: 'keyDown' });
    await send({ ...base, type: 'char', text: key, unmodifiedText: key });
    await send({ ...base, type: 'keyUp' });
    return;
  }

  await send({ ...base, type: 'rawKeyDown' });
  if (known?.text) await send({ ...base, type: 'char', text: known.text });
  await send({ ...base, type: 'keyUp' });
}

export async function forwardMouse(
  cdp: CdpSession,
  kind: MouseKind,
  x: number,
  y: number,
  mods: InputModifiers,
  delta?: { deltaX: number; deltaY: number },
): Promise<void> {
  const modifiers = modifierMask(mods);
  if (kind === 'wheel') {
    await cdp.dispatchMouse({
      type: 'mouseWheel', x, y, modifiers,
      deltaX: delta?.deltaX ?? 0, deltaY: delta?.deltaY ?? 0,
    });
    return;
  }
  const type = kind === 'down' ? 'mousePressed' : kind === 'up' ? 'mouseReleased' : 'mouseMoved';
  await cdp.dispatchMouse({
    type, x, y, modifiers, button: 'left', clickCount: kind === 'move' ? 0 : 1,
  });
}
