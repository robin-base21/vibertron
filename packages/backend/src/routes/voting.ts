import {
	BallotBody,
	ProjectBody,
	VotingActionBody,
	candidatesFor,
	groupEligibleVoters,
	hashSeed,
	pitchEligibleVoters,
	tally,
	validateRanking,
	type TallyRow,
	type VotingPhase
} from 'common';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { requireEventManager, type Event } from '../auth/guards';
import { ballots, events, projects, teamMembers, votingResults } from '../db/schema';
import { eventDTO, pitchProjects, projectDTO, projectDTOs, teamRosters, votingState, type GroupResult } from '../dto';
import { HttpError, conflict, forbidden, json, parseBody } from '../http';
import { notifyEvent } from '../live/notify';
import { requireParticipant } from './attendee';

// Phase 6: one project per participant, a team round and a pitch round (rules in common/src/voting.ts).

/** Atomically move the event from one voting phase to the next; null when another request won. */
function casPhase(app: App, eventId: string, from: VotingPhase, to: VotingPhase): Event | null {
	return (
		app.db
			.update(events)
			.set({ votingPhase: to })
			.where(and(eq(events.id, eventId), eq(events.votingPhase, from)))
			.returning()
			.get() ?? null
	);
}

function notifyVoting(app: App, event: Event, phaseChanged: boolean) {
	app.live.toEvent(event.id, { type: 'voting.updated', eventId: event.id, voting: votingState(app.db, event) });
	if (phaseChanged) notifyEvent(app, event);
}

const rankingsOf = (rows: { ranking: string }[]) => rows.map((r) => JSON.parse(r.ranking) as string[]);

/**
 * group -> pitch: tally each team, freeze the result and the pitch list (team order).
 * Returns the updated event, or null when the phase had already moved on.
 */
export function closeGroup(app: App, eventId: string): Event | null {
	const { db } = app;
	return db.transaction((tx) => {
		const event = casPhase(app, eventId, 'group', 'pitch');
		if (!event) return null;
		const all = projectDTOs(db, eventId);
		const groupBallots = tx
			.select({ teamId: ballots.teamId, ranking: ballots.ranking })
			.from(ballots)
			.where(and(eq(ballots.eventId, eventId), eq(ballots.round, 'group')))
			.all();
		const result: GroupResult = { teams: {}, pitches: [] };
		for (const { teamId } of teamRosters(db, eventId)) {
			const ids = all.filter((p) => p.teamId === teamId).map((p) => p.id);
			if (ids.length === 0) continue;
			const rows = tally(
				ids,
				rankingsOf(groupBallots.filter((b) => b.teamId === teamId)),
				hashSeed(event.seed, teamId)
			);
			result.teams[teamId] = rows;
			result.pitches.push(rows[0]!.projectId);
		}
		tx.insert(votingResults).values({ eventId, round: 'group', json: JSON.stringify(result) }).run();
		return event;
	});
}

/** pitch -> results: tally the pitch ballots and freeze them. */
export function closePitch(app: App, eventId: string): Event | null {
	const { db } = app;
	return db.transaction((tx) => {
		const event = casPhase(app, eventId, 'pitch', 'results');
		if (!event) return null;
		const ids = pitchProjects(db, eventId).map((p) => p.id);
		const rows: TallyRow[] = tally(
			ids,
			rankingsOf(
				tx
					.select({ ranking: ballots.ranking })
					.from(ballots)
					.where(and(eq(ballots.eventId, eventId), eq(ballots.round, 'pitch')))
					.all()
			),
			hashSeed(event.seed, 'pitch')
		);
		tx.insert(votingResults).values({ eventId, round: 'pitch', json: JSON.stringify(rows) }).run();
		return event;
	});
}

/** Closes the group round when every voting team has all its ballots in (also when no team votes). */
function maybeAutoCloseGroup(app: App, event: Event): Event | null {
	const state = votingState(app.db, event);
	if (state.phase !== 'group' || state.group.teamsDone < state.group.teamsTotal) return null;
	return closeGroup(app, event.id);
}

export function votingRoutes(app: App): Routes {
	const { db } = app;

	const teamOf = (participantId: string) =>
		db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.participantId, participantId)).get()?.teamId ?? null;

	return {
		'/api/e/:slug/project': {
			PUT: async (req) => {
				const { event, participant } = requireParticipant(app, req, req.params.slug!);
				const body = await parseBody(req, ProjectBody);
				if (event.status !== 'live' && event.status !== 'ended') throw conflict('Projects can be named once the event is live');
				if (event.votingPhase !== 'none') throw conflict('Projects are locked once voting has started');
				const teamId = teamOf(participant.id);
				if (!teamId) throw forbidden('You are not on a team');
				const clash = db
					.select({ id: projects.id })
					.from(projects)
					.where(and(eq(projects.eventId, event.id), ne(projects.participantId, participant.id), sql`lower(${projects.name}) = lower(${body.name})`))
					.get();
				if (clash) throw conflict('Another project already uses that name');
				const tagline = body.tagline ? body.tagline : null;
				const now = new Date();
				const row = db
					.insert(projects)
					.values({ id: crypto.randomUUID(), eventId: event.id, participantId: participant.id, teamId, name: body.name, tagline, updatedAt: now })
					.onConflictDoUpdate({ target: projects.participantId, set: { name: body.name, tagline, teamId, updatedAt: now } })
					.returning({ id: projects.id })
					.get();
				const project = projectDTO(db, row.id)!;
				app.live.toEvent(event.id, { type: 'project.updated', project });
				return json({ project });
			}
		},
		'/api/e/:slug/ballot': {
			PUT: async (req) => {
				const { event, participant } = requireParticipant(app, req, req.params.slug!);
				const body = await parseBody(req, BallotBody);
				if (event.votingPhase !== body.round) {
					throw conflict(event.votingPhase === 'none' ? 'Voting has not started' : `The ${body.round} round is not open (phase: ${event.votingPhase})`);
				}
				const teamId = teamOf(participant.id);
				if (!teamId) throw forbidden('You are not on a team');

				let candidates: string[];
				if (body.round === 'group') {
					const teamProjects = projectDTOs(db, event.id).filter((p) => p.teamId === teamId);
					const members = teamRosters(db, event.id).find((r) => r.teamId === teamId)?.memberIds ?? [];
					if (!groupEligibleVoters(members, teamProjects).includes(participant.id)) throw forbidden('Your team does not vote in this round');
					candidates = candidatesFor(teamProjects, participant.id);
				} else {
					const pitches = pitchProjects(db, event.id);
					if (!pitchEligibleVoters([participant.id], pitches).length) throw forbidden('There is nothing for you to rank');
					candidates = candidatesFor(pitches, participant.id);
				}
				const invalid = validateRanking(body.ranking, candidates);
				if (invalid) throw new HttpError(422, 'invalid_ranking', invalid, { candidates });

				// Re-check the phase inside the write so a ballot cannot land after a concurrent close.
				const saved = db.transaction((tx) => {
					const open = tx
						.select({ id: events.id })
						.from(events)
						.where(and(eq(events.id, event.id), eq(events.votingPhase, body.round)))
						.get();
					if (!open) return false;
					const now = new Date();
					tx.insert(ballots)
						.values({
							id: crypto.randomUUID(),
							eventId: event.id,
							round: body.round,
							voterParticipantId: participant.id,
							teamId: body.round === 'group' ? teamId : null,
							ranking: JSON.stringify(body.ranking),
							updatedAt: now
						})
						.onConflictDoUpdate({
							target: [ballots.eventId, ballots.round, ballots.voterParticipantId],
							set: { ranking: JSON.stringify(body.ranking), updatedAt: now }
						})
						.run();
					return true;
				});
				if (!saved) throw conflict(`The ${body.round} round has closed`);

				const closed = body.round === 'group' ? maybeAutoCloseGroup(app, event) : null;
				const current = closed ?? event;
				notifyVoting(app, current, !!closed);
				return json({ ok: true, voting: votingState(db, current) });
			}
		},
		'/api/events/:id/voting': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const { action } = await parseBody(req, VotingActionBody);
				let updated: Event | null = null;

				switch (action) {
					case 'start': {
						if (event.status !== 'live' && event.status !== 'ended') throw conflict('Voting needs a live or ended event');
						if (event.votingPhase !== 'none') throw conflict(`Voting already started (phase: ${event.votingPhase})`);
						if (projectDTOs(db, event.id).length === 0) throw conflict('No projects have been named yet');
						// Starting while the clock still runs ends the build first (the manager confirmed both).
						updated = db.transaction((tx) => {
							if (event.status === 'live') {
								const now = new Date();
								const endsAt = event.endsAt && event.endsAt < now ? event.endsAt : now;
								tx.update(events).set({ status: 'ended', endsAt }).where(and(eq(events.id, event.id), eq(events.status, 'live'))).run();
							}
							return casPhase(app, event.id, 'none', 'group');
						});
						if (!updated) throw conflict('Voting was started concurrently');
						// Teams with fewer than two projects don't vote; if none vote, go straight to pitches.
						updated = maybeAutoCloseGroup(app, updated) ?? updated;
						break;
					}
					case 'close-group':
						updated = closeGroup(app, event.id);
						if (!updated) throw conflict(`The group round is not open (phase: ${event.votingPhase})`);
						break;
					case 'close-pitch':
						updated = closePitch(app, event.id);
						if (!updated) throw conflict(`The pitch round is not open (phase: ${event.votingPhase})`);
						break;
					case 'reset':
						updated = db.transaction((tx) => {
							tx.delete(ballots).where(eq(ballots.eventId, event.id)).run();
							tx.delete(votingResults).where(eq(votingResults.eventId, event.id)).run();
							return tx.update(events).set({ votingPhase: 'none' }).where(eq(events.id, event.id)).returning().get()!;
						});
						break;
				}

				notifyVoting(app, updated, true);
				return json({ event: eventDTO(db, updated), voting: votingState(db, updated) });
			}
		}
	};
}
