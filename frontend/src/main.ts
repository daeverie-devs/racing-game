import {bootstrapApplication} from '@angular/platform-browser';
import {inject, provideAppInitializer} from '@angular/core';
import {provideRouter, withComponentInputBinding} from '@angular/router';
import {MatIconRegistry} from '@angular/material/icon';
import {AppComponent} from './app/app.component';
import {routes} from './app/app.routes';

bootstrapApplication(AppComponent, {
    providers: [
        provideRouter(routes, withComponentInputBinding()),
        // index.html loads the rounded icon font
        provideAppInitializer(() => {
            inject(MatIconRegistry).setDefaultFontSetClass('material-icons-round');
        }),
    ]
}).catch(err => console.error(err));
