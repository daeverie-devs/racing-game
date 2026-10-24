import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {AvatarComponent} from '../avatar/avatar.component';
import {Entry} from '../core/types';

/** What you bet on: a racer's picture, or a player's character in a player race */
@Component({
    selector: 'rg-entry-visual',
    standalone: true,
    imports: [AvatarComponent],
    template: `
        @if (entry().skin) {
            <rg-avatar [skin]="entry().skin" size="100%" />
        } @else if (entry().imageUrl) {
            <img [src]="entry().imageUrl" [alt]="entry().name" loading="lazy" />
        } @else {
            <span class="placeholder">{{ entry().name.charAt(0) }}</span>
        }
    `,
    styles: `
        :host {
            display: grid;
            place-items: center;
            width: var(--size, 72px);
            height: var(--size, 72px);
            flex: none;
        }

        img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4));
        }

        .placeholder {
            display: grid;
            place-items: center;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: var(--rg-accent-soft);
            color: var(--rg-accent);
            font-size: calc(var(--size, 72px) * 0.45);
            font-weight: 800;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {'[style.--size]': 'size()'},
})
export class EntryVisualComponent {
    entry = input.required<Entry>();
    size = input('72px');
}
