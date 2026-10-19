import {Component, Input, signal} from '@angular/core';
import {Message} from '../../types';

@Component({
    selector: 'message-bubble',
    standalone: true,
    imports: [],
    templateUrl: './message-bubble.component.html',
    styleUrl: './message-bubble.component.scss',
})
export default class MessageBubbleComponent {
    @Input() message: Message = {};

    position = [0, 100];

    constructor() {
        this.position = [Math.floor(Math.random()*90), 100];
    }
}
