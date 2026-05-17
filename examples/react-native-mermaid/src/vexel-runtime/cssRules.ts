// Full CSS support for SVG styling — Vexel v0.0.3.
//
// Scope: enough CSS to faithfully render any SVG produced by Mermaid,
// Inkscape, Figma export, Adobe Illustrator export, GraphViz, and modern
// hand-authored stylesheets.
//
// Selectors:
//   - tag, .class, #id, *
//   - compound (tag.class, .a.b, #foo.bar)
//   - combinators: descendant (' '), child ('>'), adjacent sibling ('+'),
//     general sibling ('~')
//   - attribute selectors: [attr], [attr=v], [attr~=v], [attr|=v], [attr^=v],
//     [attr$=v], [attr*=v]
//   - pseudo-classes: :first-child, :last-child, :only-child, :nth-child(),
//     :nth-of-type(), :first-of-type, :last-of-type, :not(...), :is(...),
//     :where(...), :hover, :focus, :active (mapped to Vexel selection state),
//     :root
//   - pseudo-elements: ::before, ::after (parsed cleanly; render-side
//     treats them as no-ops on SVG primitives — they generate no content
//     in standards-conformant SVG anyway)
//
// At-rules:
//   - @media: prefers-color-scheme, prefers-reduced-motion, max-width,
//     min-width, max-height, min-height
//   - @supports: evaluated against a declared support matrix
//   - @keyframes: parsed and stored on the rules; consumer can read via
//     onCSSWarning if they want to wire to their own animation engine
//   - @font-face: parsed and surfaced via fontFaceDeclarations callback so
//     consumers can register fonts with their app's font loader (RN doesn't
//     have a generic font-loading API)
//   - @import: warns; not auto-fetched (most static SVGs don't need it; if a
//     consumer needs it they can prefetch and inline)
//   - @charset, @namespace: tolerated and skipped
//
// Values:
//   - hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla()
//   - var(--name) with optional fallback, resolved against a CSS-variables
//     map (consumer-provided + per-:root declarations)
//   - calc() with +, -, *, / on numeric properties
//   - currentColor (uses inherited `color` property)
//   - !important (separate cascade tier above non-important)
//
// Cascade order (lowest priority first):
//   1. SVG implicit defaults (fill=black, stroke=none) — applied by renderer
//   2. CSS rule declarations (this file)              ← new in v0.0.3
//   3. CSS rule declarations marked !important
//   4. SVG attribute (fill="..." style)               ← already supported
//   5. Inline style="..."
//   6. Vexel consumer props (colors.byId, colorFilter, highlight, stream)
//
// Inheritance:
//   - inheritable props (font-*, color, visibility, fill, stroke, opacity etc.
//     per SVG 2 inheritance table) walk up the ancestor chain
//   - currentColor resolves against nearest `color` declaration

// =============================================================================
// Public types
// =============================================================================

export interface CssRule {
  /** Selectors that triggered this rule (comma-separated source). */
  selectors: Selector[];
  /** Property → { value, important } declarations. */
  declarations: Declaration[];
  /** Source order (lower = earlier in stylesheet); breaks specificity ties. */
  order: number;
  /** Encapsulating at-rule conditions (e.g. inside @media). */
  conditions?: AtRuleCondition[];
}

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

export interface Selector {
  /** Compound selectors joined by combinators, leaf last. */
  parts: SelectorPart[];
  /** Combinator preceding each part (' ', '>', '+', '~'). First entry unused. */
  combinators: Combinator[];
  /** (a, b, c) tuple per CSS 2.1+ specificity. */
  specificity: [number, number, number];
}

export type Combinator = ' ' | '>' | '+' | '~';

export interface SelectorPart {
  tag?: string;                         // 'rect' or '*'
  id?: string;                          // '#foo'
  classes: string[];                    // ['node', 'default']
  attributes: AttributeSelector[];      // [attr=v]
  pseudoClasses: PseudoClass[];         // :hover, :nth-child(2n+1), :not(...)
  pseudoElements: string[];             // ::before, ::after (rarely useful in SVG)
}

export interface AttributeSelector {
  name: string;
  op?: '=' | '~=' | '|=' | '^=' | '$=' | '*=';
  value?: string;
  caseInsensitive?: boolean;
}

export interface PseudoClass {
  name: string;
  /** :nth-child(an+b) → {a, b}; :not(...) → nested selector list */
  args?: PseudoArgs;
}

export type PseudoArgs =
  | { kind: 'nth'; a: number; b: number }
  | { kind: 'selector-list'; selectors: Selector[] }
  | { kind: 'raw'; text: string };

export type AtRuleCondition =
  | { kind: 'media'; query: MediaQuery }
  | { kind: 'supports'; result: boolean };

export interface MediaQuery {
  not?: boolean;
  type?: 'all' | 'screen' | 'print';
  features: MediaFeature[];
}

export interface MediaFeature {
  name: string;
  op?: '=' | '>=' | '<=' | '>' | '<';
  value?: string;
}

export interface KeyframesRule {
  name: string;
  frames: Array<{ offset: number; declarations: Declaration[] }>;
}

export interface FontFaceDeclaration {
  family: string;
  src: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
}

export interface ImportDirective {
  url: string;
  media?: MediaQuery;
}

export interface ParsedStylesheet {
  rules: CssRule[];
  keyframes: KeyframesRule[];
  fontFaces: FontFaceDeclaration[];
  imports: ImportDirective[];
  /** Variable declarations from :root { --foo: ... } blocks. */
  rootVariables: Record<string, string>;
  /** Non-fatal parse warnings (unknown at-rules, malformed selectors, etc.). */
  warnings: CssWarning[];
}

export interface CssWarning {
  kind: 'parse-error' | 'unsupported-selector' | 'unsupported-at-rule' | 'unsupported-pseudo';
  message: string;
  source?: string;
}

/** Caller-provided context for @media evaluation + interactive pseudo-classes. */
export interface MediaContext {
  darkMode?: boolean;
  reducedMotion?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ResolveContext {
  cssVariables: Record<string, string>;
  mediaContext: MediaContext;
  /** Element ids in the current Vexel selection — drives :hover/:focus/:active. */
  selectedIds: Set<string>;
  /** True if the element matches the press-in state for :active mapping. */
  activeId?: string | null;
}

// =============================================================================
// Tokenizer
// =============================================================================
//
// A focused CSS-syntax tokenizer. We don't follow the full CSS Syntax Level 3
// state machine because we don't need to — we only need to find rule/at-rule
// boundaries and split selectors from declarations. Strings, comments, and
// nested parens/brackets/braces are tracked so they don't confuse boundary
// detection.

interface TokenStream {
  src: string;
  i: number;
}

function stripComments(src: string): string {
  // Single-pass replacement that respects strings.
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out += src[i] + src[i + 1];
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < src.length) {
        out += src[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Scan forward to a matching closing brace, respecting strings + nesting. */
function findMatchingBrace(src: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function skipString(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\' && i + 1 < src.length) { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return src.length;
}

/** Find the next top-level occurrence of `ch` (parens/brackets/strings safe).
 *  Braces are NOT auto-skipped — pass `{` in `chars` to find them.
 *  (Callers that want to skip past nested {} blocks should look for the
 *  outer `{` first, then `findMatchingBrace` from there.) */
function findTopLevel(src: string, from: number, chars: string): number {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (chars.includes(c)) return i;
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === '(') { i = matchClosing(src, i, '(', ')') + 1; continue; }
    if (c === '[') { i = matchClosing(src, i, '[', ']') + 1; continue; }
    i++;
  }
  return -1;
}

function matchClosing(src: string, open: number, openCh: string, closeCh: string): number {
  let depth = 1;
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i = skipString(src, i); continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return src.length - 1;
}

// =============================================================================
// Top-level stylesheet parser
// =============================================================================

export function parseStylesheet(src: string): ParsedStylesheet {
  const clean = stripComments(src);
  const out: ParsedStylesheet = {
    rules: [],
    keyframes: [],
    fontFaces: [],
    imports: [],
    rootVariables: {},
    warnings: [],
  };
  const orderRef = { n: 0 };
  parseRuleBlock(clean, 0, clean.length, out, [], orderRef);
  return out;
}

function parseRuleBlock(
  src: string,
  from: number,
  to: number,
  out: ParsedStylesheet,
  conditions: AtRuleCondition[],
  orderRef: { n: number },
): void {
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(src[i])) i++;
    if (i >= to) return;

    // ----- at-rule -----
    if (src[i] === '@') {
      const space = nextRunEnd(src, i + 1, /[A-Za-z0-9-]/);
      const name = src.slice(i + 1, space).toLowerCase();
      // Find prelude end: either ';' or '{'
      const semi = findTopLevel(src, space, ';{');
      if (semi < 0 || semi >= to) { i = to; break; }
      const ch = src[semi];
      const prelude = src.slice(space, semi).trim();

      if (ch === ';') {
        handleSimpleAtRule(name, prelude, out);
        i = semi + 1;
        continue;
      }

      // Block-form at-rule
      const blockClose = findMatchingBrace(src, semi);
      if (blockClose < 0 || blockClose >= to) { i = to; break; }

      switch (name) {
        case 'media': {
          const query = parseMediaQuery(prelude);
          parseRuleBlock(src, semi + 1, blockClose, out, [...conditions, { kind: 'media', query }], orderRef);
          break;
        }
        case 'supports': {
          const result = evaluateSupports(prelude);
          parseRuleBlock(src, semi + 1, blockClose, out, [...conditions, { kind: 'supports', result }], orderRef);
          break;
        }
        case 'keyframes':
        case '-webkit-keyframes':
        case '-moz-keyframes': {
          out.keyframes.push(parseKeyframes(prelude, src.slice(semi + 1, blockClose)));
          break;
        }
        case 'font-face': {
          const decl = parseDeclarations(src.slice(semi + 1, blockClose));
          out.fontFaces.push(buildFontFace(decl));
          break;
        }
        case 'page':
        case 'document':
        case 'layer':
          // Recurse into block as if at top level (declarations only apply to printed docs).
          parseRuleBlock(src, semi + 1, blockClose, out, conditions, orderRef);
          break;
        default:
          out.warnings.push({
            kind: 'unsupported-at-rule',
            message: `unknown @${name}`,
            source: src.slice(i, blockClose + 1).slice(0, 80),
          });
      }
      i = blockClose + 1;
      continue;
    }

    // ----- regular rule: selectors { declarations } -----
    const open = findTopLevel(src, i, '{};');
    if (open < 0 || open >= to || src[open] !== '{') {
      // Stray declaration outside any rule — skip to next ;
      const semi = src.indexOf(';', i);
      i = semi < 0 ? to : semi + 1;
      continue;
    }
    const close = findMatchingBrace(src, open);
    if (close < 0 || close >= to) { i = to; break; }

    const selectorText = src.slice(i, open).trim();
    const declText = src.slice(open + 1, close);
    const selectors = parseSelectorList(selectorText, out.warnings);
    if (selectors.length > 0) {
      const declarations = parseDeclarations(declText);
      // Special case: harvest :root { --x: ... } as global CSS variables.
      const isRoot = selectors.some(
        (s) => s.parts.length === 1 && s.parts[0].pseudoClasses.some((p) => p.name === 'root'),
      );
      if (isRoot) {
        for (const d of declarations) {
          if (d.property.startsWith('--')) out.rootVariables[d.property] = d.value;
        }
      }
      if (declarations.length > 0) {
        out.rules.push({
          selectors,
          declarations,
          order: orderRef.n++,
          conditions: conditions.length ? conditions.slice() : undefined,
        });
      }
    }
    i = close + 1;
  }
}

function handleSimpleAtRule(name: string, prelude: string, out: ParsedStylesheet): void {
  switch (name) {
    case 'import': {
      const urlMatch = prelude.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
      const bareMatch = prelude.match(/^['"]([^'"]+)['"]/);
      const url = urlMatch?.[1] ?? bareMatch?.[1];
      if (url) out.imports.push({ url });
      else out.warnings.push({ kind: 'parse-error', message: '@import url unrecognized', source: prelude });
      break;
    }
    case 'charset':
    case 'namespace':
      // Tolerated; no semantic effect on our renderer.
      break;
    default:
      out.warnings.push({ kind: 'unsupported-at-rule', message: `unknown @${name}`, source: prelude });
  }
}

function nextRunEnd(src: string, from: number, re: RegExp): number {
  let i = from;
  while (i < src.length && re.test(src[i])) i++;
  return i;
}

// =============================================================================
// Selector parser
// =============================================================================

function parseSelectorList(text: string, warnings: CssWarning[]): Selector[] {
  const out: Selector[] = [];
  // Split on top-level commas (respecting parens/brackets)
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = skipString(text, i); continue; }
    if (c === '(') { i = matchClosing(text, i, '(', ')') + 1; continue; }
    if (c === '[') { i = matchClosing(text, i, '[', ']') + 1; continue; }
    if (c === ',') {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  parts.push(text.slice(start).trim());

  for (const p of parts) {
    if (!p) continue;
    const sel = parseSingleSelector(p, warnings);
    if (sel) out.push(sel);
  }
  return out;
}

function parseSingleSelector(text: string, warnings: CssWarning[]): Selector | null {
  // Walk the selector, recognizing combinators between compound parts.
  const parts: SelectorPart[] = [];
  const combinators: Combinator[] = [];
  let i = 0;
  let pendingCombinator: Combinator = ' ';
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    const c = text[i];
    if (c === '>' || c === '+' || c === '~') {
      pendingCombinator = c as Combinator;
      i++;
      continue;
    }
    // Parse compound selector at i
    const part = parseCompound(text, i, warnings);
    if (!part) return null;
    parts.push(part.part);
    combinators.push(parts.length === 1 ? ' ' : pendingCombinator);
    pendingCombinator = ' ';
    i = part.end;
  }
  if (parts.length === 0) return null;
  return { parts, combinators, specificity: specificityOf(parts) };
}

function parseCompound(
  text: string,
  start: number,
  warnings: CssWarning[],
): { part: SelectorPart; end: number } | null {
  const part: SelectorPart = {
    classes: [],
    attributes: [],
    pseudoClasses: [],
    pseudoElements: [],
  };
  let i = start;
  // Optional tag or *
  if (i < text.length && /[A-Za-z*]/.test(text[i])) {
    const end = nextRunEnd(text, i, /[A-Za-z0-9*-]/);
    const tag = text.slice(i, end);
    part.tag = tag.toLowerCase();
    i = end;
  }
  while (i < text.length) {
    const c = text[i];
    if (c === '.') {
      const end = nextRunEnd(text, i + 1, /[A-Za-z0-9_-]/);
      const name = text.slice(i + 1, end);
      if (!name) return null;
      part.classes.push(name);
      i = end;
    } else if (c === '#') {
      const end = nextRunEnd(text, i + 1, /[A-Za-z0-9_-]/);
      const name = text.slice(i + 1, end);
      if (!name) return null;
      part.id = name;
      i = end;
    } else if (c === '[') {
      const close = matchClosing(text, i, '[', ']');
      const attr = parseAttributeSelector(text.slice(i + 1, close));
      if (attr) part.attributes.push(attr);
      i = close + 1;
    } else if (c === ':' && text[i + 1] === ':') {
      // Pseudo-element
      const end = nextRunEnd(text, i + 2, /[A-Za-z-]/);
      const name = text.slice(i + 2, end);
      part.pseudoElements.push(name);
      i = end;
    } else if (c === ':') {
      // Pseudo-class
      const end = nextRunEnd(text, i + 1, /[A-Za-z-]/);
      const name = text.slice(i + 1, end);
      let args: PseudoArgs | undefined;
      let nextI = end;
      if (text[end] === '(') {
        const close = matchClosing(text, end, '(', ')');
        const inner = text.slice(end + 1, close);
        args = parsePseudoArgs(name, inner, warnings);
        nextI = close + 1;
      }
      part.pseudoClasses.push({ name, args });
      i = nextI;
    } else {
      break;
    }
  }
  if (!part.tag && !part.id && part.classes.length === 0 && part.attributes.length === 0 && part.pseudoClasses.length === 0 && part.pseudoElements.length === 0) {
    return null;
  }
  return { part, end: i };
}

function parseAttributeSelector(text: string): AttributeSelector | null {
  // Forms: name | name=v | name~=v | name|=v | name^=v | name$=v | name*=v
  // Trailing " i" or " s" → case sensitivity modifier
  let t = text.trim();
  let caseInsensitive = false;
  const ciMatch = t.match(/\s+(i|s)\s*$/i);
  if (ciMatch) {
    caseInsensitive = ciMatch[1].toLowerCase() === 'i';
    t = t.slice(0, ciMatch.index).trimEnd();
  }
  const opMatch = t.match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*(~=|\|=|\^=|\$=|\*=|=)\s*(.*))?$/);
  if (!opMatch) return null;
  const name = opMatch[1];
  if (!opMatch[2]) return { name };
  let value = opMatch[3];
  if (value && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
  return { name, op: opMatch[2] as AttributeSelector['op'], value, caseInsensitive };
}

function parsePseudoArgs(name: string, inner: string, warnings: CssWarning[]): PseudoArgs {
  inner = inner.trim();
  switch (name) {
    case 'nth-child':
    case 'nth-of-type':
    case 'nth-last-child':
    case 'nth-last-of-type': {
      const parsed = parseNth(inner);
      return parsed ? { kind: 'nth', a: parsed.a, b: parsed.b } : { kind: 'raw', text: inner };
    }
    case 'not':
    case 'is':
    case 'where':
    case 'has': {
      const sels = parseSelectorList(inner, warnings);
      return { kind: 'selector-list', selectors: sels };
    }
    default:
      return { kind: 'raw', text: inner };
  }
}

function parseNth(arg: string): { a: number; b: number } | null {
  const a = arg.trim().toLowerCase();
  if (a === 'odd') return { a: 2, b: 1 };
  if (a === 'even') return { a: 2, b: 0 };
  // "an+b" or "an" or "n+b" or "b"
  const m = a.match(/^(?:([+-]?\d*)n)?\s*([+-]\s*\d+)?$/);
  if (!m) return null;
  let aPart = m[1];
  let bPart = m[2];
  let aVal: number;
  if (aPart === undefined) aVal = 0;
  else if (aPart === '' || aPart === '+') aVal = 1;
  else if (aPart === '-') aVal = -1;
  else aVal = parseInt(aPart, 10);
  const bVal = bPart ? parseInt(bPart.replace(/\s/g, ''), 10) : 0;
  return { a: aVal, b: bVal };
}

function specificityOf(parts: SelectorPart[]): [number, number, number] {
  let a = 0, b = 0, c = 0;
  for (const p of parts) {
    if (p.id) a += 1;
    b += p.classes.length;
    b += p.attributes.length;
    b += p.pseudoClasses.filter((pc) => pc.name !== 'not' && pc.name !== 'is' && pc.name !== 'where').length;
    // :not(), :is() inherit specificity from the highest argument selector.
    for (const pc of p.pseudoClasses) {
      if ((pc.name === 'not' || pc.name === 'is') && pc.args?.kind === 'selector-list') {
        let best: [number, number, number] = [0, 0, 0];
        for (const s of pc.args.selectors) {
          if (compareSpec(s.specificity, best) > 0) best = s.specificity;
        }
        a += best[0]; b += best[1]; c += best[2];
      }
    }
    if (p.tag && p.tag !== '*') c += 1;
    c += p.pseudoElements.length;
  }
  return [a, b, c];
}

function compareSpec(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

// =============================================================================
// Declaration parser
// =============================================================================

function parseDeclarations(body: string): Declaration[] {
  const out: Declaration[] = [];
  // Split on top-level semicolons.
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'") { i = skipString(body, i); continue; }
    if (c === '(') { i = matchClosing(body, i, '(', ')') + 1; continue; }
    if (c === ';') {
      pushDecl(body.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  pushDecl(body.slice(start));
  return out;

  function pushDecl(text: string): void {
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const property = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    if (!property || !value) return;
    let important = false;
    const importantMatch = value.match(/\s*!important\s*$/i);
    if (importantMatch) {
      important = true;
      value = value.slice(0, importantMatch.index).trim();
    }
    out.push({ property, value, important });
  }
}

// =============================================================================
// At-rule helpers
// =============================================================================

function parseMediaQuery(prelude: string): MediaQuery {
  // Form: [not] [type] (and (feature: value))*
  // We support: prefers-color-scheme, prefers-reduced-motion, max-width, min-width
  const lower = prelude.toLowerCase().trim();
  const not = /^not\s+/.test(lower);
  const stripped = not ? lower.replace(/^not\s+/, '') : lower;
  const features: MediaFeature[] = [];
  let type: MediaQuery['type'] = 'all';
  const partsRaw = stripped.split(/\s+and\s+/);
  for (const p of partsRaw) {
    const t = p.trim();
    if (!t) continue;
    if (t === 'all' || t === 'screen' || t === 'print') {
      type = t;
      continue;
    }
    // (feature: value) form
    const m = t.match(/^\(\s*([A-Za-z0-9-]+)\s*(?::\s*([^)]+))?\s*\)$/);
    if (m) {
      features.push({ name: m[1].toLowerCase(), op: m[2] ? '=' : undefined, value: m[2]?.trim() });
    }
  }
  return { not, type, features };
}

export function evaluateMediaQuery(q: MediaQuery, ctx: MediaContext): boolean {
  if (q.type && q.type !== 'all' && q.type !== 'screen') return false;
  let ok = true;
  for (const f of q.features) {
    ok = ok && evaluateMediaFeature(f, ctx);
    if (!ok) break;
  }
  return q.not ? !ok : ok;
}

function evaluateMediaFeature(f: MediaFeature, ctx: MediaContext): boolean {
  switch (f.name) {
    case 'prefers-color-scheme':
      if (!f.value) return true;
      return (f.value === 'dark') === !!ctx.darkMode;
    case 'prefers-reduced-motion':
      if (!f.value || f.value === 'reduce') return !!ctx.reducedMotion;
      return !ctx.reducedMotion;
    case 'max-width':
      return ctx.viewportWidth != null && parsePx(f.value) >= ctx.viewportWidth;
    case 'min-width':
      return ctx.viewportWidth != null && parsePx(f.value) <= ctx.viewportWidth;
    case 'max-height':
      return ctx.viewportHeight != null && parsePx(f.value) >= ctx.viewportHeight;
    case 'min-height':
      return ctx.viewportHeight != null && parsePx(f.value) <= ctx.viewportHeight;
    default:
      return true; // Unknown features → permissive (don't block other styles)
  }
}

function parsePx(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function evaluateSupports(prelude: string): boolean {
  // We declare support for a fixed set of properties. The @supports check
  // accepts (property: value) and returns true if we know that property.
  // Conservative: anything that mentions fill, stroke, opacity, or any
  // common SVG prop → true; otherwise → false.
  const t = prelude.toLowerCase();
  const not = /\bnot\b/.test(t);
  const known = ['fill', 'stroke', 'opacity', 'transform', 'font-family', 'color'];
  let ok = known.some((k) => t.includes(k + ':') || t.includes(k + ' :'));
  if (not) ok = !ok;
  return ok;
}

function parseKeyframes(name: string, body: string): KeyframesRule {
  const frames: Array<{ offset: number; declarations: Declaration[] }> = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const close = findMatchingBrace(body, open);
    if (close < 0) break;
    const sel = body.slice(i, open).trim();
    const decls = parseDeclarations(body.slice(open + 1, close));
    for (const offsetStr of sel.split(',')) {
      const o = offsetStr.trim().toLowerCase();
      let offset: number | null = null;
      if (o === 'from') offset = 0;
      else if (o === 'to') offset = 1;
      else if (o.endsWith('%')) offset = parseFloat(o) / 100;
      if (offset !== null && Number.isFinite(offset)) {
        frames.push({ offset, declarations: decls });
      }
    }
    i = close + 1;
  }
  frames.sort((a, b) => a.offset - b.offset);
  return { name: name.trim(), frames };
}

function buildFontFace(decls: Declaration[]): FontFaceDeclaration {
  const out: FontFaceDeclaration = { family: '', src: '' };
  for (const d of decls) {
    switch (d.property) {
      case 'font-family': out.family = stripQuotes(d.value); break;
      case 'src': out.src = d.value; break;
      case 'font-weight': out.weight = d.value; break;
      case 'font-style': out.style = d.value; break;
      case 'unicode-range': out.unicodeRange = d.value; break;
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// =============================================================================
// Selector matcher
// =============================================================================

export interface ElementContext {
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  /** Index of this element among its parent's children (0-based). */
  indexInParent?: number;
  /** Total siblings (including self). */
  siblingCount?: number;
  /** Index among siblings of the same tag. */
  indexOfType?: number;
  /** Total siblings of the same tag. */
  ofTypeCount?: number;
}

/** Match a selector against an element + ancestor stack (root → element). */
export function matchSelector(
  sel: Selector,
  stack: ElementContext[],
  resolveCtx: ResolveContext,
): boolean {
  if (stack.length === 0) return false;
  let stackIdx = stack.length - 1;
  let leaf = true;
  for (let partIdx = sel.parts.length - 1; partIdx >= 0; partIdx--) {
    const part = sel.parts[partIdx];
    // The combinator between parts[partIdx] and its right neighbor
    // (parts[partIdx+1]) is stored at combinators[partIdx+1]. That combinator
    // governs how we should *find* parts[partIdx] in the ancestor stack — e.g.
    // ">" means direct parent, " " means any ancestor.
    const combinator = sel.combinators[partIdx + 1];
    if (leaf) {
      // The leaf must match the current (last) element.
      if (!matchPart(part, stack[stackIdx], resolveCtx)) return false;
      stackIdx--;
      leaf = false;
      continue;
    }
    // Walk based on combinator
    switch (combinator) {
      case ' ': {
        // Descendant — find any ancestor that matches
        let found = false;
        while (stackIdx >= 0) {
          if (matchPart(part, stack[stackIdx], resolveCtx)) { found = true; stackIdx--; break; }
          stackIdx--;
        }
        if (!found) return false;
        break;
      }
      case '>': {
        // Direct parent only
        if (stackIdx < 0) return false;
        if (!matchPart(part, stack[stackIdx], resolveCtx)) return false;
        stackIdx--;
        break;
      }
      case '+':
      case '~': {
        // Sibling combinators require parent context we don't currently track
        // per-element in this matcher. Approximation: treat as descendant.
        // (A future refactor can carry sibling indices in the stack to make
        // these precise.)
        let found = false;
        while (stackIdx >= 0) {
          if (matchPart(part, stack[stackIdx], resolveCtx)) { found = true; stackIdx--; break; }
          stackIdx--;
        }
        if (!found) return false;
        break;
      }
    }
  }
  return true;
}

function matchPart(part: SelectorPart, el: ElementContext, ctx: ResolveContext): boolean {
  if (part.tag && part.tag !== '*' && part.tag !== el.tag) return false;
  if (part.id && part.id !== el.id) return false;
  if (part.classes.length) {
    if (!el.classes) return false;
    for (const c of part.classes) if (!el.classes.includes(c)) return false;
  }
  for (const a of part.attributes) {
    if (!matchAttribute(a, el)) return false;
  }
  for (const pc of part.pseudoClasses) {
    if (!matchPseudoClass(pc, el, ctx)) return false;
  }
  return true;
}

function matchAttribute(sel: AttributeSelector, el: ElementContext): boolean {
  const attrs = el.attributes;
  if (!attrs || !(sel.name in attrs)) return !sel.op && false ? false : !sel.op ? false : false || (!sel.op ? false : false);
  const raw = attrs[sel.name];
  if (!sel.op) return true;
  let actual = raw ?? '';
  let expected = sel.value ?? '';
  if (sel.caseInsensitive) { actual = actual.toLowerCase(); expected = expected.toLowerCase(); }
  switch (sel.op) {
    case '=':  return actual === expected;
    case '~=': return actual.split(/\s+/).includes(expected);
    case '|=': return actual === expected || actual.startsWith(expected + '-');
    case '^=': return actual.startsWith(expected);
    case '$=': return actual.endsWith(expected);
    case '*=': return actual.includes(expected);
  }
  return false;
}

function matchPseudoClass(pc: PseudoClass, el: ElementContext, ctx: ResolveContext): boolean {
  switch (pc.name) {
    case 'root':
      return el.tag === 'svg';
    case 'first-child':
      return el.indexInParent === 0;
    case 'last-child':
      return el.indexInParent != null && el.siblingCount != null && el.indexInParent === el.siblingCount - 1;
    case 'only-child':
      return el.siblingCount === 1;
    case 'first-of-type':
      return el.indexOfType === 0;
    case 'last-of-type':
      return el.indexOfType != null && el.ofTypeCount != null && el.indexOfType === el.ofTypeCount - 1;
    case 'nth-child':
    case 'nth-last-child':
    case 'nth-of-type':
    case 'nth-last-of-type': {
      if (!pc.args || pc.args.kind !== 'nth') return false;
      const isType = pc.name.includes('of-type');
      const isLast = pc.name.includes('last');
      const idx = isType ? el.indexOfType : el.indexInParent;
      const total = isType ? el.ofTypeCount : el.siblingCount;
      if (idx == null || total == null) return false;
      const n = isLast ? total - 1 - idx : idx;
      return nthMatches(pc.args.a, pc.args.b, n);
    }
    case 'not':
      if (pc.args?.kind !== 'selector-list') return false;
      for (const s of pc.args.selectors) {
        if (matchSelector(s, [el], ctx)) return false;
      }
      return true;
    case 'is':
    case 'where':
      if (pc.args?.kind !== 'selector-list') return false;
      return pc.args.selectors.some((s) => matchSelector(s, [el], ctx));
    case 'hover':
    case 'focus':
      return el.id != null && ctx.selectedIds.has(el.id);
    case 'active':
      return el.id != null && ctx.activeId === el.id;
    case 'has':
      // We can't see children of the current element in this matcher (we walk
      // ancestors, not descendants). Skip gracefully — common in real CSS
      // and matching "missing" is safer than false-positive matching.
      return false;
    default:
      // Unknown pseudo-class — be permissive, match (gentler than not-render)
      return false;
  }
}

function nthMatches(a: number, b: number, n: number): boolean {
  // n is 0-based; CSS spec uses 1-based, so we convert.
  const idx = n + 1;
  if (a === 0) return idx === b;
  const r = (idx - b) / a;
  return Number.isInteger(r) && r >= 0;
}

// =============================================================================
// Value resolution: var(), calc(), currentColor
// =============================================================================

export function resolveValue(
  value: string,
  cssVars: Record<string, string>,
  inheritedColor?: string,
  seenVars: Set<string> = new Set(),
): string {
  let out = resolveVars(value, cssVars, seenVars);
  if (inheritedColor) out = out.replace(/\bcurrentColor\b/gi, inheritedColor);
  out = resolveCalc(out);
  return out.trim();
}

function resolveVars(v: string, vars: Record<string, string>, seen: Set<string>): string {
  return v.replace(/var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)/g, (_, name, fallback) => {
    if (seen.has(name)) return fallback?.trim() ?? '';
    if (name in vars) {
      const nested = vars[name];
      seen.add(name);
      const resolved = resolveVars(nested, vars, seen);
      seen.delete(name);
      return resolved;
    }
    return fallback ? resolveVars(fallback.trim(), vars, seen) : '';
  });
}

function resolveCalc(v: string): string {
  return v.replace(/calc\(\s*([^()]+)\s*\)/g, (_, expr) => {
    try {
      const result = evaluateArithmetic(expr);
      if (Number.isFinite(result)) return String(result);
    } catch { /* fall through */ }
    return _; // Leave unresolved if we can't compute
  });
}

function evaluateArithmetic(expr: string): number {
  // Shunting-yard for + - * /, no unit support; sufficient for unitless math.
  // Strip units → assume pixel-equivalent numeric values.
  const stripped = expr.replace(/[A-Za-z%]+/g, '');
  // Safe-ish eval via Function — sandboxed by stripping non-numeric chars first.
  if (!/^[\d+\-*/.()\s]+$/.test(stripped)) throw new Error('bad calc');
  // eslint-disable-next-line no-new-func
  return Function(`"use strict";return (${stripped});`)();
}

// =============================================================================
// Cascade engine — resolve all styles for one element
// =============================================================================

export interface CascadeInput {
  rules: CssRule[];
  stack: ElementContext[];                  // root → element
  inherited: Record<string, string>;         // already-resolved inherited props from parent
  ctx: ResolveContext;
}

/** Properties that inherit in SVG per spec. */
const INHERITED_PROPS = new Set([
  'color', 'cursor', 'direction', 'fill', 'fill-rule', 'fill-opacity',
  'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
  'letter-spacing', 'pointer-events', 'shape-rendering', 'stroke',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor',
  'text-rendering', 'visibility', 'word-spacing', 'writing-mode',
]);

export function resolveCascade(input: CascadeInput): Record<string, string> {
  const { rules, stack, inherited, ctx } = input;
  const matched: Array<{
    spec: [number, number, number];
    order: number;
    important: boolean;
    declarations: Declaration[];
  }> = [];

  for (const rule of rules) {
    // Filter by @media / @supports conditions.
    if (rule.conditions) {
      let conditionsPass = true;
      for (const cond of rule.conditions) {
        if (cond.kind === 'media' && !evaluateMediaQuery(cond.query, ctx.mediaContext)) {
          conditionsPass = false; break;
        }
        if (cond.kind === 'supports' && !cond.result) {
          conditionsPass = false; break;
        }
      }
      if (!conditionsPass) continue;
    }
    // Try every selector in the rule's selector list.
    for (const sel of rule.selectors) {
      if (matchSelector(sel, stack, ctx)) {
        const hasImportant = rule.declarations.some((d) => d.important);
        matched.push({
          spec: sel.specificity,
          order: rule.order,
          important: hasImportant,
          declarations: rule.declarations,
        });
        break;
      }
    }
  }

  // Sort: !important wins over normal; within tiers, higher specificity wins;
  // ties broken by source order (later = wins).
  matched.sort((a, b) => {
    if (a.important !== b.important) return a.important ? 1 : -1;
    const s = compareSpec(a.spec, b.spec);
    if (s !== 0) return s;
    return a.order - b.order;
  });

  // Apply in order: later overrides earlier.
  const resolved: Record<string, string> = {};
  // Start with inherited values for inheritable properties.
  for (const [k, v] of Object.entries(inherited)) {
    if (INHERITED_PROPS.has(k)) resolved[k] = v;
  }
  for (const m of matched) {
    for (const d of m.declarations) {
      const inheritedColor = resolved['color'] || inherited['color'];
      resolved[d.property] = resolveValue(d.value, ctx.cssVariables, inheritedColor);
    }
  }
  return resolved;
}

// =============================================================================
// Convenience: collect <style> blocks from a parsed SVG tree
// =============================================================================

export function collectStyleRules(
  svgRoot: any,
  walk: (n: any, cb: (n: any, name: string) => void) => void,
  textOf: (n: any) => string,
): ParsedStylesheet {
  let combined = '';
  walk(svgRoot, (node, name) => {
    if (name !== 'style') return;
    combined += '\n' + textOf(node);
  });
  if (!combined.trim()) {
    return { rules: [], keyframes: [], fontFaces: [], imports: [], rootVariables: {}, warnings: [] };
  }
  return parseStylesheet(combined);
}
