// Unit tests for the CSS parser, matcher, and cascade engine.
// Run with: node --experimental-strip-types src/cssRules.test.ts

import {
  evaluateMediaQuery,
  matchSelector,
  parseStylesheet,
  resolveCascade,
  type ElementContext,
  type ResolveContext,
} from './cssRules.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}`);
    console.log(`    ${e?.message ?? e}`);
  }
}

function describe(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

function assert(cond: any, msg = 'assert failed'): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(msg ?? `expected ${b}, got ${a}`);
}

const baseCtx: ResolveContext = {
  cssVariables: {},
  mediaContext: {},
  selectedIds: new Set<string>(),
};

// ============================================================================
// Parser
// ============================================================================

describe('parseStylesheet', () => {
  it('parses an empty stylesheet', () => {
    const p = parseStylesheet('');
    eq(p.rules.length, 0);
    eq(p.warnings.length, 0);
  });

  it('parses a single rule', () => {
    const p = parseStylesheet('.node { fill: red; stroke: blue; }');
    eq(p.rules.length, 1);
    eq(p.rules[0].declarations.length, 2);
    eq(p.rules[0].declarations[0].property, 'fill');
    eq(p.rules[0].declarations[0].value, 'red');
  });

  it('parses comma-separated selector lists', () => {
    const p = parseStylesheet('.a, .b, .c { fill: red; }');
    eq(p.rules.length, 1);
    eq(p.rules[0].selectors.length, 3);
  });

  it('parses !important', () => {
    const p = parseStylesheet('.x { fill: red !important; stroke: blue; }');
    eq(p.rules[0].declarations[0].important, true);
    eq(p.rules[0].declarations[1].important, false);
  });

  it('parses compound selectors with correct specificity', () => {
    const p = parseStylesheet('rect.node#foo { fill: red; }');
    eq(p.rules[0].selectors[0].specificity, [1, 1, 1]);
  });

  it('parses descendant combinator', () => {
    const p = parseStylesheet('.cluster .label { fill: red; }');
    eq(p.rules[0].selectors[0].parts.length, 2);
    eq(p.rules[0].selectors[0].combinators[1], ' ');
  });

  it('parses child combinator', () => {
    const p = parseStylesheet('.cluster > .label { fill: red; }');
    eq(p.rules[0].selectors[0].combinators[1], '>');
  });

  it('parses attribute selectors', () => {
    const p = parseStylesheet('rect[data-kind="node"] { fill: red; }');
    eq(p.rules[0].selectors[0].parts[0].attributes.length, 1);
    eq(p.rules[0].selectors[0].parts[0].attributes[0].name, 'data-kind');
    eq(p.rules[0].selectors[0].parts[0].attributes[0].op, '=');
    eq(p.rules[0].selectors[0].parts[0].attributes[0].value, 'node');
  });

  it('parses :nth-child', () => {
    const p = parseStylesheet('rect:nth-child(2n+1) { fill: red; }');
    const pc = p.rules[0].selectors[0].parts[0].pseudoClasses[0];
    eq(pc.name, 'nth-child');
    assert(pc.args?.kind === 'nth');
    eq(pc.args.a, 2);
    eq(pc.args.b, 1);
  });

  it('handles @media blocks', () => {
    const p = parseStylesheet('@media (prefers-color-scheme: dark) { .node { fill: white; } }');
    eq(p.rules.length, 1);
    assert(p.rules[0].conditions);
    eq(p.rules[0].conditions![0].kind, 'media');
  });

  it('handles @keyframes', () => {
    const p = parseStylesheet('@keyframes spin { 0% { opacity: 0; } 100% { opacity: 1; } }');
    eq(p.keyframes.length, 1);
    eq(p.keyframes[0].name, 'spin');
    eq(p.keyframes[0].frames.length, 2);
  });

  it('handles @font-face', () => {
    const p = parseStylesheet('@font-face { font-family: Foo; src: url(foo.woff2); }');
    eq(p.fontFaces.length, 1);
    eq(p.fontFaces[0].family, 'Foo');
  });

  it('collects :root variables', () => {
    const p = parseStylesheet(':root { --primary: #f59e0b; --secondary: #10b981; }');
    eq(p.rootVariables['--primary'], '#f59e0b');
    eq(p.rootVariables['--secondary'], '#10b981');
  });

  it('strips C-style comments', () => {
    const p = parseStylesheet('/* hi */ .node { fill: red; /* inline */ stroke: blue; }');
    eq(p.rules[0].declarations.length, 2);
  });
});

// ============================================================================
// Selector matching
// ============================================================================

describe('matchSelector', () => {
  const el = (
    tag: string,
    id?: string,
    classes?: string[],
    attrs?: Record<string, string>,
  ): ElementContext => ({ tag, id, classes, attributes: attrs });

  it('matches tag selectors', () => {
    const sel = parseStylesheet('rect { fill: red; }').rules[0].selectors[0];
    assert(matchSelector(sel, [el('rect')], baseCtx));
    assert(!matchSelector(sel, [el('circle')], baseCtx));
  });

  it('matches class selectors', () => {
    const sel = parseStylesheet('.node { fill: red; }').rules[0].selectors[0];
    assert(matchSelector(sel, [el('rect', undefined, ['node'])], baseCtx));
    assert(!matchSelector(sel, [el('rect', undefined, ['edge'])], baseCtx));
  });

  it('matches id selectors', () => {
    const sel = parseStylesheet('#foo { fill: red; }').rules[0].selectors[0];
    assert(matchSelector(sel, [el('rect', 'foo')], baseCtx));
    assert(!matchSelector(sel, [el('rect', 'bar')], baseCtx));
  });

  it('matches compound selectors', () => {
    const sel = parseStylesheet('rect.node { fill: red; }').rules[0].selectors[0];
    assert(matchSelector(sel, [el('rect', undefined, ['node'])], baseCtx));
    assert(!matchSelector(sel, [el('circle', undefined, ['node'])], baseCtx));
    assert(!matchSelector(sel, [el('rect', undefined, ['edge'])], baseCtx));
  });

  it('matches descendant selectors', () => {
    const sel = parseStylesheet('.cluster .label { fill: red; }').rules[0].selectors[0];
    const stack = [el('g', undefined, ['cluster']), el('g'), el('text', undefined, ['label'])];
    assert(matchSelector(sel, stack, baseCtx));
    assert(!matchSelector(sel, [el('g'), el('text', undefined, ['label'])], baseCtx));
  });

  it('matches child selectors strictly', () => {
    const sel = parseStylesheet('.cluster > .label { fill: red; }').rules[0].selectors[0];
    const direct = [el('g', undefined, ['cluster']), el('text', undefined, ['label'])];
    assert(matchSelector(sel, direct, baseCtx));
    const indirect = [el('g', undefined, ['cluster']), el('g'), el('text', undefined, ['label'])];
    assert(!matchSelector(sel, indirect, baseCtx));
  });

  it('matches attribute selectors with =', () => {
    const sel = parseStylesheet('[data-kind="node"] { fill: red; }').rules[0].selectors[0];
    assert(matchSelector(sel, [el('rect', undefined, undefined, { 'data-kind': 'node' })], baseCtx));
    assert(!matchSelector(sel, [el('rect', undefined, undefined, { 'data-kind': 'edge' })], baseCtx));
  });

  it('matches :hover when id is in selectedIds', () => {
    const sel = parseStylesheet('.node:hover { fill: red; }').rules[0].selectors[0];
    const ctx: ResolveContext = { ...baseCtx, selectedIds: new Set(['n1']) };
    assert(matchSelector(sel, [el('rect', 'n1', ['node'])], ctx));
    assert(!matchSelector(sel, [el('rect', 'n2', ['node'])], ctx));
  });

  it('matches :not()', () => {
    const sel = parseStylesheet('.node:not(.disabled) { fill: red; }').rules[0].selectors[0];
    assert(matchSelector(sel, [el('rect', undefined, ['node'])], baseCtx));
    assert(!matchSelector(sel, [el('rect', undefined, ['node', 'disabled'])], baseCtx));
  });
});

// ============================================================================
// Cascade engine
// ============================================================================

describe('resolveCascade', () => {
  const el = (tag: string, id?: string, classes?: string[]): ElementContext => ({
    tag,
    id,
    classes,
  });

  it('applies a single matching rule', () => {
    const parsed = parseStylesheet('.node { fill: red; stroke: blue; }');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', 'n1', ['node'])],
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.fill, 'red');
    eq(resolved.stroke, 'blue');
  });

  it('breaks specificity ties by source order', () => {
    const parsed = parseStylesheet('.node { fill: red; } .node { fill: blue; }');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', undefined, ['node'])],
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.fill, 'blue');
  });

  it('higher specificity wins', () => {
    const parsed = parseStylesheet('.node { fill: red; } #foo { fill: blue; }');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', 'foo', ['node'])],
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.fill, 'blue');
  });

  it('!important wins over higher specificity', () => {
    const parsed = parseStylesheet('#foo { fill: red; } .node { fill: blue !important; }');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', 'foo', ['node'])],
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.fill, 'blue');
  });

  it('inherits inheritable props', () => {
    const parsed = parseStylesheet('');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect')],
      inherited: { fill: 'red', 'font-size': '16px', width: '100' },
      ctx: baseCtx,
    });
    eq(resolved.fill, 'red');
    eq(resolved['font-size'], '16px');
    assert(resolved['width'] === undefined, 'width should not inherit');
  });

  it('resolves var()', () => {
    const parsed = parseStylesheet(':root { --c: red; } .node { fill: var(--c); }');
    const ctx: ResolveContext = { ...baseCtx, cssVariables: { ...parsed.rootVariables } };
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', undefined, ['node'])],
      inherited: {},
      ctx,
    });
    eq(resolved.fill, 'red');
  });

  it('resolves var() with fallback', () => {
    const parsed = parseStylesheet('.node { fill: var(--missing, blue); }');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', undefined, ['node'])],
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.fill, 'blue');
  });

  it('resolves currentColor', () => {
    const parsed = parseStylesheet('.node { color: red; stroke: currentColor; }');
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', undefined, ['node'])],
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.stroke, 'red');
  });

  it('respects @media queries via mediaContext', () => {
    const parsed = parseStylesheet(`
      .node { fill: white; }
      @media (prefers-color-scheme: dark) { .node { fill: black; } }
    `);
    const light = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', undefined, ['node'])],
      inherited: {},
      ctx: { ...baseCtx, mediaContext: { darkMode: false } },
    });
    eq(light.fill, 'white');
    const dark = resolveCascade({
      rules: parsed.rules,
      stack: [el('rect', undefined, ['node'])],
      inherited: {},
      ctx: { ...baseCtx, mediaContext: { darkMode: true } },
    });
    eq(dark.fill, 'black');
  });
});

// ============================================================================
// Media-query evaluator
// ============================================================================

describe('evaluateMediaQuery', () => {
  it('handles prefers-color-scheme: dark', () => {
    const q = parseStylesheet('@media (prefers-color-scheme: dark) {}').rules;
    // No rules emitted but media is parsed via condition; build a query directly.
    const parsed = parseStylesheet('@media (prefers-color-scheme: dark) { .x { fill: red; } }');
    const cond = parsed.rules[0].conditions![0];
    assert(cond.kind === 'media');
    eq(evaluateMediaQuery(cond.query, { darkMode: true }), true);
    eq(evaluateMediaQuery(cond.query, { darkMode: false }), false);
  });

  it('handles max-width', () => {
    const parsed = parseStylesheet('@media (max-width: 600px) { .x { fill: red; } }');
    const cond = parsed.rules[0].conditions![0];
    assert(cond.kind === 'media');
    eq(evaluateMediaQuery(cond.query, { viewportWidth: 400 }), true);
    eq(evaluateMediaQuery(cond.query, { viewportWidth: 800 }), false);
  });
});

// ============================================================================
// Integration — full Mermaid-style snippet
// ============================================================================

describe('integration: Mermaid-style stylesheet', () => {
  const MERMAID_CSS = `
    .node rect, .node circle, .node polygon { fill: #ECECFF; stroke: #9370DB; stroke-width: 1px; }
    .node .label { color: #333; font-size: 14px; }
    .cluster rect { fill: #ffffde; stroke: #aaaa33; }
    .edgePath .path { stroke: #333; stroke-width: 1.5px; fill: none; }
    .edgeLabel { background-color: white; color: #333; }
    @media (prefers-color-scheme: dark) {
      .node rect { fill: #2d2d2d; stroke: #888; }
      .node .label { color: #eee; }
    }
  `;

  it('matches Mermaid node rectangle in light mode', () => {
    const parsed = parseStylesheet(MERMAID_CSS);
    const stack: ElementContext[] = [
      { tag: 'g', classes: ['node'] },
      { tag: 'rect' },
    ];
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack,
      inherited: {},
      ctx: { ...baseCtx, mediaContext: { darkMode: false } },
    });
    eq(resolved.fill, '#ECECFF');
    eq(resolved.stroke, '#9370DB');
  });

  it('matches Mermaid node rectangle in dark mode (media query wins)', () => {
    const parsed = parseStylesheet(MERMAID_CSS);
    const stack: ElementContext[] = [
      { tag: 'g', classes: ['node'] },
      { tag: 'rect' },
    ];
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack,
      inherited: {},
      ctx: { ...baseCtx, mediaContext: { darkMode: true } },
    });
    eq(resolved.fill, '#2d2d2d');
    eq(resolved.stroke, '#888');
  });

  it('matches edge path styling', () => {
    const parsed = parseStylesheet(MERMAID_CSS);
    const stack: ElementContext[] = [
      { tag: 'g', classes: ['edgePath'] },
      { tag: 'path', classes: ['path'] },
    ];
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack,
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.stroke, '#333');
    eq(resolved['stroke-width'], '1.5px');
    eq(resolved.fill, 'none');
  });

  // Regression: Mermaid uses id-prefixed selectors. The SVG root must be in
  // the ancestor stack for these to match. Renderers calling resolveCascade
  // MUST seed the stack with the <svg> root element context.
  it('matches Mermaid id-prefixed selectors (#diagram .node rect)', () => {
    const css = `
      #diagram { font-size: 18px; fill: #212121; }
      #diagram .node rect { fill: #FFF8F2; stroke: #666; stroke-width: 1px; }
      #diagram .edgePath .path { stroke: #666; stroke-width: 2px; fill: none; }
    `;
    const parsed = parseStylesheet(css);
    const stack: ElementContext[] = [
      { tag: 'svg', id: 'diagram' },
      { tag: 'g' },
      { tag: 'g', classes: ['root'] },
      { tag: 'g', classes: ['nodes'] },
      { tag: 'g', id: 'flowchart-n1-0', classes: ['node'] },
      { tag: 'rect', classes: ['basic', 'label-container'] },
    ];
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack,
      inherited: {},
      ctx: baseCtx,
    });
    eq(resolved.fill, '#FFF8F2', 'node rect fill must come from #diagram .node rect');
    eq(resolved.stroke, '#666');
    eq(resolved['stroke-width'], '1px');
  });

  // Same selector but WITHOUT the svg root — the renderer bug we're guarding
  // against. Should NOT match.
  it('does NOT match id-prefixed selectors when SVG root is absent', () => {
    const css = `#diagram .node rect { fill: #FFF8F2; }`;
    const parsed = parseStylesheet(css);
    const stack: ElementContext[] = [
      // No <svg id="diagram"> — bug condition
      { tag: 'g', id: 'flowchart-n1-0', classes: ['node'] },
      { tag: 'rect' },
    ];
    const resolved = resolveCascade({
      rules: parsed.rules,
      stack,
      inherited: {},
      ctx: baseCtx,
    });
    assert(resolved.fill === undefined, 'should not match without svg ancestor');
  });
});

// ============================================================================
// Runner output
// ============================================================================

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
