/** Sections of the event form the AI may fill (shared by the dialog and the server). */
export const AI_SECTIONS = [
	{ id: 'basics', label: 'Name & tagline' },
	{ id: 'when', label: 'Date, time & venue' },
	{ id: 'seats', label: 'Seats & price' },
	{ id: 'description', label: 'Description' },
	{ id: 'form', label: 'Signup questions' }
] as const;
export type AiSection = (typeof AI_SECTIONS)[number]['id'];
