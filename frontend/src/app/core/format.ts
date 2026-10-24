import {Pipe, PipeTransform} from '@angular/core';

const whole = new Intl.NumberFormat('fr-CA', {maximumFractionDigits: 0});
const precise = new Intl.NumberFormat('fr-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/** 1 234 $ for whole amounts, 1 234,56 $ otherwise */
export const formatMoney = (value: number | null | undefined, signed = false) => {
    if (value === null || value === undefined) return '—';
    const abs = Math.abs(value);
    const text = (Number.isInteger(Math.round(abs * 100) / 100) ? whole : precise).format(abs) + ' $';
    if (value < 0) return '−' + text;
    return signed && value > 0 ? '+' + text : text;
};

export const formatOdds = (odds: number | null | undefined) =>
    odds ? `${new Intl.NumberFormat('fr-CA', {maximumFractionDigits: odds < 10 ? 1 : 0}).format(odds)}×` : '—';

@Pipe({name: 'money', standalone: true})
export class MoneyPipe implements PipeTransform {
    transform(value: number | null | undefined, signed = false) {
        return formatMoney(value, signed);
    }
}

@Pipe({name: 'odds', standalone: true})
export class OddsPipe implements PipeTransform {
    transform(value: number | null | undefined) {
        return formatOdds(value);
    }
}

/** 1er, 2e, 3e... */
export const ordinal = (rank: number) => rank === 1 ? '1er' : `${rank}e`;

@Pipe({name: 'ordinal', standalone: true})
export class OrdinalPipe implements PipeTransform {
    transform(rank: number | null | undefined) {
        return rank ? ordinal(rank) : '';
    }
}

/**
 * Embed URL for a YouTube link: watch?v=, youtu.be/, shorts/, with t=90, t=1m30s or start=.
 * No autoplay: the admin starts it, so the volume is set before the room hears it.
 */
export const youtubeEmbed = (link: string | null | undefined) => {
    if (!link) return null;
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    const id = url.hostname.includes('youtu.be')
        ? url.pathname.slice(1)
        : url.searchParams.get('v') ?? url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
    if (!id) return null;
    const t = url.searchParams.get('t') ?? url.searchParams.get('start') ?? '';
    const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    const start = parts ? (Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0)) : 0;
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0&playsinline=1${start ? `&start=${start}` : ''}`;
};
