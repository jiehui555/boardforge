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

const DXF_PANEL_NAMES = Object.freeze({
  top: 'TOP',
  bottom: 'BOTTOM',
  front: 'FRONT',
  back: 'BACK',
  left: 'LEFT',
  right: 'RIGHT',
});

function dxfText(
  text,
  x,
  y,
  height,
  { layer = 'ANNOTATION', centered = false } = {},
) {
  const rows = [
    '0',
    'TEXT',
    '8',
    layer,
    '10',
    number(x),
    '20',
    number(y),
    '30',
    '0.0',
    '40',
    number(height),
    '1',
    String(text),
    '7',
    'STANDARD',
    '50',
    '0.0',
  ];
  if (centered) {
    rows.push('72', '1', '73', '2', '11', number(x), '21', number(y));
  }
  return rows.join('\n');
}

function cutAnnotations(model, layout) {
  const thickness = model.dimensions?.panelThickness ?? 0;
  return {
    title: 'BOARDFORGE CUT SHEET',
    info:
      `SHEET ${number(layout.sheetWidth)} x ${number(layout.sheetHeight)} mm   ` +
      `${number(thickness)} mm ACRYLIC   1:1`,
    legend: 'CUT = CUTTING PATHS   ANNOTATION = REFERENCE ONLY',
    panelLabels: layout.panels.map(({ panel, offsetX, offsetY }) => ({
      text:
        `${DXF_PANEL_NAMES[panel.id] || panel.id.toUpperCase()}  ` +
        `${number(panel.bounds.width)} x ${number(panel.bounds.height)} mm`,
      x: panel.bounds.minX + offsetX + panel.bounds.width / 2,
      y: panel.bounds.minY + offsetY - 4,
    })),
  };
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
 * DXF R12 with closed polylines on a CUT layer plus non-cutting reference
 * annotations. Units are millimetres; kerf compensation is left to the laser
 * cutter software.
 */
export function buildCutDxf(model) {
  const layout = panelLayout(model.panels);
  const annotations = cutAnnotations(model, layout);
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
  entities.push(
    dxfText(annotations.title, 6, layout.sheetHeight - 4.8, 3.2),
    dxfText(annotations.info, 6, layout.sheetHeight - 9.2, 2.4),
    dxfText(annotations.legend, 6, 2.8, 2.1),
  );
  for (const label of annotations.panelLabels) {
    entities.push(
      dxfText(label.text, label.x, label.y, 3, { centered: true }),
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
    '$DWGCODEPAGE',
    '3',
    'ANSI_1252',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '9',
    '$MEASUREMENT',
    '70',
    '1',
    '9',
    '$LTSCALE',
    '40',
    '1.0',
    '9',
    '$TEXTSTYLE',
    '7',
    'STANDARD',
    '9',
    '$CLAYER',
    '8',
    'CUT',
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
    '9',
    '$LIMMIN',
    '10',
    '0.0',
    '20',
    '0.0',
    '9',
    '$LIMMAX',
    '10',
    number(layout.sheetWidth),
    '20',
    number(layout.sheetHeight),
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'TABLES',
    '0',
    'TABLE',
    '2',
    'LTYPE',
    '70',
    '1',
    '0',
    'LTYPE',
    '2',
    'CONTINUOUS',
    '70',
    '0',
    '3',
    'Solid line',
    '72',
    '65',
    '73',
    '0',
    '40',
    '0.0',
    '0',
    'ENDTAB',
    '0',
    'TABLE',
    '2',
    'LAYER',
    '70',
    '3',
    '0',
    'LAYER',
    '2',
    '0',
    '70',
    '0',
    '62',
    '7',
    '6',
    'CONTINUOUS',
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
    'LAYER',
    '2',
    'ANNOTATION',
    '70',
    '0',
    '62',
    '7',
    '6',
    'CONTINUOUS',
    '0',
    'ENDTAB',
    '0',
    'TABLE',
    '2',
    'STYLE',
    '70',
    '1',
    '0',
    'STYLE',
    '2',
    'STANDARD',
    '70',
    '0',
    '40',
    '0.0',
    '41',
    '1.0',
    '50',
    '0.0',
    '71',
    '0',
    '42',
    '3.0',
    '3',
    'txt',
    '4',
    '',
    '0',
    'ENDTAB',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'BLOCKS',
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
