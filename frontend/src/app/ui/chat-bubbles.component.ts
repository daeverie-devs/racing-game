import {ChangeDetectionStrategy, Component, effect, inject, signal, untracked} from '@angular/core';
import {AvatarComponent} from '../avatar/avatar.component';
import {skinColor} from '../avatar/skin';
import {GameStore} from '../core/game.store';
import {ChatMessage} from '../core/types';

interface Bubble {
    message: ChatMessage;
    left: number;
    color: string;
}

const LIFETIME_MS = 9000;
const MAX_BUBBLES = 8;

/** Chat messages floating up the big screen, in the sender's color */
@Component({
    selector: 'rg-chat-bubbles',
    standalone: true,
    imports: [AvatarComponent],
    template: `
        @for (bubble of bubbles(); track bubble.message.id) {
            <div class="bubble" [style.left.%]="bubble.left" [style.--color]="bubble.color">
                <rg-avatar [skin]="bubble.message.skin" size="40px" />
                <div>
                    <span class="author">{{ bubble.message.name }}</span>
                    <p>{{ bubble.message.text }}</p>
                </div>
            </div>
        }
    `,
    styles: `
        :host {
            position: fixed;
            inset: 0;
            z-index: 30;
            pointer-events: none;
            overflow: hidden;
        }

        .bubble {
            position: absolute;
            bottom: 4vh;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            max-width: 28vw;
            padding: 0.6rem 1rem 0.6rem 0.6rem;
            border-radius: 28px;
            background: var(--rg-surface-strong);
            border: 2px solid var(--color);
            box-shadow: 0 0 24px color-mix(in srgb, var(--color) 45%, transparent), var(--rg-shadow);
            animation: rg-float-up 9s var(--rg-ease) forwards;
        }

        .author {
            font-size: 0.8rem;
            font-weight: 800;
            color: var(--color);
        }

        p {
            display: -webkit-box;
            overflow: hidden;
            font-size: 1.15rem;
            font-weight: 600;
            overflow-wrap: anywhere;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatBubblesComponent {
    private store = inject(GameStore);
    bubbles = signal<Bubble[]>([]);

    constructor() {
        // Only messages that arrive after the screen opened
        const seen = this.store.newMessage();
        effect(() => {
            const message = this.store.newMessage();
            if (!message || message === seen) return;
            const bubble = {message, left: 2 + Math.random() * 68, color: skinColor(message.skin)};
            untracked(() => this.bubbles.update(list => [...list.slice(-(MAX_BUBBLES - 1)), bubble]));
            setTimeout(() => this.bubbles.update(list => list.filter(b => b !== bubble)), LIFETIME_MS);
        });
    }
}
