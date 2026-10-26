import { expect, test } from 'bun:test';
import { TEAM_COLORS, teamColor } from './teamColors';

test('consecutive teams never share a colour', () => {
	for (let p = 0; p < 40; p++) expect(teamColor(p).hex).not.toBe(teamColor(p + 1).hex);
});

test('the first cycle is plain, later cycles are striped', () => {
	expect(teamColor(0)).toEqual({ hex: TEAM_COLORS[0].hex, name: 'Orange', striped: false });
	expect(teamColor(TEAM_COLORS.length - 1).striped).toBe(false);
	expect(teamColor(TEAM_COLORS.length)).toEqual({ hex: TEAM_COLORS[0].hex, name: 'Orange stripes', striped: true });
});

test('colour depends only on position', () => {
	expect(teamColor(3)).toEqual(teamColor(3));
	expect(new Set(Array.from({ length: TEAM_COLORS.length }, (_, p) => teamColor(p).hex)).size).toBe(TEAM_COLORS.length);
});
