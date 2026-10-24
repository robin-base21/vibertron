/** Serialize a rendered blueprint <svg> to a standalone file (editor overlay stripped). */
export function svgToString(svg: SVGSVGElement): string {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.querySelectorAll('[data-editor-overlay]').forEach((n) => n.remove());
	clone.removeAttribute('class');
	const [, , w, h] = (clone.getAttribute('viewBox') ?? '0 0 1000 1000').split(' ').map(Number);
	clone.setAttribute('width', String(w));
	clone.setAttribute('height', String(h));
	const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
	style.textContent =
		"@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');";
	clone.insertBefore(style, clone.firstChild);
	return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function downloadText(filename: string, text: string, type = 'image/svg+xml') {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
