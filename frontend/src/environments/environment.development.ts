// The websocket goes through the dev server (proxy.conf.json forwards /ws to the backend),
// so the game works from whatever host it's opened on: localhost, the LAN IP, or a tunnel.
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

export const environment = {
    wsUrl: `${wsProtocol}//${window.location.host}/ws`,
    /** Shown as a QR code on the admin screen so players can join from their phone */
    raceUrl: `${window.location.origin}/`
}
