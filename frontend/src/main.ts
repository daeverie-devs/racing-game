import {bootstrapApplication} from '@angular/platform-browser';
import {LOCALE_ID} from '@angular/core';
import {provideRouter} from '@angular/router';
import {RaceComponent} from './app/race.component';

bootstrapApplication(RaceComponent, {
    providers: [
        {provide: LOCALE_ID, useValue: 'en-CA'},
        // The game is a single screen; the router is only there for ?isAdmin=true
        provideRouter([]),
    ]
}).catch((err) => console.error(err));
