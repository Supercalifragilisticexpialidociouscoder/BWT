import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

/** Rasterise a QR the way the ticket page does (dark modules on light), then decode it the way the scanner does. */
function render(text: string, scale = 6, margin = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const size = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 12;
        }
      }
    }
  }
  return { data, size };
}

describe('ticket QR round trip', () => {
  it('decodes the exact signed payload, with no personal data in it', () => {
    const payload = 'CF1.6ac94119f6033a81b51f9249.Qm9vZ2xlLWNhbXB1c2Zs';
    const { data, size } = render(payload);
    const decoded = jsQR(data, size, size, { inversionAttempts: 'dontInvert' });
    expect(decoded?.data).toBe(payload);
    expect(payload).not.toMatch(/@|\s/);
  });
});
