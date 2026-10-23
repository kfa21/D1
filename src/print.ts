// PDF/print export at several levels — renders the chosen subtree into an
// isolated iframe (styles copied) so the browser Save-as-PDF produces a clean
// document containing only that content. Used by per-tag reports, project
// report, BOM, procurement, ITP and estimate.

export function printElementById(id: string, title?: string) {
  const src = document.getElementById(id);
  if (!src) {
    // fall back to whole-page print if the node is missing
    window.print();
    return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    window.print();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><title>${title ?? document.title}</title></head><body></body></html>`);
  doc.close();

  // copy the live app's stylesheets into the print frame
  for (const el of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    doc.head.appendChild(el.cloneNode(true));
  }
  const pageStyle = doc.createElement('style');
  pageStyle.textContent = '@page { size: A4; margin: 12mm; } body { background: #fff; }';
  doc.head.appendChild(pageStyle);

  const clone = src.cloneNode(true) as HTMLElement;
  // strip interactive controls inside the printed copy
  clone.querySelectorAll('button, input, select, textarea').forEach((n) => n.remove());
  doc.body.appendChild(clone);

  win.focus();
  setTimeout(() => {
    win.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
}
