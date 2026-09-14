import { registerRootComponent } from 'expo';

import App from './src/App';

/**
 * Expo entry point.
 *
 * `registerRootComponent` is what makes the component the root of the app in both
 * the Expo Go/dev-client runtime and a production build. It is separate from
 * `src/App.tsx` so the app component stays importable by tests without registering a
 * root component as a side effect.
 */
registerRootComponent(App);
