import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIcon} from '@angular/material/icon';
import {AvatarComponent} from '../avatar/avatar.component';
import {COLORS, EYES, MODIFIERS, randomSkin, SHAPES} from '../avatar/skin';
import {GameStore} from '../core/game.store';
import {Skin} from '../core/types';

type Tab = 'shape' | 'eyes' | 'modifier' | 'colors';

/** Join screen: a name and a character built from a shape, eyes, an accessory and two colors */
@Component({
    selector: 'rg-join',
    standalone: true,
    imports: [FormsModule, MatIcon, AvatarComponent],
    templateUrl: 'join.component.html',
    styleUrl: 'join.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinComponent {
    private store = inject(GameStore);

    readonly colors = COLORS;
    readonly tabs: {key: Tab, label: string}[] = [
        {key: 'shape', label: 'Forme'},
        {key: 'eyes', label: 'Yeux'},
        {key: 'modifier', label: 'Accessoire'},
        {key: 'colors', label: 'Couleurs'},
    ];
    readonly options: Record<Exclude<Tab, 'colors'>, string[]> = {
        shape: SHAPES.map(s => s.name),
        eyes: EYES,
        modifier: MODIFIERS,
    };

    name = signal(this.store.profile?.name ?? '');
    skin = signal<Skin>(this.store.profile?.skin ?? randomSkin());
    tab = signal<Tab>('shape');
    joining = signal(false);
    /** Bumped on every change so the preview does a little hop */
    bounce = signal(0);

    /** The skin part the open tab edits (not the colors tab) */
    part(): Exclude<Tab, 'colors'> {
        const tab = this.tab();
        return tab === 'colors' ? 'shape' : tab;
    }

    set(key: keyof Skin, value: number) {
        this.skin.update(s => ({...s, [key]: value}));
        this.bounce.update(n => n + 1);
    }

    variant(key: keyof Skin, value: number): Skin {
        return {...this.skin(), [key]: value};
    }

    shuffle() {
        this.skin.set(randomSkin());
        this.bounce.update(n => n + 1);
    }

    async join() {
        const name = this.name().trim();
        if (!name || this.joining()) return;
        this.joining.set(true);
        try {
            await this.store.join({name, skin: this.skin()});
        } catch (err) {
            this.store.showToast((err as Error).message);
        } finally {
            this.joining.set(false);
        }
    }
}
