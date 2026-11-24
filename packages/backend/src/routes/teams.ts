import { ApproveBody, TeamMoveBody, applyTeamMove, newTeamSeat, seatInTeam } from 'common';
import { and, eq, inArray, max } from 'drizzle-orm';
import type { Event } from '../auth/guards';
import type { App, Routes } from '../app';
import { requireEventManager } from '../auth/guards';
import { participants, projects, teamMembers, teams } from '../db/schema';
import { loadBlueprint, participantDTO, projectDTO, teamDTO, teamDTOs } from '../dto';
import { HttpError, conflict, json, notFound, parseBody } from '../http';
import { notifyParticipants, notifyProject } from '../live/notify';

export function teamRoutes(app: App): Routes {
	const { db } = app;

	const userIdOf = (participantId: string) =>
		db.select({ userId: participants.userId }).from(participants).where(eq(participants.id, participantId)).get()?.userId;

	/** A pending late arrival of this event, while people can still be let in. */
	function requirePending(event: Event, participantId: string) {
		const p = db.select().from(participants).where(and(eq(participants.id, participantId), eq(participants.eventId, event.id))).get();
		if (!p) throw notFound('Participant not found');
		if (p.status !== 'pending') throw conflict(p.status === 'active' ? 'Already let in' : 'Already turned away');
		return p;
	}

	function notifyParticipant(eventId: string, participantId: string) {
		notifyParticipants(app, eventId);
		const participant = participantDTO(db, participantId)!;
		const userId = userIdOf(participantId);
		if (userId) app.live.toUser(userId, { type: 'participant.updated', participant });
		return participant;
	}

	return {
		'/api/events/:id/participants/:pid/approve': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const { teamId } = await parseBody(req, ApproveBody);
				if (event.status !== 'live' && event.status !== 'ended') throw conflict('Late arrivals are let in after launch');
				if (event.votingPhase !== 'none') throw conflict('Voting has started: nobody can join a team now');
				const pending = requirePending(event, req.params.pid!);
				const { blueprint } = loadBlueprint(db, event.id);
				if (!blueprint) throw conflict('Event has no blueprint');

				// Seat and activate in one (synchronous) transaction, so two approvals never share a station.
				const { seatedTeamId, stationId } = db.transaction(() => {
					const current = teamDTOs(db, event.id);
					let seatedTeamId: string;
					let stationId: string;
					if (teamId) {
						const team = current.find((t) => t.id === teamId);
						if (!team) throw notFound('Team not found');
						const seat = seatInTeam(blueprint, current, team.id);
						const area = blueprint.segments.find((s) => s.id === team.segmentId)?.name ?? team.segmentId;
						if (!seat) throw new HttpError(409, 'no_seat', `${area} has no free station for ${team.codename ?? team.name}`);
						seatedTeamId = team.id;
						stationId = seat;
					} else {
						const seat = newTeamSeat(blueprint, current);
						if (!seat) throw new HttpError(409, 'no_seat', 'There is no free station left');
						const position = (db.select({ p: max(teams.position) }).from(teams).where(eq(teams.eventId, event.id)).get()?.p ?? -1) + 1;
						seatedTeamId = crypto.randomUUID();
						stationId = seat.stationId;
						db.insert(teams)
							.values({ id: seatedTeamId, eventId: event.id, name: `Team ${position + 1}`, segmentId: seat.segmentId, stationIds: '[]', position })
							.run();
					}
					db.insert(teamMembers).values({ teamId: seatedTeamId, participantId: pending.id, stationId }).run();
					const seats = db.select({ s: teamMembers.stationId }).from(teamMembers).where(eq(teamMembers.teamId, seatedTeamId)).all();
					db.update(teams).set({ stationIds: JSON.stringify(seats.map((r) => r.s).sort()) }).where(eq(teams.id, seatedTeamId)).run();
					db.update(participants).set({ status: 'active' }).where(eq(participants.id, pending.id)).run();
					return { seatedTeamId, stationId };
				});

				const team = teamDTO(db, seatedTeamId)!;
				app.live.toEvent(event.id, { type: 'team.updated', team });
				const userId = userIdOf(pending.id);
				if (userId) app.live.toUser(userId, { type: 'assignment', eventId: event.id, team, stationId });
				const participant = notifyParticipant(event.id, pending.id);
				return json({ participant, team });
			}
		},
		'/api/events/:id/participants/:pid/reject': {
			POST: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const pending = requirePending(event, req.params.pid!);
				db.update(participants).set({ status: 'rejected' }).where(eq(participants.id, pending.id)).run();
				return json({ participant: notifyParticipant(event.id, pending.id) });
			}
		},
		'/api/events/:id/teams/move': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const move = await parseBody(req, TeamMoveBody);
				if (event.status !== 'live' && event.status !== 'ended') throw conflict('Teams exist only after launch');
				const personal = move.kind === 'member' || move.kind === 'swap';
				if (personal && event.votingPhase !== 'none') throw conflict('Voting has started: people can no longer change teams');
				const { blueprint } = loadBlueprint(db, event.id);
				if (!blueprint) throw conflict('Event has no blueprint');

				// Read and write in one (synchronous) transaction so concurrent moves never share a station.
				const changed = db.transaction((tx) => {
					const result = applyTeamMove(blueprint, teamDTOs(db, event.id), move);
					if (!result.ok) throw new HttpError(409, 'invalid', result.message);
					for (const t of result.teams) {
						tx.update(teams)
							.set({ segmentId: t.segmentId, stationIds: JSON.stringify(t.members.map((m) => m.stationId)) })
							.where(eq(teams.id, t.id))
							.run();
					}
					const ids = result.teams.map((t) => t.id);
					if (ids.length) {
						tx.delete(teamMembers).where(inArray(teamMembers.teamId, ids)).run();
						tx.insert(teamMembers)
							.values(result.teams.flatMap((t) => t.members.map((m) => ({ teamId: t.id, participantId: m.participantId, stationId: m.stationId }))))
							.run();
					}
					// Projects belong to their author's team.
					if (personal) {
						for (const t of result.teams) {
							const pids = t.members.map((m) => m.participantId);
							tx.update(projects).set({ teamId: t.id }).where(inArray(projects.participantId, pids)).run();
						}
					}
					return ids;
				});

				const changedTeams = teamDTOs(db, event.id).filter((t) => changed.includes(t.id));
				for (const team of changedTeams) {
					app.live.toEvent(event.id, { type: 'team.updated', team });
					for (const m of team.members) {
						const userId = db.select({ userId: participants.userId }).from(participants).where(eq(participants.id, m.participantId)).get()?.userId;
						if (userId) app.live.toUser(userId, { type: 'assignment', eventId: event.id, team, stationId: m.stationId });
					}
				}
				if (personal && changedTeams.length) {
					notifyParticipants(app, event.id);
					const moved = move.kind === 'swap' ? [move.participantId, move.withParticipantId] : [move.participantId];
					for (const row of db.select({ id: projects.id }).from(projects).where(inArray(projects.participantId, moved)).all()) {
						const project = projectDTO(db, row.id);
						if (project) notifyProject(app, event, project);
					}
				}
				return json({ teams: changedTeams });
			}
		}
	};
}
