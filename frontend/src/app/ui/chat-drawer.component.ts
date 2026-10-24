import {ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, untracked, viewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';
import {AvatarComponent} from '../avatar/avatar.component';
import {GameStore} from '../core/game.store';

/** The phone's chat: a button with an unread count that opens a sheet */
@Component({
    selector: 'rg-chat-drawer',
    standalone: true,
    imports: [FormsModule, MatIcon, AvatarComponent],
    templateUrl: 'chat-drawer.component.html',
    styleUrl: 'chat-drawer.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatDrawerComponent {
    store = inject(GameStore);
    open = signal(false);
    unread = signal(0);
    text = signal('');
    sending = signal(false);
    private list = viewChild<ElementRef<HTMLElement>>('list');
    private input = viewChild<ElementRef<HTMLInputElement>>('input');

    constructor() {
        // Only messages that arrive after the drawer was created count as unread
        const seen = this.store.newMessage();
        effect(() => {
            const message = this.store.newMessage();
            if (!message || message === seen) return;
            untracked(() => {
                if (!this.open()) this.unread.update(n => n + 1);
                else this.scrollToEnd(false);
            });
        });
    }

    toggle() {
        this.open.update(v => !v);
        if (this.open()) {
            this.unread.set(0);
            this.scrollToEnd(true);
        }
    }

    async send() {
        const text = this.text().trim();
        if (!text || this.sending()) return;
        // Cleared right away so the next message can be typed; put back if sending failed
        this.text.set('');
        this.input()?.nativeElement.focus();
        this.sending.set(true);
        const sent = await this.store.tryAct('chat.send', {text});
        this.sending.set(false);
        if (!sent && !this.text()) this.text.set(text);
        this.input()?.nativeElement.focus();
    }

    /** Follows new messages only when already at the bottom, so reading history isn't interrupted */
    private scrollToEnd(force: boolean) {
        setTimeout(() => {
            const el = this.list()?.nativeElement;
            if (!el) return;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
            if (force || nearBottom) el.scrollTo({top: el.scrollHeight, behavior: force ? 'auto' : 'smooth'});
        });
    }
}
