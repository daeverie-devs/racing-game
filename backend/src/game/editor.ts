import {Op} from 'sequelize';
import {Game, Race, RaceEntry, Racer} from '../models';
import {sequelize} from '../sequelize';
import {getActiveGame, getRaces} from './engine';
import {GameError} from './rules';

const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export const racerImageUrl = (racer: Pick<Racer, 'id' | 'imageVersion' | 'imageType'>) =>
    racer.imageType ? `/api/racers/${racer.id}/image?v=${racer.imageVersion}` : null;

const text = (raw: unknown, max: number, label: string) => {
    const value = String(raw ?? '').trim();
    if (!value) throw new GameError(`${label} obligatoire`);
    return value.slice(0, max);
};

const intIn = (raw: unknown, min: number, max: number, fallback: number) => {
    const value = Math.floor(Number(raw));
    return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
};

/** A race of the active game that is running or done can't be edited: its bets depend on it */
const requireEditable = async (race: Race) => {
    const game = await Game.findByPk(race.gameId);
    if (!game?.active || game.status === 'lobby') return;
    const index = (await getRaces(game.id)).findIndex(r => r.id === race.id);
    if (index <= game.raceIndex) throw new GameError('Cette course est déjà commencée');
};

export const loadEditor = async () => {
    const racers = await Racer.findAll({attributes: ['id', 'name', 'imageType', 'imageVersion'], order: [['name', 'ASC']]});
    const games = await Game.findAll({order: [['id', 'ASC']]});
    const races = await Race.findAll({order: [['position', 'ASC'], ['id', 'ASC']]});
    const entries = await RaceEntry.findAll({where: {racerId: {[Op.ne]: null}}, order: [['position', 'ASC'], ['id', 'ASC']]});

    return {
        racers: racers.map(r => ({id: r.id, name: r.name, imageUrl: racerImageUrl(r)})),
        games: games.map(g => ({
            id: g.id,
            name: g.name,
            active: g.active,
            status: g.status,
            startingBalance: g.startingBalance,
            awardBonus: g.awardBonus,
            countdownSeconds: g.countdownSeconds,
            races: races.filter(r => r.gameId === g.id).map(r => ({
                id: r.id,
                name: r.name,
                type: r.type,
                link: r.link,
                presetWinnerRacerId: r.presetWinnerRacerId,
                racerIds: entries.filter(e => e.raceId === r.id).map(e => e.racerId!),
            })),
        })),
    };
};

// ---------- Racers ----------

const parseImage = (dataUrl: unknown) => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
    if (!match) throw new GameError('Image PNG, JPEG ou WebP seulement');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > IMAGE_MAX_BYTES) throw new GameError('Image trop lourde (3 Mo max)');
    return {image: buffer, imageType: match[1]};
};

export const saveRacer = async (data: {id?: unknown, name?: unknown, image?: unknown}) => {
    const name = text(data.name, 80, 'Nom');
    const image = data.image ? parseImage(data.image) : null;
    if (data.id) {
        const racer = await Racer.findByPk(Number(data.id));
        if (!racer) throw new GameError('Coureur introuvable');
        await racer.update(image ? {name, ...image, imageVersion: racer.imageVersion + 1} : {name});
        return racer.id;
    }
    if (!image) throw new GameError('Ajoute une image');
    return (await Racer.create({name, ...image})).id;
};

export const deleteRacer = async (id: unknown) => {
    const used = await RaceEntry.count({where: {racerId: Number(id)}});
    if (used) throw new GameError(`Ce coureur est dans ${used} course(s), retire-le d'abord`);
    await Racer.destroy({where: {id: Number(id)}});
};

// ---------- Games ----------

export const saveGame = async (data: {id?: unknown, name?: unknown, startingBalance?: unknown, awardBonus?: unknown, countdownSeconds?: unknown}) => {
    const values = {
        name: text(data.name, 80, 'Nom'),
        startingBalance: intIn(data.startingBalance, 100, 1_000_000, 5000),
        awardBonus: intIn(data.awardBonus, 0, 1_000_000, 500),
        countdownSeconds: intIn(data.countdownSeconds, 3, 300, 15),
    };
    if (data.id) {
        const game = await Game.findByPk(Number(data.id));
        if (!game) throw new GameError('Partie introuvable');
        await game.update(values);
        return game.id;
    }
    return (await Game.create({...values, lockDeadline: null, awards: null})).id;
};

export const deleteGame = async (id: unknown) => {
    const game = await Game.findByPk(Number(id));
    if (!game) return;
    if (game.active) throw new GameError('Active une autre partie avant de supprimer celle-ci');
    await game.destroy();
};

export const activateGame = async (id: unknown) => {
    const game = await Game.findByPk(Number(id));
    if (!game) throw new GameError('Partie introuvable');
    await sequelize.transaction(async transaction => {
        await Game.update({active: false}, {where: {}, transaction});
        await game.update({active: true}, {transaction});
    });
};

// ---------- Races ----------

export const saveRace = async (data: {
    id?: unknown, gameId?: unknown, name?: unknown, type?: unknown, link?: unknown,
    racerIds?: unknown, presetWinnerRacerId?: unknown
}) => {
    const type = data.type === 'players' ? 'players' : 'racers';
    const racerIds = type === 'racers' && Array.isArray(data.racerIds) ? [...new Set(data.racerIds.map(Number))] : [];
    const known = racerIds.length ? await Racer.findAll({where: {id: {[Op.in]: racerIds}}, attributes: ['id']}) : [];
    const validIds = racerIds.filter(id => known.some(r => r.id === id));
    const preset = Number(data.presetWinnerRacerId);
    const values = {
        name: String(data.name ?? '').trim().slice(0, 80),
        type,
        link: String(data.link ?? '').trim().slice(0, 255) || null,
        presetWinnerRacerId: type === 'racers' && validIds.includes(preset) ? preset : null,
    } as const;

    let race: Race;
    if (data.id) {
        const existing = await Race.findByPk(Number(data.id));
        if (!existing) throw new GameError('Course introuvable');
        await requireEditable(existing);
        race = await existing.update(values);
    } else {
        const game = await Game.findByPk(Number(data.gameId));
        if (!game) throw new GameError('Partie introuvable');
        const position = (await getRaces(game.id)).length;
        race = await Race.create({...values, gameId: game.id, position, winnerEntryId: null});
    }

    await sequelize.transaction(async transaction => {
        await RaceEntry.destroy({where: {raceId: race.id}, transaction});
        await RaceEntry.bulkCreate(validIds.map((racerId, position) => ({raceId: race.id, racerId, playerId: null, position})), {transaction});
    });
    return race.id;
};

export const deleteRace = async (id: unknown) => {
    const race = await Race.findByPk(Number(id));
    if (!race) return;
    await requireEditable(race);
    await race.destroy();
};

export const reorderRaces = async (data: {gameId?: unknown, raceIds?: unknown}) => {
    const game = await Game.findByPk(Number(data.gameId));
    if (!game) throw new GameError('Partie introuvable');
    if (game.active && game.status !== 'lobby') throw new GameError('Remets la partie au lobby pour changer l\'ordre');
    const ids = Array.isArray(data.raceIds) ? data.raceIds.map(Number) : [];
    await sequelize.transaction(async transaction => {
        for (const [position, id] of ids.entries()) {
            await Race.update({position}, {where: {id, gameId: game.id}, transaction});
        }
    });
};

export {getActiveGame};
