/** Per-render drawing context: colours and the size of one CSS pixel in canvas units. */
export interface RenderCtx {
	/** Canvas units per CSS pixel. */
	u: number;
	/** Line weight multiplier (thicker lines on very large screens). */
	boost: number;
	fg: string;
	bg: string;
	accent: string;
}

export const FONT_LABEL = "'Barlow Condensed', ui-sans-serif, system-ui, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const ACCENT = '#38bdf8';
export const INK = '#f5f5f5';
export const PAPER = '#0a0a0a';

export const structural = (c: RenderCtx) => 1.75 * c.boost * c.u;
export const secondary = (c: RenderCtx) => 0.75 * c.boost * c.u;
