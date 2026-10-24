export const env = {
	port: Number(process.env.PORT ?? 3001),
	databasePath: process.env.DATABASE_PATH ?? './data/vibertron.sqlite',
	uploadDir: process.env.UPLOAD_DIR ?? './data/uploads',
	openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
	openrouterModel: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-pro'
};
