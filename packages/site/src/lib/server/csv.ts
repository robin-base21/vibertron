/** RFC 4180 CSV, with a BOM so Excel opens UTF-8 (Korean names) correctly. */
export function toCsv(rows: (string | number | boolean | null)[][]): string {
	const cell = (v: string | number | boolean | null) => {
		const s = v === null ? '' : String(v);
		// Neutralise spreadsheet formulas in user input.
		const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
		return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
	};
	return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const csvResponse = (csv: string, filename: string) =>
	new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
