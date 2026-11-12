import { panelLayout } from './case-geometry.js';

function number(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pathForPoints(points, offsetX, offsetY) {
  if (!points.length) return '';
  const [firstX, firstY] = points[0];
  let path = `M ${number(firstX + offsetX)} ${number(firstY + offsetY)}`;
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index];
    path += ` L ${number(x + offsetX)} ${number(y + offsetY)}`;
  }
  return `${path} Z`;
}

/**
 * Combined sheet SVG with one subpath per panel outline and hole. Coordinates
 * are millimetres. The SVG is intended as a preview/reference for the DXF;
 * laser software should use the DXF when possible.
 */
export function buildCutSvg(model, options = {}) {
  const layout = panelLayout(model.panels);
  const stroke = options.stroke || '#ef4b3f';
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${number(layout.sheetWidth)}mm" height="${number(layout.sheetHeight)}mm" viewBox="0 0 ${number(layout.sheetWidth)} ${number(layout.sheetHeight)}">`,
  );
  parts.push('  <title>BoardForge acrylic enclosure cut sheet</title>');
  parts.push(
    '  <g fill="none" fill-rule="evenodd" stroke="' +
      stroke +
      '" stroke-width="0.08" stroke-linejoin="round" stroke-linecap="round">',
  );

  for (const { panel, offsetX, offsetY } of layout.panels) {
    const subpaths = [pathForPoints(panel.outline, offsetX, offsetY)];
    for (const hole of panel.holes) {
      subpaths.push(pathForPoints(hole.points, offsetX, offsetY));
    }
    parts.push(
      `    <g id="${panel.id}" data-panel="${panel.id}" data-label="${panel.label}">`,
    );
    parts.push(`      <path d="${subpaths.join(' ')}" />`);
    parts.push('    </g>');
  }

  parts.push('  </g>');
  parts.push('</svg>\n');
  return parts.join('\n');
}

function dxfPolyline(points, offsetX, offsetY) {
  if (points.length < 3) return '';
  const rows = [
    '0',
    'POLYLINE',
    '8',
    'CUT',
    '66',
    '1',
    '70',
    '1',
    '10',
    '0.0',
    '20',
    '0.0',
    '30',
    '0.0',
  ];
  for (const [x, y] of points) {
    rows.push('0', 'VERTEX', '8', 'CUT', '10', number(x + offsetX), '20', number(y + offsetY), '30', '0.0');
  }
  rows.push('0', 'SEQEND', '8', 'CUT');
  return rows.join('\n');
}

/**
 * DXF R12 with closed polylines on a CUT layer. Units are millimetres.
 * Kerf compensation is intentionally left to the laser cutter software.
 */
export function buildCutDxf(model) {
  const layout = panelLayout(model.panels);
  const entities = [];
  for (const { panel, offsetX, offsetY } of layout.panels) {
    entities.push(dxfPolyline(panel.outline, offsetX, offsetY));
    for (const hole of panel.holes) {
      entities.push(dxfPolyline(hole.points, offsetX, offsetY));
    }
    entities.push(
      `999\nPANEL ${panel.id.toUpperCase()} ${number(panel.bounds.width)} x ${number(panel.bounds.height)} mm`,
    );
  }

  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1009',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '9',
    '$MEASUREMENT',
    '70',
    '1',
    '9',
    '$EXTMIN',
    '10',
    '0.0',
    '20',
    '0.0',
    '30',
    '0.0',
    '9',
    '$EXTMAX',
    '10',
    number(layout.sheetWidth),
    '20',
    number(layout.sheetHeight),
    '30',
    '0.0',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'TABLES',
    '0',
    'TABLE',
    '2',
    'LAYER',
    '70',
    '1',
    '0',
    'LAYER',
    '2',
    'CUT',
    '70',
    '0',
    '62',
    '1',
    '6',
    'CONTINUOUS',
    '0',
    'ENDTAB',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...entities,
    '0',
    'ENDSEC',
    '0',
    'EOF',
    '',
  ].join('\n');
}

export function cutSheetBounds(model) {
  return panelLayout(model.panels);
}
