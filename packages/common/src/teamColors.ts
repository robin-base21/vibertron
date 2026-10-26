/*
Team colours on the black blueprint. Dark-mode steps of the validated categorical palette, minus
blue (the sky-blue accent stays reserved for selection). Teams are coloured by launch position, so
consecutive teams, which sit next to each other, never share a colour. From the 8th team on the
hues repeat with a diagonal hatch. Colour is never the only cue: the codename/number goes with it.
*/

export const TEAM_COLORS = [
	{ name: 'Orange', hex: '#d95926' },
	{ name: 'Teal', hex: '#199e70' },
	{ name: 'Amber', hex: '#c98500' },
	{ name: 'Pink', hex: '#d55181' },
	{ name: 'Green', hex: '#008300' },
	{ name: 'Violet', hex: '#9085e9' },
	{ name: 'Red', hex: '#e66767' }
] as const;

export interface TeamColor {
	hex: string;
	/** Human name, e.g. "Orange" or "Orange stripes". */
	name: string;
	/** Second and later cycles are drawn with a diagonal hatch. */
	striped: boolean;
}

export function teamColor(position: number): TeamColor {
	const n = TEAM_COLORS.length;
	const i = ((Math.floor(position) % n) + n) % n;
	const striped = position >= n;
	const base = TEAM_COLORS[i]!;
	return { hex: base.hex, name: striped ? `${base.name} stripes` : base.name, striped };
}
