// MapView: owns pan/zoom for a given <svg> map element. It encapsulates the
// viewBox state so the quiz engine only needs panToStreet() and resetView().

export function createMapView(svg, opts = {}) {
  const wrap = svg.parentElement;
  const vbAttr = svg.getAttribute('viewBox').split(/\s+/).map(parseFloat);
  const baseVB0 = { x: vbAttr[0], y: vbAttr[1], w: vbAttr[2], h: vbAttr[3] }; // unrotated
  const cx = baseVB0.x + baseVB0.w / 2, cy = baseVB0.y + baseVB0.h / 2;

  // Wrap all content in a group we can rotate. Rotating the content (rather
  // than CSS-rotating the <svg>) keeps pan/zoom axis-aligned with the screen.
  const SVGNS = 'http://www.w3.org/2000/svg';
  let rotG = svg.querySelector('.__maprot');
  if (!rotG) {
    rotG = document.createElementNS(SVGNS, 'g');
    rotG.setAttribute('class', '__maprot');
    while (svg.firstChild) rotG.appendChild(svg.firstChild);
    svg.appendChild(rotG);
  }
  // Initial orientation (persisted per district / shipped with the map). Snap
  // to a quarter turn.
  let angle = ((Math.round((opts.rotation || 0) / 90) * 90) % 360 + 360) % 360;
  if (angle) rotG.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
  // For 90°/270° the visible extent is the original box with width/height
  // swapped (same centre), so the rotated map still fills the frame.
  const baseForAngle = () => (angle % 180 === 0)
    ? { ...baseVB0 }
    : { x: cx - baseVB0.h / 2, y: cy - baseVB0.w / 2, w: baseVB0.h, h: baseVB0.w };
  let baseVB = baseForAngle();
  let vb = { ...baseVB };

  function applyVB() {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }
  function resetView() {
    baseVB = baseForAngle();
    vb = { ...baseVB };
    applyVB();
  }
  // Rotate a point about the map centre by `deg`.
  function rot(px, py, deg) {
    if (!deg) return [px, py];
    const rad = deg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    const dx = px - cx, dy = py - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  // content-space -> on-screen (root) position under rotation, and the inverse.
  const rotatePoint = (px, py) => rot(px, py, angle);
  const unrotatePoint = (px, py) => rot(px, py, -angle);
  function rotate() {
    angle = (angle + 90) % 360;
    rotG.setAttribute('transform', angle ? `rotate(${angle} ${cx} ${cy})` : '');
    resetView();
    return angle;
  }
  const getRotation = () => angle;

  // Zoom (mouse wheel)
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const newW = vb.w * factor, newH = vb.h * factor;
    if (newW > baseVB.w * 4 || newW < baseVB.w * 0.05) return;
    vb.x = vb.x + (vb.w - newW) * px;
    vb.y = vb.y + (vb.h - newH) * py;
    vb.w = newW; vb.h = newH;
    applyVB();
  }, { passive: false });

  // Pan (mouse drag)
  let panning = false, panStart = null;
  svg.addEventListener('mousedown', e => {
    if (e.target.closest('.street')) return; // let click through
    panning = true; svg.classList.add('dragging');
    panStart = { x: e.clientX, y: e.clientY, vbx: vb.x, vby: vb.y };
  });
  window.addEventListener('mousemove', e => {
    if (!panning) return;
    const r = svg.getBoundingClientRect();
    const dx = (e.clientX - panStart.x) / r.width * vb.w;
    const dy = (e.clientY - panStart.y) / r.height * vb.h;
    vb.x = panStart.vbx - dx; vb.y = panStart.vby - dy;
    applyVB();
  });
  window.addEventListener('mouseup', () => {
    panning = false; svg.classList.remove('dragging');
  });

  // Pan + pinch zoom (touch)
  let touchState = null;
  svg.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      touchState = { mode: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY, vbx: vb.x, vby: vb.y };
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const cx = (t1.clientX + t2.clientX) / 2, cy = (t1.clientY + t2.clientY) / 2;
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      touchState = { mode: 'pinch', cx, cy, d, vb: { ...vb } };
    }
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (!touchState) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    if (touchState.mode === 'pan' && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - touchState.x) / r.width * vb.w;
      const dy = (e.touches[0].clientY - touchState.y) / r.height * vb.h;
      vb.x = touchState.vbx - dx; vb.y = touchState.vby - dy;
      applyVB();
    } else if (touchState.mode === 'pinch' && e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const factor = touchState.d / d;
      const baseV = touchState.vb;
      const px = (touchState.cx - r.left) / r.width;
      const py = (touchState.cy - r.top) / r.height;
      const newW = baseV.w * factor, newH = baseV.h * factor;
      if (newW > baseVB.w * 4 || newW < baseVB.w * 0.05) return;
      vb.x = baseV.x + (baseV.w - newW) * px;
      vb.y = baseV.y + (baseV.h - newH) * py;
      vb.w = newW; vb.h = newH;
      applyVB();
    }
  }, { passive: false });
  svg.addEventListener('touchend', e => {
    if (e.touches.length === 0) touchState = null;
  });

  // Pan the viewBox so a street is centered, but only if it's outside view.
  // The street's bbox is in content space, so rotate its centre to screen space.
  function panToStreet(g) {
    if (!g) return;
    const bbox = g.getBBox();
    const [sx, sy] = rotatePoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    if (sx < vb.x + vb.w * 0.1 || sx > vb.x + vb.w * 0.9 ||
        sy < vb.y + vb.h * 0.1 || sy > vb.y + vb.h * 0.9) {
      vb.x = sx - vb.w / 2;
      vb.y = sy - vb.h / 2;
      applyVB();
    }
  }

  // Convert a screen point to content-space coords. Uses the SVG's own
  // transform (handles viewBox, preserveAspectRatio letterboxing, and the
  // rotation group) when available; falls back to a manual "xMidYMid meet"
  // calculation otherwise (e.g. headless test environments).
  function clientToContent(clientX, clientY) {
    if (rotG.getScreenCTM && svg.createSVGPoint) {
      const ctm = rotG.getScreenCTM();
      if (ctm) {
        const p = svg.createSVGPoint();
        p.x = clientX; p.y = clientY;
        const c = p.matrixTransform(ctm.inverse());
        return [c.x, c.y];
      }
    }
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / vb.w, r.height / vb.h); // uniform "meet" scale
    const offX = (r.width - vb.w * scale) / 2;               // letterbox offsets (xMid/yMid)
    const offY = (r.height - vb.h * scale) / 2;
    const rx = vb.x + (clientX - r.left - offX) / scale;
    const ry = vb.y + (clientY - r.top - offY) / scale;
    return unrotatePoint(rx, ry);
  }

  // Centre the view on a content-space point.
  function panToPoint(x, y) {
    const [sx, sy] = rotatePoint(x, y);
    vb.x = sx - vb.w / 2;
    vb.y = sy - vb.h / 2;
    applyVB();
  }

  // Highlight markers (content-space), drawn inside the rotation group so they
  // track the map. Used by the Blocks mode.
  let markersG = null;
  function marker(x, y, { color = '#ff8a3d', r = baseVB0.w * 0.006 } = {}) {
    if (!markersG) { markersG = document.createElementNS(SVGNS, 'g'); markersG.setAttribute('class', '__markers'); rotG.appendChild(markersG); }
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r);
    c.setAttribute('fill', color); c.setAttribute('stroke', '#0d3144'); c.setAttribute('stroke-width', r * 0.3);
    markersG.appendChild(c);
    return c;
  }
  function clearMarkers() { if (markersG) markersG.innerHTML = ''; }

  applyVB();
  return { resetView, panToStreet, rotate, getRotation, clientToContent, panToPoint, marker, clearMarkers };
}
