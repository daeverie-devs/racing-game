import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {Skin} from '../core/types';
import {colorOf, SHAPES} from './skin';

let nextId = 0;

/** A player's character, drawn from their skin. Used everywhere a player appears */
@Component({
    selector: 'rg-avatar',
    standalone: true,
    templateUrl: 'avatar.component.html',
    styleUrl: 'avatar.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {'[style.--size]': 'size()', '[class.dimmed]': 'dimmed()'},
})
export class AvatarComponent {
    skin = input<Skin | null | undefined>();
    size = input<string>('48px');
    dimmed = input(false);

    readonly clipId = `rg-avatar-${nextId++}`;
    readonly body = computed(() => SHAPES[this.skin()?.shape ?? 0]?.path ?? SHAPES[0].path);
    readonly main = computed(() => colorOf(this.skin()?.main));
    readonly secondary = computed(() => colorOf(this.skin()?.secondary));
    readonly eyes = computed(() => this.skin()?.eyes ?? 0);
    readonly modifier = computed(() => this.skin()?.modifier ?? 0);
}
