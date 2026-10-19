// Production: the frontend and the backend are served from the same host (reverse proxy on /ws).
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

export const environment = {
    wsUrl: `${wsProtocol}//${window.location.host}/ws`,
    /** Shown as a QR code on the admin screen so players can join from their phone */
    raceUrl: `${window.location.origin}/`
}
